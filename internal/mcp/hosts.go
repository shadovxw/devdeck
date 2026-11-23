package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/compose"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/remote"
)

const (
	// defaultHostLines and maxHostLines bound the tail of a host's logs (the server
	// holds the connector to the same maximum).
	defaultHostLines = 100
	maxHostLines     = 200
	// hostLogIdle ends a log read once the agent has sent the tail and gone quiet;
	// hostLogTotal ends it whatever happens.
	hostLogIdle  = 2 * time.Second
	hostLogTotal = 20 * time.Second
)

// hostRef names a host: the workspace that lists it and its id.
type hostRef struct {
	Workspace string `json:"workspace"`
	Host      string `json:"host"`
}

func (h hostRef) check() error {
	if err := checkArg("workspace", h.Workspace); err != nil {
		return err
	}
	return checkArg("host", h.Host)
}

func (h hostRef) path(rest string) string {
	return "/api/v1/hosts/" + url.PathEscape(h.Workspace) + "/" + url.PathEscape(h.Host) + rest
}

// hostStack names a stack on a host.
type hostStack struct {
	hostRef
	Stack string `json:"stack"`
}

func (h hostStack) check() error {
	if err := h.hostRef.check(); err != nil {
		return err
	}
	return checkArg("stack", h.Stack)
}

func (h hostStack) path(rest string) string {
	return h.hostRef.path("/stacks/" + url.PathEscape(h.Stack) + rest)
}

func hostTools(c *client) []Tool {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	hostProps := map[string]any{
		"workspace": str("The workspace id that lists the host (from list_hosts)."),
		"host":      str("The host id (from list_hosts)."),
	}
	stackProps := map[string]any{"workspace": hostProps["workspace"], "host": hostProps["host"], "stack": str("The stack id on the host (from host_info).")}
	const access = " Remote hosts are switched off for Claude until the person turns them on in devdeck, and only a host whose tunnel is already open can be read: if a tool says so, tell the person."
	return []Tool{
		{
			Name:        "list_hosts",
			Description: "The remote hosts (machines that run devdeck's agent) the user's workspaces list: id, name, instance, region, whether a token is saved and whether the tunnel is open." + access,
			Schema:      objectSchema(map[string]any{}),
			Call:        c.listHosts,
		},
		{
			Name:        "host_info",
			Description: "What a host's agent says: its version and its stacks (id, name, whether writes are allowed)." + access,
			Schema:      objectSchema(hostProps, "workspace", "host"),
			Call:        c.hostInfo,
		},
		{
			Name:        "host_services",
			Description: "The containers of one stack on a host: service, image, state, health, published ports." + access,
			Schema:      objectSchema(stackProps, "workspace", "host", "stack"),
			Call:        c.hostServices,
		},
		{
			Name:        "host_compose",
			Description: "A stack's compose configuration on a host, service by service: image as written (for example ${API_IMAGE}), ports, depends_on, health check, volumes, and environment variable NAMES only." + access,
			Schema:      objectSchema(stackProps, "workspace", "host", "stack"),
			Call:        c.hostCompose,
		},
		{
			Name:        "host_logs",
			Description: fmt.Sprintf("The last lines of a stack's container logs on a host (default %d, at most %d), oldest first, one per line as: time service text. A short read, not a live stream. Known secret shapes are masked, but host logs are raw: don't repeat anything that looks like a credential.", defaultHostLines, maxHostLines) + access,
			Schema: objectSchema(map[string]any{
				"workspace": stackProps["workspace"], "host": stackProps["host"], "stack": stackProps["stack"],
				"service": str("Only this service."),
				"tail":    map[string]any{"type": "integer", "minimum": 1, "maximum": maxHostLines, "description": "How many lines per service."},
			}, "workspace", "host", "stack"),
			Call: c.hostLogs,
		},
	}
}

func (c *client) listHosts(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/hosts")
	if err != nil {
		return "", err
	}
	var hosts []remote.HostView
	if err := json.Unmarshal(body, &hosts); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	open := 0
	for _, h := range hosts {
		if h.Tunnel.Open {
			open++
		}
	}
	return withJSON(fmt.Sprintf("%d hosts, %d with the tunnel open.", len(hosts), open), hosts)
}

func (c *client) hostInfo(ctx context.Context, args json.RawMessage) (string, error) {
	var a hostRef
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	body, err := c.get(ctx, a.path("/info"))
	if err != nil {
		return "", err
	}
	var info agent.Info
	if err := json.Unmarshal(body, &info); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("Agent %s with %d stacks.", info.Version, len(info.Stacks)), info)
}

