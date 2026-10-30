package remote

import (
	"context"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// token is long enough, and plainly not a real one.
var token = strings.Repeat("test", 12)

// runner stands in for docker on the host: canned outputs, and for logs a list of
// rounds, one per connection.
type runner struct {
	mu     sync.Mutex
	rounds [][]string // the lines handed over by each follower started, in turn
	calls  [][]string
}

func (r *runner) Output(_ context.Context, _ string, args []string) (string, error) {
	switch strings.Join(args[len(args)-2:], " ") {
	case "config --services":
		return "api\n", nil
	case "--format json":
		return `{"Name":"acme-api","Service":"api","State":"running","Health":"healthy"}`, nil
	case "json --no-interpolate":
		return `{"name":"acme","services":{"api":{"image":"${API_IMAGE}"}}}`, nil
	}
	return "", errors.New("unexpected " + strings.Join(args, " "))
}

func (r *runner) Stream(_ context.Context, _ string, args []string, line func(string)) error {
	r.mu.Lock()
	r.calls = append(r.calls, args)
	var lines []string
	if len(r.rounds) > 0 {
		lines, r.rounds = r.rounds[0], r.rounds[1:]
	}
	r.mu.Unlock()
	for _, l := range lines {
		line(l)
	}
	return nil // the follower ends, so the connection ends
}

// Exec is for the agent's writes, which devdeck doesn't ask for yet.
func (r *runner) Exec(context.Context, string, string, []string, func(string)) error {
	return errors.New("writes are not part of these tests")
}

func server(t *testing.T, r *runner) *httptest.Server {
	cfg := agent.Config{Listen: agent.DefaultListen, TokenFile: "x", Stacks: []agent.Stack{{ID: "apps", Name: "Apps", Dir: "/srv/acme", Files: []string{"compose.yml"}}}}
	srv := httptest.NewServer(agent.New(cfg, []byte(token), r, zerolog.Nop(), "9.9.9").Handler())
	t.Cleanup(srv.Close)
	return srv
}

func TestInfoServicesAndCompose(t *testing.T) {
	srv := server(t, &runner{})
	c := &Client{Base: srv.URL, Token: token}
	ctx := context.Background()
	info, err := c.Info(ctx)
	if err != nil || info.Version != "9.9.9" || len(info.Stacks) != 1 || info.Stacks[0].ID != "apps" {
		t.Fatalf("info = %+v %v", info, err)
	}
	svcs, err := c.Services(ctx, "apps")
	if err != nil || len(svcs) != 1 || svcs[0].Health != "healthy" {
		t.Errorf("services = %+v %v", svcs, err)
	}
	view, err := c.Compose(ctx, "apps")
	if err != nil || len(view.Services) != 1 || view.Services[0].Image != "${API_IMAGE}" {
		t.Errorf("compose = %+v %v", view, err)
	}
}

func TestRefusalsAreErrors(t *testing.T) {
	srv := server(t, &runner{})
	ctx := context.Background()
	_, err := (&Client{Base: srv.URL, Token: "wrong"}).Info(ctx)
	var e *Error
	if !errors.As(err, &e) || e.Status != 401 || !e.Permanent() {
		t.Errorf("a bad token: %v", err)
	}
	_, err = (&Client{Base: srv.URL, Token: token}).Services(ctx, "nope")
	if !errors.As(err, &e) || e.Status != 404 || !strings.Contains(e.Message, "no such stack") {
		t.Errorf("an unknown stack: %v", err)
	}
	if _, err := (&Client{Base: "http://127.0.0.1:1", Token: token}).Info(ctx); err == nil || !strings.Contains(err.Error(), "tunnel") {
		t.Errorf("nobody listening: %v", err)
	}
	// Follow gives up at once on a refusal retrying can't fix
	err = (&Client{Base: srv.URL, Token: token}).Follow(ctx, LogQuery{Stack: "apps", Service: "db"}, func(agent.LogLine) {})
	if !errors.As(err, &e) || e.Status != 404 {
		t.Errorf("following a service that isn't there: %v", err)
	}
}

func TestFollowResumesWithoutLosingOrRepeating(t *testing.T) {
	r := &runner{rounds: [][]string{
		{"2026-10-22T03:30:00Z one", "2026-10-22T03:30:01Z two"},
		// after the reconnect the agent hands over the last line again, then a new one
		{"2026-10-22T03:30:01Z two", "2026-10-22T03:30:02Z three"},
	}}
	srv := server(t, r)
	c := &Client{Base: srv.URL, Token: token, RetryMax: 10 * time.Millisecond}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var got []string
	var mu sync.Mutex
	done := make(chan error, 1)
	go func() {
		done <- c.Follow(ctx, LogQuery{Stack: "apps", Service: "api", Tail: 50}, func(l agent.LogLine) {
			mu.Lock()
			got = append(got, l.Line)
			n := len(got)
			mu.Unlock()
			if n == 3 {
				cancel()
			}
		})
	}()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(got, []string{"one", "two", "three"}) {
		t.Errorf("lines = %v", got)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.calls) < 2 {
		t.Fatalf("calls = %v", r.calls)
	}
	first, second := strings.Join(r.calls[0], " "), strings.Join(r.calls[1], " ")
	if !strings.Contains(first, "--tail 50") {
		t.Errorf("the first connection asks for the last lines: %s", first)
	}
	if !strings.Contains(second, "--since 2026-10-22T03:30:01Z") || strings.Contains(second, "--tail") {
		t.Errorf("the reconnection starts where it stopped: %s", second)
	}
}

func TestOldest(t *testing.T) {
	a := time.Date(2026, 1, 1, 0, 0, 2, 0, time.UTC)
	b := time.Date(2026, 1, 1, 0, 0, 1, 0, time.UTC)
	if got := oldest(map[string]time.Time{"api": a, "worker": b}, time.Time{}); !got.Equal(b) {
		t.Errorf("oldest = %v", got)
	}
	start := time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)
	if got := oldest(nil, start); !got.Equal(start) {
		t.Errorf("nothing taken yet: %v", got)
	}
	if got := oldest(nil, time.Time{}); time.Since(got) > time.Minute {
		t.Errorf("nothing taken and no start: %v", got)
	}
}

