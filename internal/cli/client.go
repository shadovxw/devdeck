package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// maxBody bounds what is read from the server; its answers are small.
const maxBody = 4 << 20

// errNotRunning means nothing answered on devdeck's address.
var errNotRunning = errors.New("devdeck isn't running")

// apiError is an error answer from the server, with its own words for it.
type apiError struct {
	Status  int
	Message string
	// Report is set when the machine wasn't ready to start the stack.
	Report *doctor.Report
}

func (e *apiError) Error() string { return e.Message }

// client calls the devdeck server's API.
type client struct {
	base string // http://127.0.0.1:7070
	http *http.Client
}

func (c *client) workspaces(ctx context.Context) ([]workspace.Summary, error) {
	var out []workspace.Summary
	return out, c.do(ctx, http.MethodGet, "/api/v1/workspaces", http.StatusOK, &out)
}

func (c *client) runs(ctx context.Context) ([]supervisor.RunStatus, error) {
	var out []supervisor.RunStatus
	return out, c.do(ctx, http.MethodGet, "/api/v1/runs", http.StatusOK, &out)
}

func (c *client) start(ctx context.Context, ws, stack string) error {
	return c.do(ctx, http.MethodPost, stackPath(ws, stack)+"/start", http.StatusAccepted, nil)
}

func (c *client) stop(ctx context.Context, ws, stack string) error {
	return c.do(ctx, http.MethodPost, stackPath(ws, stack)+"/stop", http.StatusNoContent, nil)
}

func stackPath(ws, stack string) string {
	return "/api/v1/workspaces/" + url.PathEscape(ws) + "/stacks/" + url.PathEscape(stack)
}

// do sends one request. It returns nil when the answer is want (decoding the
// body into out when out is set) and an *apiError for any other answer.
func (c *client) do(ctx context.Context, method, path string, want int, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%w at %s", errNotRunning, c.base)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return err
	}

	if resp.StatusCode != want {
		return decodeError(resp.StatusCode, body)
	}
	if out == nil {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("devdeck sent an answer that can't be read: %w", err)
	}
	return nil
}

// decodeError reads Echo's {"message": ...} body, or the start refusal that
// also carries the Doctor report.
func decodeError(status int, body []byte) *apiError {
	var v struct {
		Message string         `json:"message"`
		Report  *doctor.Report `json:"report"`
	}
	if json.Unmarshal(body, &v) != nil || v.Message == "" {
		v.Message = fmt.Sprintf("devdeck answered %d %s", status, http.StatusText(status))
	}
	return &apiError{Status: status, Message: v.Message, Report: v.Report}
}
