package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/shadovxw/devdeck/internal/api"
	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

const (
	// maxBody bounds what is read from devdeck.
	maxBody = 4 << 20
	// maxText bounds what one tool hands to Claude (plan §2.5).
	maxText = 200 << 10
	// maxArg bounds an id or name Claude sends.
	maxArg = 128
)

// errNotRunning means nothing answered on devdeck's address.
var errNotRunning = errors.New("devdeck isn't running: open the devdeck app, then ask again")

// client reads devdeck's API as the connector. It can only GET, and the server
// refuses the connector everything outside its short list of routes.
type client struct {
	base string // http://127.0.0.1:7070
	http *http.Client
	// hostIdle and hostTotal time a host log read; zero means the defaults (tests set them short).
	hostIdle, hostTotal time.Duration
}

func (c *client) get(ctx context.Context, path string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return nil, err
	}
	stamp(ctx, req)
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w (nothing answered at %s)", errNotRunning, c.base)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, answerError(resp.StatusCode, body)
	}
	return body, nil
}

// stamp marks a request as the connector's, and says which tool it is for.
func stamp(ctx context.Context, req *http.Request) {
	req.Header.Set(api.ConnectorHeader, api.ConnectorClient)
	if tool, ok := ctx.Value(toolKey{}).(string); ok {
		req.Header.Set(api.ToolHeader, tool)
	}
}

// post sends a JSON body. The server lets the connector POST only to the YAML check,
// which saves nothing.
func (c *client) post(ctx context.Context, path string, in any) ([]byte, error) {
	payload, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	stamp(ctx, req)
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("%w (nothing answered at %s)", errNotRunning, c.base)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, answerError(resp.StatusCode, body)
	}
	return body, nil
}

// answerError turns an error answer into the words devdeck gave for it.
func answerError(status int, body []byte) error {
	var v struct {
		Message string `json:"message"`
	}
	if json.Unmarshal(body, &v) == nil && v.Message != "" {
		return errors.New(v.Message)
	}
	return fmt.Errorf("devdeck answered %d %s", status, http.StatusText(status))
}

// Tools returns the connector's tools, reading devdeck at base.
func Tools(base string, hc *http.Client) []Tool {
	c := &client{base: base, http: hc}
	noArgs := map[string]any{"type": "object", "properties": map[string]any{}, "additionalProperties": false}
	tools := []Tool{
		{
			Name:        "devdeck_status",
			Description: "Which stacks devdeck is running right now, their state (starting, running, degraded, stopping, stopped) and each service's state. Read this first for \"what is running?\" or \"is something failing?\".",
			Schema:      noArgs,
			Call:        c.status,
		},
		{
			Name:        "list_workspaces",
			Description: "The workspaces devdeck knows (the user's own and the bundled examples): id, name, how many repos, stacks and flows, and how many errors and warnings the files have.",
			Schema:      noArgs,
			Call:        c.workspaces,
		},
		{
			Name:        "get_workspace",
			Description: "One workspace in full: its repos, hosts, stacks, flows and the problems found in its files. Environment variable values in stacks are hidden; only their names are shown.",
			Schema: map[string]any{
				"type":                 "object",
				"properties":           map[string]any{"id": map[string]any{"type": "string", "description": "The workspace id from list_workspaces."}},
				"required":             []string{"id"},
				"additionalProperties": false,
			},
			Call: c.workspace,
		},
		{
			Name:        "doctor",
			Description: "Checks this machine for a workspace, or for one of its stacks: tools installed, Docker running, repos present, env files, with what to do about each failure. Reads only; changes nothing.",
			Schema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"workspace": map[string]any{"type": "string", "description": "The workspace id."},
					"stack":     map[string]any{"type": "string", "description": "Optional: check only this stack."},
				},
				"required":             []string{"workspace"},
				"additionalProperties": false,
			},
			Call: c.doctor,
		},
	}
	tools = append(tools, logTools(c)...)
	tools = append(tools, hostTools(c)...)
	tools = append(tools, checkTools(c)...)
	tools = append(tools, gitTools(c)...)
	return append(tools, uiTools(c)...)
}

func (c *client) status(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/runs")
	if err != nil {
		return "", err
	}
	var runs []supervisor.RunStatus
	if err := json.Unmarshal(body, &runs); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	if len(runs) == 0 {
		return "No stacks are running.", nil
	}
	count := map[supervisor.RunState]int{}
	for _, r := range runs {
		count[r.State]++
	}
	var parts []string
	for _, st := range []supervisor.RunState{supervisor.RunRunning, supervisor.RunStarting, supervisor.RunDegraded, supervisor.RunStopping, supervisor.RunStopped} {
		if n := count[st]; n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n, st))
		}
	}
	return withJSON(fmt.Sprintf("%d stacks: %s.", len(runs), strings.Join(parts, ", ")), runs)
}

func (c *client) workspaces(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/workspaces")
	if err != nil {
		return "", err
	}
	var all []workspace.Summary
	if err := json.Unmarshal(body, &all); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("%d workspaces.", len(all)), all)
}

func (c *client) workspace(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		ID string `json:"id"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := checkArg("id", a.ID); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/workspaces/"+url.PathEscape(a.ID))
	if err != nil {
		return "", err
	}
	var d map[string]any
	if err := json.Unmarshal(body, &d); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	hideEnvValues(d)
	return withJSON("Workspace "+a.ID+".", d)
}

func (c *client) doctor(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		Workspace string `json:"workspace"`
		Stack     string `json:"stack"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := checkArg("workspace", a.Workspace); err != nil {
		return "", err
	}
	q := url.Values{"workspace": {a.Workspace}}
	if a.Stack != "" {
		if err := checkArg("stack", a.Stack); err != nil {
			return "", err
		}
		q.Set("stack", a.Stack)
	}
	body, err := c.get(ctx, "/api/v1/doctor?"+q.Encode())
	if err != nil {
		return "", err
	}
	var rep doctor.Report
	if err := json.Unmarshal(body, &rep); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("%d failed, %d warnings, %d passed.", rep.Failures, rep.Warnings, rep.Passed), rep)
}

// hideEnvValues replaces every value in a stack service's env with a marker. The
// names stay: Claude can see what is set, never what it is set to (project rule:
// names only).
func hideEnvValues(d map[string]any) {
	stacks, _ := d["stacks"].([]any)
	for _, s := range stacks {
		stack, _ := s.(map[string]any)
		services, _ := stack["services"].([]any)
		for _, sv := range services {
			svc, _ := sv.(map[string]any)
			if env, ok := svc["env"].(map[string]any); ok {
				for k := range env {
					env[k] = "(hidden)"
				}
			}
		}
	}
}

// withJSON is a one-line summary followed by the data, cut to maxText.
func withJSON(summary string, v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return truncate(summary + "\n" + string(b)), nil
}

// truncate keeps the start of s and says so when it cuts.
func truncate(s string) string {
	if len(s) <= maxText {
		return s
	}
	n := maxText
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + fmt.Sprintf("\n[cut: %d more bytes not shown]", len(s)-n)
}

// decodeArgs reads a tool's arguments strictly: an argument the tool doesn't have is
// an error, so Claude learns the right names. No arguments at all is fine.
func decodeArgs(raw json.RawMessage, v any) error {
	if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "null" {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return fmt.Errorf("the arguments aren't right: %v", err)
	}
	return nil
}

func checkArg(name, v string) error {
	if v == "" {
		return fmt.Errorf("%s is needed", name)
	}
	if len(v) > maxArg {
		return fmt.Errorf("%s is too long", name)
	}
	return nil
}
