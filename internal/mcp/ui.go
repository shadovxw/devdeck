package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/api"
)

func uiTools(c *client) []Tool {
	return []Tool{{
		Name:        "get_ui_state",
		Description: "Where the person is in devdeck's window right now: the page, its filters and selection (the address parameters) and the error message it shows, if any. Use it to answer \"what am I looking at?\" or \"why does this screen say that?\", then read the data with the other tools. The person can switch this off in devdeck's Claude access setting.",
		Schema:      objectSchema(map[string]any{}),
		Call:        c.uiState,
	}}
}

func (c *client) uiState(ctx context.Context, args json.RawMessage) (string, error) {
	if err := decodeArgs(args, &struct{}{}); err != nil {
		return "", err
	}
	body, err := c.get(ctx, "/api/v1/ui/state")
	if err != nil {
		return "", err
	}
	var s api.UISnapshot
	if err := json.Unmarshal(body, &s); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	if s.Route == "" || s.At == nil {
		return "devdeck's window hasn't reported a page yet: open devdeck (the app, or http://127.0.0.1:7070 in a browser) and try again.", nil
	}
	var b strings.Builder
	page := s.Label
	if page == "" {
		page = s.Route
	}
	fmt.Fprintf(&b, "The person is on the %s page (%s), reported %s ago.", page, s.Route, time.Since(*s.At).Round(time.Second))
	keys := make([]string, 0, len(s.Params))
	for k := range s.Params {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(&b, "\n%s = %s", k, s.Params[k])
	}
	if s.Notice != "" {
		fmt.Fprintf(&b, "\nIt shows this message: %s", s.Notice)
	}
	return truncate(b.String()), nil
}
