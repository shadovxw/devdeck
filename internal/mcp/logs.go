package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/shadovxw/devdeck/internal/logs"
)

const (
	// defaultLines and maxLines bound how many log lines one query_logs call returns.
	defaultLines = 100
	maxLines     = 500
	// maxLineText cuts one very long line (a stack trace, a dumped payload).
	maxLineText = 2000
	// maxGroups bounds the error groups log_groups lists.
	maxGroups = 50
)

// logFilter is what narrows a log query. Every filter must match.
type logFilter struct {
	Workspace string `json:"workspace"`
	Stack     string `json:"stack"`
	Service   string `json:"service"`
	Level     string `json:"level"`
	Regex     string `json:"regex"`
	Since     string `json:"since"`
	Until     string `json:"until"`
	Group     string `json:"group"`
}

type logQuery struct {
	logFilter
	Limit  int    `json:"limit"`
	Before uint64 `json:"before"`
}

func (f logFilter) check() error {
	if err := checkArg("workspace", f.Workspace); err != nil {
		return err
	}
	if err := checkArg("stack", f.Stack); err != nil {
		return err
	}
	for name, v := range map[string]string{"service": f.Service, "level": f.Level, "since": f.Since, "until": f.Until, "group": f.Group} {
		if len(v) > 512 {
			return fmt.Errorf("%s is too long", name)
		}
	}
	if len(f.Regex) > 500 {
		return errors.New("regex is too long (500 characters at most)")
	}
	return nil
}

// path is the API path of the stack's logs, with the filters as its query.
func (f logFilter) path(suffix string, extra url.Values) string {
	q := url.Values{}
	for k, v := range map[string]string{"service": f.Service, "level": f.Level, "regex": f.Regex, "since": f.Since, "until": f.Until, "group": f.Group} {
		if v != "" {
			q.Set(k, v)
		}
	}
	for k, v := range extra {
		q[k] = v
	}
	p := "/api/v1/workspaces/" + url.PathEscape(f.Workspace) + "/stacks/" + url.PathEscape(f.Stack) + "/logs" + suffix
	if len(q) > 0 {
		p += "?" + q.Encode()
	}
	return p
}

// filterProps are the arguments that narrow a log query, for a tool's schema.
func filterProps() map[string]any {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	return map[string]any{
		"workspace": str("The workspace id from list_workspaces."),
		"stack":     str("The stack name."),
		"service":   str("Only these services (comma separated). A compose container is <compose file id>/<service>."),
		"level":     str("Only these levels (comma separated): trace, debug, info, warn, error, fatal."),
		"regex":     str("Only lines whose text matches this regular expression (Go syntax, 500 characters at most)."),
		"since":     str("Only lines from this time on: a time (RFC 3339) or how long ago, such as 15m, 2h or 7d."),
		"until":     str("Only lines up to this time, written like since."),
		"group":     str("Only the lines of one error group (its fingerprint, from log_groups)."),
	}
}

func logTools(c *client) []Tool {
	entryProps := filterProps()
	entryProps["limit"] = map[string]any{"type": "integer", "minimum": 1, "maximum": maxLines, "description": fmt.Sprintf("How many lines (newest first picked, shown oldest first). Default %d, at most %d.", defaultLines, maxLines)}
	entryProps["before"] = map[string]any{"type": "integer", "minimum": 1, "description": "Line number to page from: returns the lines just older than it. Use the number a previous answer gave."}
	return []Tool{
		{
			Name:        "query_logs",
			Description: "Stored output of a stack's services, secrets already masked. Newest lines first picked, shown oldest first, one per line as: #number time level service text. Filter by service, level, text, time or error group. Start with level=error and a short since, such as 15m.",
			Schema:      objectSchema(entryProps, "workspace", "stack"),
			Call:        c.queryLogs,
		},
		{
			Name:        "log_histogram",
			Description: "How many log lines matched, by level and over time (the last hour unless since and until say otherwise). Use it to see when errors started before reading the lines.",
			Schema:      objectSchema(filterProps(), "workspace", "stack"),
			Call:        c.logHistogram,
		},
		{
			Name:        "log_groups",
			Description: "The kinds of error seen in a stack, latest first: message, service, how many times, first and last seen. An error is the same as another when its fingerprint matches. Pass a fingerprint as group to query_logs to read its lines.",
			Schema: objectSchema(map[string]any{
				"workspace": filterProps()["workspace"],
				"stack":     filterProps()["stack"],
			}, "workspace", "stack"),
			Call: c.logGroups,
		},
	}
}

func objectSchema(props map[string]any, required ...string) map[string]any {
	schema := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func (c *client) queryLogs(ctx context.Context, args json.RawMessage) (string, error) {
	var a logQuery
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	limit, capped := a.Limit, false
	switch {
	case limit <= 0:
		limit = defaultLines
	case limit > maxLines:
		limit, capped = maxLines, true
	}
	extra := url.Values{"limit": {strconv.Itoa(limit)}}
	if a.Before > 0 {
		extra.Set("before", strconv.FormatUint(a.Before, 10))
	}
	body, err := c.get(ctx, a.path("", extra))
	if err != nil {
		return "", err
	}
	var res logs.Result
	if err := json.Unmarshal(body, &res); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	if len(res.Entries) == 0 {
		return "No lines match.", nil
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%d lines of %s/%s, oldest first.", len(res.Entries), a.Workspace, a.Stack)
	if capped {
		fmt.Fprintf(&b, " (limit capped at %d.)", maxLines)
	}
	if res.NextBefore > 0 {
		fmt.Fprintf(&b, " Older lines exist: call again with before=%d.", res.NextBefore)
	}
	for _, e := range res.Entries {
		level := e.Level
		if level == "" {
			level = "info"
		}
		text := strings.ReplaceAll(shorten(e.Text, maxLineText), "\n", "\n    ")
		fmt.Fprintf(&b, "\n#%d %s %s %s %s", e.Seq, e.Time.UTC().Format("2006-01-02T15:04:05Z"), level, e.Service, text)
	}
	return truncate(b.String()), nil
}

func (c *client) logHistogram(ctx context.Context, args json.RawMessage) (string, error) {
	var a logFilter
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	if err := a.check(); err != nil {
		return "", err
	}
	body, err := c.get(ctx, a.path("/histogram", nil))
	if err != nil {
		return "", err
	}
	var h logs.Histogram
	if err := json.Unmarshal(body, &h); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return withJSON(fmt.Sprintf("%d lines matched between %s and %s, in buckets of %d seconds.",
		h.Total, h.From.UTC().Format("15:04:05Z"), h.To.UTC().Format("15:04:05Z"), h.BucketSeconds), h)
}

func (c *client) logGroups(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		Workspace string `json:"workspace"`
		Stack     string `json:"stack"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	f := logFilter{Workspace: a.Workspace, Stack: a.Stack}
	if err := f.check(); err != nil {
		return "", err
	}
	body, err := c.get(ctx, f.path("/groups", nil))
	if err != nil {
		return "", err
	}
	var groups []logs.Group
	if err := json.Unmarshal(body, &groups); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	if len(groups) == 0 {
		return "No errors have been seen.", nil
	}
	summary := fmt.Sprintf("%d kinds of error, latest first.", len(groups))
	if len(groups) > maxGroups {
		groups = groups[:maxGroups]
		summary = fmt.Sprintf("%s Showing the latest %d.", summary, maxGroups)
	}
	return withJSON(summary, groups)
}

// shorten cuts s to n bytes (never inside a character) and says so.
func shorten(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n] + fmt.Sprintf(" …[cut: %d more bytes]", len(s)-n)
}