func TestHostsThatCantBeReached(t *testing.T) {
	dir := t.TempDir()
	ws := filepath.Join(dir, "demo")
	if err := os.MkdirAll(ws, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "workspace.yaml"), []byte("version: 1\nname: demo\nroot: .\nhosts:\n  - id: box\n    type: aws-ssm\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	h := &Hosts{Workspaces: &workspace.Manager{Dir: dir}, Secrets: memStore{}, Tunnels: &Tunnels{}}
	defer h.Tunnels.Close()
	// a host with no aws settings is listed, but can't be reached
	if list := h.List(); len(list) != 1 || list[0].Instance != "" || list[0].TokenSet {
		t.Errorf("hosts = %+v", list)
	}
	if _, err := h.Client("demo", "box"); err == nil || !strings.Contains(err.Error(), "can't reach") {
		t.Errorf("client of a host without aws settings: %v", err)
	}
	// an unknown host is refused everywhere
	for name, err := range map[string]error{
		"get":        func() error { _, e := h.Get("demo", "nope"); return e }(),
		"client":     func() error { _, e := h.Client("demo", "nope"); return e }(),
		"token":      h.SetToken("demo", "nope", token),
		"forget":     h.DeleteToken("demo", "nope"),
		"disconnect": h.Disconnect("demo", "nope"),
	} {
		if !errors.Is(err, ErrNoHost) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if err := h.SetToken("demo", "box", "bad token"); err == nil {
		t.Error("a token with a space in it")
	}
}

type memStore map[string]string

func (m memStore) Get(n string) (secrets.Value, error) {
	v, ok := m[n]
	if !ok {
		return secrets.Value{}, secrets.ErrNotFound
	}
	return secrets.NewValue(v), nil
}
func (m memStore) Set(n string, v secrets.Value) error { m[n] = v.Reveal(); return nil }
func (m memStore) Delete(n string) error               { delete(m, n); return nil }