func (c *client) hostServices(ctx context.Context, args json.RawMessage) (string, error) {
	var a hostStack
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	body, err := c.get(ctx, a.path("/services"))
	if err != nil {
		return "", err
	}
	var list []compose.Container
	if err := json.Unmarshal(body, &list); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	states := map[string]int{}
	unhealthy := 0
	for _, ct := range list {
		states[ct.State]++
		if ct.Health == "unhealthy" {
			unhealthy++
		}
	}
	var parts []string
	for state, n := range states {
		parts = append(parts, fmt.Sprintf("%d %s", n, state))
	}
	sort.Strings(parts)
	if len(list) == 0 {
		return "No containers.", nil
	}
	summary := fmt.Sprintf("%d containers: %s.", len(list), strings.Join(parts, ", "))
	if unhealthy > 0 {
		summary += fmt.Sprintf(" %d unhealthy.", unhealthy)
	}
	return withJSON(summary, list)
}

func (c *client) hostCompose(ctx context.Context, args json.RawMessage) (string, error) {
	var a hostStack
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	body, err := c.get(ctx, a.path("/compose"))
	if err != nil {
		return "", err
	}
	var v compose.View
	if err := json.Unmarshal(body, &v); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("%d services in compose project %s.", len(v.Services), v.Name), v)
}

func (c *client) hostLogs(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		hostStack
		Service string `json:"service"`
		Tail    int    `json:"tail"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	if len(a.Service) > maxArg {
		return "", errors.New("service is too long")
	}
	tail, capped := a.Tail, false
	switch {
	case tail <= 0:
		tail = defaultHostLines
	case tail > maxHostLines:
		tail, capped = maxHostLines, true
	}
	q := url.Values{"tail": {strconv.Itoa(tail)}}
	if a.Service != "" {
		q.Set("service", a.Service)
	}
	lines, err := c.readLogLines(ctx, a.path("/logs?"+q.Encode()), maxHostLines*8)
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "No log lines.", nil
	}

	// Lines of several services arrive as each follower delivers them: put them in time
	// order, and the followers' own errors (which have no time) after them.
	var text, problems []agent.LogLine
	for _, l := range lines {
		if l.Error != "" {
			problems = append(problems, l)
		} else {
			text = append(text, l)
		}
	}
	sort.SliceStable(text, func(i, j int) bool { return text[i].TS.Before(text[j].TS) })

	// Host logs are raw, so every line is masked here too, before Claude reads it.
	var red logs.Redactor
	var b strings.Builder
	fmt.Fprintf(&b, "%d lines of %s/%s on %s, oldest first.", len(text), a.Workspace, a.Stack, a.Host)
	if capped {
		fmt.Fprintf(&b, " (tail capped at %d.)", maxHostLines)
	}
	for _, l := range text {
		fmt.Fprintf(&b, "\n%s %s %s", l.TS.UTC().Format("2006-01-02T15:04:05Z"), l.Service, shorten(red.Redact(logs.Clean(l.Line)), maxLineText))
	}
	for _, l := range problems {
		fmt.Fprintf(&b, "\n! %s: %s", l.Service, shorten(red.Mask(logs.Clean(l.Error)), maxLineText))
	}
	return truncate(b.String()), nil
}

// readLogLines reads the agent's newline-delimited log stream for a short while: until it
// has gone quiet (the tail has been sent), until limit lines are in, or until the total
// time is up. The stream itself never ends, so ending it is the reader's job.
func (c *client) readLogLines(ctx context.Context, path string, limit int) ([]agent.LogLine, error) {
	idle, total := c.hostIdle, c.hostTotal
	if idle <= 0 {
		idle = hostLogIdle
	}
	if total <= 0 {
		total = hostLogTotal
	}
	ctx, cancel := context.WithTimeout(ctx, total)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	stamp(ctx, req)
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("the host didn't answer in time")
		}
		return nil, fmt.Errorf("%w (nothing answered at %s)", errNotRunning, c.base)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
		return nil, answerError(resp.StatusCode, body)
	}

	// The tail comes straight after the headers; once it stops, so do we.
	timer := time.AfterFunc(idle, cancel)
	defer timer.Stop()
	var out []agent.LogLine
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64<<10), 1<<20)
	for sc.Scan() {
		var l agent.LogLine
		if json.Unmarshal(sc.Bytes(), &l) != nil || l.Heartbeat {
			continue
		}
		timer.Reset(idle)
		out = append(out, l)
		if len(out) >= limit {
			break
		}
	}
	// A read ended by our own timers is the normal end; anything else already stopped the loop.
	return out, nil
}
