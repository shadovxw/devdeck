// Package remote is devdeck's side of a remote host: the client of `devdeck agent`,
// reached through a tunnel on a local port.
package remote

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/compose"
)

// Client talks to one agent.
type Client struct {
	// Base is where the agent answers, such as http://127.0.0.1:17071 (the local end of the tunnel).
	Base  string
	Token string
	// HTTP is the client to use; nil means one with no overall timeout, since logs stream.
	HTTP *http.Client
	// RetryMax is the longest wait between reconnections of a log stream (30 s when zero).
	RetryMax time.Duration
}

// Error is a refusal from the agent, with its status and message.
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("the agent answered %d: %s", e.Status, e.Message) }

// Permanent says retrying won't help: a bad token, a stack or service that isn't there, a bad request.
func (e *Error) Permanent() bool {
	return e.Status == http.StatusUnauthorized || e.Status == http.StatusForbidden || e.Status == http.StatusNotFound || e.Status == http.StatusBadRequest
}

// ErrOldAgent means the agent speaks another version of the API.
var ErrOldAgent = errors.New("the agent on this host is a different version: update it")

const callTimeout = 30 * time.Second

func (c *Client) http() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return http.DefaultClient
}

func (c *Client) do(ctx context.Context, path string, q url.Values) (*http.Response, error) {
	u := strings.TrimRight(c.Base, "/") + path
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	res, err := c.http().Do(req)
	if err != nil {
		return nil, fmt.Errorf("the agent couldn't be reached (is the tunnel open?): %w", err)
	}
	if res.StatusCode != http.StatusOK {
		defer res.Body.Close()
		var body struct {
			Message string `json:"message"`
		}
		data, _ := io.ReadAll(io.LimitReader(res.Body, 64<<10))
		if json.Unmarshal(data, &body) != nil || body.Message == "" {
			body.Message = http.StatusText(res.StatusCode)
		}
		return nil, &Error{Status: res.StatusCode, Message: body.Message}
	}
	return res, nil
}

func getJSON[T any](ctx context.Context, c *Client, path string) (T, error) {
	var out T
	ctx, cancel := context.WithTimeout(ctx, callTimeout)
	defer cancel()
	res, err := c.do(ctx, path, nil)
	if err != nil {
		return out, err
	}
	defer res.Body.Close()
	if err := json.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(&out); err != nil {
		return out, fmt.Errorf("the agent's answer couldn't be read: %w", err)
	}
	return out, nil
}

// Info asks the agent who it is and which stacks it has, and checks it speaks this API.
func (c *Client) Info(ctx context.Context) (agent.Info, error) {
	info, err := getJSON[agent.Info](ctx, c, "/v1/info")
	if err != nil {
		return info, err
	}
	if info.API != agent.APIVersion {
		return info, fmt.Errorf("%w (it speaks API %d, devdeck %d)", ErrOldAgent, info.API, agent.APIVersion)
	}
	return info, nil
}

// Services is the state of each container of a stack.
func (c *Client) Services(ctx context.Context, stack string) ([]compose.Container, error) {
	return getJSON[[]compose.Container](ctx, c, "/v1/stacks/"+url.PathEscape(stack)+"/services")
}

// Compose is the stack's configuration, without values.
func (c *Client) Compose(ctx context.Context, stack string) (compose.View, error) {
	return getJSON[compose.View](ctx, c, "/v1/stacks/"+url.PathEscape(stack)+"/compose")
}

// LogQuery says which lines to follow: a service ("" for the whole stack), and from
// when (Since) or how many of the last ones (Tail, when Since is zero).
type LogQuery struct {
	Stack   string
	Service string
	Since   time.Time
	Tail    int
}

// Stream follows the logs over one connection until it ends, ctx ends, or the
// connection drops. Heartbeats are not handed over.
func (c *Client) Stream(ctx context.Context, q LogQuery, fn func(agent.LogLine)) error {
	v := url.Values{}
	if q.Service != "" {
		v.Set("service", q.Service)
	}
	if !q.Since.IsZero() {
		v.Set("since", q.Since.UTC().Format(time.RFC3339Nano))
	} else if q.Tail > 0 {
		v.Set("tail", fmt.Sprint(q.Tail))
	}
	res, err := c.do(ctx, "/v1/stacks/"+url.PathEscape(q.Stack)+"/logs", v)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var l agent.LogLine
		if json.Unmarshal(sc.Bytes(), &l) != nil || l.Heartbeat {
			continue
		}
		fn(l)
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	return sc.Err()
}

// Follow keeps following the logs until ctx ends, reconnecting after a dropped
// connection from where it stopped. A line not newer than the last one taken for
// its service is skipped, so a reconnection neither loses nor repeats lines. It
// gives up only on a refusal that retrying can't fix.
func (c *Client) Follow(ctx context.Context, q LogQuery, fn func(agent.LogLine)) error {
	last := map[string]time.Time{}
	retryMax := c.RetryMax
	if retryMax == 0 {
		retryMax = 30 * time.Second
	}
	wait := time.Second
	first := true
	for {
		cur := q
		if !first {
			// From the oldest point any service had reached, so none of them misses a line.
			cur.Since, cur.Tail = oldest(last, q.Since), 0
		}
		first = false
		began := time.Now()
		err := c.Stream(ctx, cur, func(l agent.LogLine) {
			if l.Error == "" && l.Service != "" {
				if !l.TS.After(last[l.Service]) {
					return
				}
				last[l.Service] = l.TS
			}
			fn(l)
		})
		if ctx.Err() != nil {
			return nil
		}
		var refusal *Error
		if errors.As(err, &refusal) && refusal.Permanent() {
			return err
		}
		if time.Since(began) > time.Minute {
			wait = time.Second
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(wait):
		}
		wait = min(wait*2, retryMax)
	}
}

// oldest is the earliest of the times reached, or start when nothing was taken yet.
func oldest(last map[string]time.Time, start time.Time) time.Time {
	var out time.Time
	for _, t := range last {
		if out.IsZero() || t.Before(out) {
			out = t
		}
	}
	if out.IsZero() {
		if start.IsZero() {
			return time.Now().Add(-time.Second)
		}
		return start
	}
	return out
}
