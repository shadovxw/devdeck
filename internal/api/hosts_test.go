package api

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/remote"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

var hostToken = strings.Repeat("test", 12)

// memSecrets is a keychain in memory.
type memSecrets struct {
	mu sync.Mutex
	m  map[string]string
}

func (s *memSecrets) Get(name string) (secrets.Value, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[name]
	if !ok {
		return secrets.Value{}, secrets.ErrNotFound
	}
	return secrets.NewValue(v), nil
}

func (s *memSecrets) Set(name string, v secrets.Value) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[name] = v.Reveal()
	return nil
}

func (s *memSecrets) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, name)
	return nil
}

// hostRunner is docker on the remote host, as the agent would run it.
type hostRunner struct{}

func (hostRunner) Output(_ context.Context, _ string, args []string) (string, error) {
	switch strings.Join(args[len(args)-2:], " ") {
	case "config --services":
		return "api\n", nil
	case "--format json":
		return `{"Name":"acme-api","Service":"api","Image":"acme/api:1.2","State":"running","Health":"healthy"}`, nil
	case "json --no-interpolate":
		return `{"name":"acme","services":{"api":{"image":"${API_IMAGE}","environment":{"DB_PASSWORD":"x"}}}}`, nil
	}
	return "", errors.New("unexpected")
}

func (hostRunner) Stream(ctx context.Context, _ string, _ []string, line func(string)) error {
	line("2026-10-22T03:30:00Z api started")
	line("2026-10-22T03:30:01Z api ready")
	<-ctx.Done()
	return nil
}

// fakeSSM serves the agent on the local port the tunnel command names, as the real
// port forward would. say makes it fail instead, printing that.
func fakeSSM(say string) remote.Starter {
	cfg := agent.Config{Listen: agent.DefaultListen, TokenFile: "x", Stacks: []agent.Stack{{ID: "apps", Name: "Applications", Dir: "/srv/acme", Files: []string{"compose.yml"}}}}
	h := agent.New(cfg, []byte(hostToken), hostRunner{}, zerolog.Nop(), "1.0.0").Handler()
	return func(ctx context.Context, args []string, line func(string)) error {
		if say != "" {
			line(say)
			return errors.New("aws exited with code 255")
		}
		var p struct {
			Local []string `json:"localPortNumber"`
		}
		_ = json.Unmarshal([]byte(args[slices.Index(args, "--parameters")+1]), &p)
		ln, err := net.Listen("tcp", "127.0.0.1:"+p.Local[0])
		if err != nil {
			return err
		}
		srv := &http.Server{Handler: h, ReadHeaderTimeout: time.Second}
		go func() { _ = srv.Serve(ln) }()
		<-ctx.Done()
		return srv.Close()
	}
}

func hostServer(t *testing.T, say string) (*echo.Echo, *memSecrets) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "demo"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "workspace.yaml"), []byte(`version: 1
name: demo
root: .
hosts:
  - id: dev-box
    name: Dev box
    type: aws-ssm
    aws: {instance: i-0123456789abcdef0, region: ap-south-1, profile: dev}
`), 0o600))
	m := &workspace.Manager{Dir: dir, ExamplesDir: "../../examples/workspaces"}
	store := &memSecrets{m: map[string]string{}}
	tunnels := &remote.Tunnels{Start: fakeSSM(say), OpenWithin: 2 * time.Second}
	t.Cleanup(tunnels.Close)

	guard, err := NewGuard("127.0.0.1:7070", nil)
	must(t, err)
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(), Workspaces: m,
		Hosts: &remote.Hosts{Workspaces: m, Secrets: store, Tunnels: tunnels},
	})
	return e, store
}

func TestHostsListAndToken(t *testing.T) {
	e, store := hostServer(t, "")
	list := decode[[]remote.HostView](t, do(e, http.MethodGet, "/api/v1/hosts").Body.Bytes())
	if len(list) != 1 || list[0].ID != "dev-box" || list[0].Name != "Dev box" || list[0].Instance != "i-0123456789abcdef0" || list[0].Profile != "dev" || list[0].AgentPort != 7071 || list[0].TokenSet || list[0].Tunnel.Open {
		t.Fatalf("hosts = %+v (the sample workspace has none)", list)
	}

	// no token yet: say so, don't open a tunnel
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/info"); rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "devdeck agent token") {
		t.Errorf("info without a token = %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPut, "/api/v1/hosts/demo/dev-box/token", map[string]string{"token": "short"}); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a short token = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, "/api/v1/hosts/demo/nope/token", map[string]string{"token": hostToken}); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown host = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, "/api/v1/hosts/demo/dev-box/token", map[string]string{"token": "  " + hostToken + "\n"}); rec.Code != http.StatusNoContent {
		t.Fatalf("save the token = %d %s", rec.Code, rec.Body)
	}
	if store.m["host/demo/dev-box"] != hostToken {
		t.Errorf("keychain = %v", store.m)
	}
	rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box")
	if v := decode[remote.HostView](t, rec.Body.Bytes()); !v.TokenSet || strings.Contains(rec.Body.String(), hostToken) {
		t.Errorf("after saving: %s (set, and never shown)", rec.Body)
	}

	if rec := do(e, http.MethodDelete, "/api/v1/hosts/demo/dev-box/token"); rec.Code != http.StatusNoContent || len(store.m) != 0 {
		t.Errorf("forget the token = %d, keychain %v", rec.Code, store.m)
	}
}

