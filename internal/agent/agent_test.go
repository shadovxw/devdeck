package agent

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/compose"
)

// testToken is long enough, and plainly not a real one.
var testToken = strings.Repeat("test", 12)

func sampleConfig() Config {
	return Config{
		Listen:    DefaultListen,
		TokenFile: "/etc/devdeck/token",
		Stacks: []Stack{
			{ID: "infra", Name: "Infrastructure", Dir: "/srv/acme", Files: []string{"compose.infra.yml"}, EnvFiles: []string{".env"}},
			{ID: "apps", Name: "Applications", Dir: "/srv/acme", Files: []string{"compose.apps.yml"}, EnvFiles: []string{".env", "versions.env"}, VersionsFile: "versions.env", AllowWrite: true, After: []string{"infra"}, UpScript: "./dev-up.sh"},
		},
	}
}

func TestValidate(t *testing.T) {
	if err := sampleConfig().Validate(); err != nil {
		t.Fatalf("a good configuration: %v", err)
	}
	for name, tc := range map[string]struct {
		change func(*Config)
		want   string
	}{
		"listening on every address": {func(c *Config) { c.Listen = "0.0.0.0:7071" }, "loopback"},
		"listening on a LAN address": {func(c *Config) { c.Listen = "10.0.0.5:7071" }, "loopback"},
		"no port":                    {func(c *Config) { c.Listen = "127.0.0.1" }, "host:port"},
		"no token file":              {func(c *Config) { c.TokenFile = "" }, "token_file"},
		"no stacks":                  {func(c *Config) { c.Stacks = nil }, "no stack"},
		"a bad id":                   {func(c *Config) { c.Stacks[0].ID = "Infra Stack" }, "lowercase"},
		"an id twice":                {func(c *Config) { c.Stacks[1].ID = "infra"; c.Stacks[1].After = nil }, "used twice"},
		"a relative dir":             {func(c *Config) { c.Stacks[0].Dir = "srv/acme" }, "absolute"},
		"no compose file":            {func(c *Config) { c.Stacks[0].Files = nil }, "compose file"},
		"a file outside dir":         {func(c *Config) { c.Stacks[0].Files = []string{"../other/compose.yml"} }, "inside dir"},
		"an absolute file":           {func(c *Config) { c.Stacks[0].EnvFiles = []string{"/etc/shadow"} }, "inside dir"},
		"a file like an option":      {func(c *Config) { c.Stacks[0].Files = []string{"--project-directory=/"} }, "inside dir"},
		"an up script outside dir":   {func(c *Config) { c.Stacks[1].UpScript = "../../bin/sh" }, "inside dir"},
		"after names nothing":        {func(c *Config) { c.Stacks[1].After = []string{"db"} }, "isn't another stack"},
		"after names itself":         {func(c *Config) { c.Stacks[1].After = []string{"apps"} }, "isn't another stack"},
		"after goes round":           {func(c *Config) { c.Stacks[0].After = []string{"apps"} }, "circle"},
	} {
		c := sampleConfig()
		c.Stacks = slices.Clone(c.Stacks)
		tc.change(&c)
		if err := c.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: %v, want an error about %q", name, err, tc.want)
		}
	}
	for _, ok := range []string{"127.0.0.1:7071", "[::1]:7071"} {
		if err := loopbackOnly(ok); err != nil {
			t.Errorf("%s: %v", ok, err)
		}
	}
}