func TestHostInfoServicesComposeAndLogsThroughTheTunnel(t *testing.T) {
	e, store := hostServer(t, "")
	store.m["host/demo/dev-box"] = hostToken

	rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/info")
	info := decode[agent.Info](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || info.Version != "1.0.0" || len(info.Stacks) != 1 || info.Stacks[0].ID != "apps" {
		t.Fatalf("info = %d %s", rec.Code, rec.Body)
	}
	if v := decode[remote.HostView](t, do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box").Body.Bytes()); !v.Tunnel.Open {
		t.Errorf("the tunnel should be open: %+v", v.Tunnel)
	}
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/services"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"Health":"healthy"`) {
		t.Errorf("services = %d %s", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/compose"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "DB_PASSWORD") || strings.Contains(rec.Body.String(), `"x"`) {
		t.Errorf("compose = %d %s", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/nope/services"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown stack = %d", rec.Code)
	}

	// logs stream until the page goes away
	srv := httptest.NewServer(e)
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/api/v1/hosts/demo/dev-box/stacks/apps/logs?service=api&tail=10", nil)
	req.Host = "127.0.0.1:7070"
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("logs = %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	sc := bufio.NewScanner(res.Body)
	var lines []string
	for len(lines) < 2 && sc.Scan() {
		var l agent.LogLine
		if json.Unmarshal(sc.Bytes(), &l) == nil && l.Line != "" {
			lines = append(lines, l.Service+": "+l.Line)
		}
	}
	if !slices.Equal(lines, []string{"api: api started", "api: api ready"}) {
		t.Errorf("lines = %v", lines)
	}
	cancel()

	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/logs?tail=99999"); rec.Code != http.StatusBadRequest {
		t.Errorf("a bad tail = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, "/api/v1/hosts/demo/dev-box/disconnect", nil); rec.Code != http.StatusNoContent {
		t.Errorf("disconnect = %d", rec.Code)
	}
}

func TestHostErrorsSayWhatToDo(t *testing.T) {
	e, store := hostServer(t, "Error when retrieving token from sso: Token has expired and refresh failed")
	store.m["host/demo/dev-box"] = hostToken
	rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/info")
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "aws sso login --profile dev") {
		t.Errorf("an expired sign-in = %d %s", rec.Code, rec.Body)
	}
	if v := decode[remote.HostView](t, do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box").Body.Bytes()); v.Tunnel.Open || !strings.Contains(v.Tunnel.Error, "aws sso login") {
		t.Errorf("the host shows why: %+v", v.Tunnel)
	}

	// a token the agent doesn't accept
	e, store = hostServer(t, "")
	store.m["host/demo/dev-box"] = strings.Repeat("nope", 12)
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/dev-box/info"); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "save the token again") {
		t.Errorf("a wrong token = %d %s", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, "/api/v1/hosts/demo/nope/info"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown host = %d", rec.Code)
	}
}

func TestHostRefusals(t *testing.T) {
	e, _ := hostServer(t, "")
	for _, tc := range []struct {
		method, path string
		want         int
	}{
		{http.MethodGet, "/api/v1/hosts/demo/nope", http.StatusNotFound},
		{http.MethodDelete, "/api/v1/hosts/demo/nope/token", http.StatusNotFound},
		{http.MethodPost, "/api/v1/hosts/demo/nope/disconnect", http.StatusNotFound},
		{http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/services", http.StatusConflict},
		{http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/compose", http.StatusConflict},
		{http.MethodGet, "/api/v1/hosts/demo/dev-box/stacks/apps/logs", http.StatusConflict},
	} {
		if rec := postJSON(e, tc.method, tc.path, nil); rec.Code != tc.want {
			t.Errorf("%s %s = %d, want %d (%s)", tc.method, tc.path, rec.Code, tc.want, rec.Body)
		}
	}
	req := httptest.NewRequest(http.MethodPut, "/api/v1/hosts/demo/dev-box/token", strings.NewReader("{not json"))
	req.Host = "127.0.0.1:7070"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a body that isn't JSON = %d", rec.Code)
	}
}

func TestTheWebAppIsServedBesideTheAPI(t *testing.T) {
	guard, err := NewGuard("127.0.0.1:7070", nil)
	must(t, err)
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()), Plugins: sdk.NewRegistry(),
		UI: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("the app at " + r.URL.Path)) }),
	})
	if rec := do(e, http.MethodGet, "/stacks"); rec.Code != http.StatusOK || rec.Body.String() != "the app at /stacks" {
		t.Errorf("an app page = %d %q", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, "/api/v1/health"); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Errorf("the API still answers = %d %q", rec.Code, rec.Body)
	}
	// the Host check covers the app too
	req := httptest.NewRequest(http.MethodGet, "http://evil.example/", nil)
	req.Host = "evil.example"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Errorf("the app answered a foreign Host: %d", rec.Code)
	}
	// without a UI, the paths the API doesn't use stay 404
	e2 := echo.New()
	Register(e2, Deps{Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()), Plugins: sdk.NewRegistry()})
	if rec := do(e2, http.MethodGet, "/stacks"); rec.Code != http.StatusNotFound {
		t.Errorf("no UI = %d", rec.Code)
	}
}