func TestLoadConfig(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "agent.yaml")
	write := func(s string) {
		if err := os.WriteFile(path, []byte(s), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("token_file: /etc/devdeck/token\nstacks:\n  - id: apps\n    dir: /srv/acme\n    files: [compose.yml]\n")
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Listen != DefaultListen || cfg.Stacks[0].Name != "apps" || cfg.Stacks[0].AllowWrite {
		t.Errorf("defaults: %+v (listen on loopback, name from the id, writes off)", cfg)
	}
	write("token_file: x\nstacks: []\nsurprise: true\n")
	if _, err := LoadConfig(path); err == nil || !strings.Contains(err.Error(), "surprise") {
		t.Errorf("an unknown key must be refused: %v", err)
	}
	if _, err := LoadConfig(filepath.Join(dir, "missing.yaml")); err == nil {
		t.Error("a missing file")
	}
}

func TestTokens(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "token")
	if err := os.WriteFile(path, []byte(testToken+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	tok, err := ReadToken(path)
	if err != nil || string(tok) != testToken {
		t.Fatalf("token = %q, %v", tok, err)
	}
	if err := os.WriteFile(path, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadToken(path); err == nil || !strings.Contains(err.Error(), "too short") {
		t.Errorf("a short token: %v", err)
	}
	if runtime.GOOS != "windows" {
		if err := os.WriteFile(path, []byte(testToken), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadToken(path); err == nil || !strings.Contains(err.Error(), "600") {
			t.Errorf("a token others can read: %v", err)
		}
	}
	if _, err := ReadToken(filepath.Join(dir, "none")); err == nil {
		t.Error("a missing token file")
	}
	a, _ := NewToken()
	b, _ := NewToken()
	if len(a) != 64 || a == b {
		t.Errorf("tokens %q %q", a, b)
	}
	if tokenOK("", nil) || tokenOK(testToken, nil) || !tokenOK(testToken, []byte(testToken)) || tokenOK(testToken[:40], []byte(testToken)) {
		t.Error("tokenOK")
	}
}

// fakeRunner answers Output from a table and streams canned lines.
type fakeRunner struct {
	mu      sync.Mutex
	outputs map[string]string
	lines   map[string][]string // by service: the lines Stream hands over
	failing map[string]error    // by service: Stream ends with this
	hold    bool                // Stream waits for ctx after its lines
	calls   [][]string
}

func (f *fakeRunner) Output(_ context.Context, dir string, args []string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, args)
	if dir != "/srv/acme" {
		return "", errors.New("wrong folder " + dir)
	}
	key := strings.Join(args, " ")
	for k, v := range f.outputs {
		if strings.HasSuffix(key, k) {
			return v, nil
		}
	}
	return "", errors.New("docker compose failed: no such command " + key)
}

func (f *fakeRunner) Stream(ctx context.Context, _ string, args []string, line func(string)) error {
	f.mu.Lock()
	f.calls = append(f.calls, args)
	svc := args[len(args)-1]
	lines, fail, hold := f.lines[svc], f.failing[svc], f.hold
	f.mu.Unlock()
	for _, l := range lines {
		line(l)
	}
	if fail != nil {
		return fail
	}
	if hold {
		<-ctx.Done()
	}
	return nil
}

func (f *fakeRunner) streamCalls() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out [][]string
	for _, c := range f.calls {
		if slices.Contains(c, "--follow") {
			out = append(out, c)
		}
	}
	return out
}

const psJSON = `{"Name":"acme-api","Service":"api","Image":"acme/api:1.2","State":"running","Health":"healthy","Status":"Up 3 minutes"}
{"Name":"acme-worker","Service":"worker","Image":"acme/worker:1","State":"exited","ExitCode":2}`

func newTestAgent(f *fakeRunner) (*Agent, http.Handler) {
	a := New(sampleConfig(), []byte(testToken), f, zerolog.Nop(), "1.2.3")
	return a, a.Handler()
}

func request(h http.Handler, method, target string, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, "http://127.0.0.1:7071"+target, nil)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestTheTokenAndTheHostAreChecked(t *testing.T) {
	_, h := newTestAgent(&fakeRunner{})
	if rec := request(h, http.MethodGet, "/v1/info", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no token = %d", rec.Code)
	}
	if rec := request(h, http.MethodGet, "/v1/info", strings.Repeat("x", 48)); rec.Code != http.StatusUnauthorized {
		t.Errorf("a wrong token = %d", rec.Code)
	}
	req := httptest.NewRequest(http.MethodGet, "http://evil.example/v1/info", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("a foreign Host = %d", rec.Code)
	}
	for _, host := range []string{"localhost:7071", "[::1]:7071", "127.0.0.1"} {
		req := httptest.NewRequest(http.MethodGet, "http://"+host+"/v1/info", nil)
		req.Header.Set("Authorization", "Bearer "+testToken)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Errorf("Host %s = %d", host, rec.Code)
		}
	}
}

func TestInfoNamesTheStacksButNotTheirFolders(t *testing.T) {
	_, h := newTestAgent(&fakeRunner{})
	rec := request(h, http.MethodGet, "/v1/info", testToken)
	var info Info
	if err := json.Unmarshal(rec.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if info.Version != "1.2.3" || info.API != APIVersion || len(info.Stacks) != 2 || info.Stacks[1].ID != "apps" || !info.Stacks[1].AllowWrite || info.Stacks[0].AllowWrite || !slices.Equal(info.Stacks[1].After, []string{"infra"}) {
		t.Errorf("info = %+v", info)
	}
	if strings.Contains(rec.Body.String(), "/srv/acme") || strings.Contains(rec.Body.String(), ".env") {
		t.Errorf("info gives away folders or files: %s", rec.Body)
	}
}

func TestServicesAndComposeView(t *testing.T) {
	f := &fakeRunner{outputs: map[string]string{
		"ps --all --format json":                psJSON,
		"config --format json --no-interpolate": `{"name":"acme","services":{"api":{"image":"${API_IMAGE}","environment":{"SECRET":"value"}}}}`,
	}}
	_, h := newTestAgent(f)

	rec := request(h, http.MethodGet, "/v1/stacks/apps/services", testToken)
	var list []compose.Container
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || rec.Code != http.StatusOK {
		t.Fatalf("services = %d %s", rec.Code, rec.Body)
	}
	if len(list) != 2 || list[0].Health != "healthy" || list[1].ExitCode != 2 {
		t.Errorf("services = %+v", list)
	}
	// the stack's own files and env files are passed to compose
	if got := strings.Join(f.calls[0], " "); got != "compose -f compose.apps.yml --env-file .env --env-file versions.env ps --all --format json" {
		t.Errorf("command = %s", got)
	}

	rec = request(h, http.MethodGet, "/v1/stacks/apps/compose", testToken)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"${API_IMAGE}"`) || !strings.Contains(rec.Body.String(), `"SECRET"`) || strings.Contains(rec.Body.String(), "value") {
		t.Errorf("compose view = %d %s (names of variables, never values)", rec.Code, rec.Body)
	}

	if rec := request(h, http.MethodGet, "/v1/stacks/nope/services", testToken); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown stack = %d", rec.Code)
	}
	f.outputs = map[string]string{}
	if rec := request(h, http.MethodGet, "/v1/stacks/apps/services", testToken); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "docker compose failed") {
		t.Errorf("docker failing = %d %s", rec.Code, rec.Body)
	}
}

// readStream reads log lines until it has n that aren't heartbeats.
func readStream(t *testing.T, body *bufio.Scanner, n int) []LogLine {
	t.Helper()
	var out []LogLine
	for len(out) < n && body.Scan() {
		var l LogLine
		if err := json.Unmarshal(body.Bytes(), &l); err != nil {
			t.Fatalf("not a JSON line: %q", body.Text())
		}
		if !l.Heartbeat {
			out = append(out, l)
		}
	}
	return out
}

func TestLogsOfOneServiceStream(t *testing.T) {
	f := &fakeRunner{
		outputs: map[string]string{"config --services": "api\nworker\n"},
		lines:   map[string][]string{"api": {"2026-10-22T03:30:00.5Z started", "2026-10-22T03:30:01Z listening on :8081"}},
		hold:    true,
	}
	a, h := newTestAgent(f)
	a.heartbeat = 20 * time.Millisecond
	srv := httptest.NewServer(h)
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/v1/stacks/apps/logs?service=api", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK || res.Header.Get("Content-Type") != "application/x-ndjson" {
		t.Fatalf("status %d, type %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	sc := bufio.NewScanner(res.Body)
	got := readStream(t, sc, 2)
	if len(got) != 2 || got[0].Service != "api" || got[0].Line != "started" || !got[0].TS.Equal(time.Date(2026, 10, 22, 3, 30, 0, 500_000_000, time.UTC)) || got[1].Line != "listening on :8081" {
		t.Fatalf("lines = %+v", got)
	}
	// while it waits, heartbeats keep the tunnel busy
	sc.Scan()
	var beat LogLine
	_ = json.Unmarshal(sc.Bytes(), &beat)
	if !beat.Heartbeat {
		t.Errorf("expected a heartbeat, got %s", sc.Text())
	}
	cancel()

	calls := f.streamCalls()
	if len(calls) != 1 || !slices.Contains(calls[0], "--tail") || calls[0][slices.Index(calls[0], "--tail")+1] != "200" || calls[0][len(calls[0])-1] != "api" {
		t.Errorf("follow command = %v (the last 200 lines when no since is given)", calls)
	}
}

func TestLogsOfAWholeStackAndTheirErrors(t *testing.T) {
	f := &fakeRunner{
		outputs: map[string]string{"config --services": "api\nworker\n"},
		lines:   map[string][]string{"api": {"2026-10-22T03:30:00Z a"}, "worker": {"2026-10-22T03:30:00Z w"}},
		failing: map[string]error{"worker": errors.New("docker compose logs ended with code 1: no container")},
	}
	_, h := newTestAgent(f)
	rec := request(h, http.MethodGet, "/v1/stacks/apps/logs?since=2026-10-22T03:00:00Z", testToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("logs = %d %s", rec.Code, rec.Body)
	}
	got := readStream(t, bufio.NewScanner(strings.NewReader(rec.Body.String())), 3)
	seen := map[string]bool{}
	for _, l := range got {
		seen[l.Service+":"+l.Line+l.Error] = true
	}
	if !seen["api:a"] || !seen["worker:w"] || !seen["worker:docker compose logs ended with code 1: no container"] {
		t.Errorf("lines = %+v", got)
	}
	for _, c := range f.streamCalls() {
		if i := slices.Index(c, "--since"); i < 0 || c[i+1] != "2026-10-22T03:00:00Z" || slices.Contains(c, "--tail") {
			t.Errorf("with since, follow from it: %v", c)
		}
	}
}

func TestLogsRefusals(t *testing.T) {
	f := &fakeRunner{outputs: map[string]string{"config --services": "api\n"}}
	_, h := newTestAgent(f)
	for target, want := range map[string]int{
		"/v1/stacks/apps/logs?since=yesterday": http.StatusBadRequest,
		"/v1/stacks/apps/logs?tail=-1":         http.StatusBadRequest,
		"/v1/stacks/apps/logs?tail=99999":      http.StatusBadRequest,
		"/v1/stacks/apps/logs?service=db":      http.StatusNotFound,
		"/v1/stacks/nope/logs":                 http.StatusNotFound,
	} {
		if rec := request(h, http.MethodGet, target, testToken); rec.Code != want {
			t.Errorf("%s = %d, want %d", target, rec.Code, want)
		}
	}
	if len(f.streamCalls()) != 0 {
		t.Error("a refused request must not start a follower")
	}
}
