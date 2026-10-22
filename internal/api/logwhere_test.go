package api

import (
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// whereServer is a server with a local workspace "demo" whose repo "api" has source
// files, a stack "full" with a service "api" and a compose file "infra", and a log store.
func whereServer(t *testing.T) (http.Handler, *logs.Store, string) {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "api")
	must(t, os.MkdirAll(filepath.Join(repo, "cmd", "server"), 0o755))
	must(t, os.WriteFile(filepath.Join(repo, "cmd", "server", "main.go"), []byte("package main\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(repo, "main.go"), []byte("package main\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(repo, "docker-compose.yml"), []byte("services: {}\n"), 0o600))
	other := filepath.Join(root, "other")
	must(t, os.MkdirAll(other, 0o755))
	must(t, os.WriteFile(filepath.Join(other, "secret.go"), []byte("package x\n"), 0o600))

	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "demo", "stacks"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "workspace.yaml"),
		[]byte(fmt.Sprintf("version: 1\nname: demo\nroot: '%s'\nrepos:\n  - id: api\n    path: api\n  - id: other\n    path: other\n", filepath.ToSlash(root))), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "stacks", "full.yaml"),
		[]byte("version: 1\nname: full\ncompose:\n  - id: infra\n    repo: api\n    file: docker-compose.yml\nservices:\n  - id: api\n    repo: api\n    kind: command\n    cmd: echo hi\n"), 0o600))

	store, err := logs.Open(logs.Options{Dir: filepath.Join(t.TempDir(), "logs"), Capacity: 100, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(), Workspaces: &workspace.Manager{Dir: dir, ExamplesDir: filepath.Join("..", "..", "examples", "workspaces")}, Logs: store,
	})
	return e, store, repo
}

func TestResolveCaller(t *testing.T) {
	repo := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(repo, "cmd", "server"), 0o755))
	main := filepath.Join(repo, "cmd", "server", "main.go")
	must(t, os.WriteFile(main, []byte("x"), 0o600))
	top := filepath.Join(repo, "top.go")
	must(t, os.WriteFile(top, []byte("x"), 0o600))
	must(t, os.MkdirAll(filepath.Join(repo, "dir"), 0o755))
	outside := filepath.Join(t.TempDir(), "outside.go")
	must(t, os.WriteFile(outside, []byte("x"), 0o600))

	tests := []struct {
		name, caller string
		file         string
		line         int
		ok           bool
	}{
		{"relative to the repo", "cmd/server/main.go:14", main, 14, true},
		{"absolute inside the repo", filepath.ToSlash(main) + ":7", main, 7, true},
		{"an absolute path from another machine, matched by its tail", "/work/acme/cmd/server/main.go:3", main, 3, true},
		{"a bare file name in the repo", "top.go:9", top, 9, true},
		{"a bare file name that isn't in the repo", "elsewhere.go:9", "", 0, false},
		{"a tail of one name is too little from another machine", "/work/acme/top.go:9", "", 0, false},
		{"a file outside the repo", filepath.ToSlash(outside) + ":1", "", 0, false},
		{"leaving the repo with ..", "../outside.go:1", "", 0, false},
		{"a folder is not a file", "dir:3", "", 0, false},
		{"no line", "cmd/server/main.go", "", 0, false},
		{"a bad line", "cmd/server/main.go:x", "", 0, false},
		{"line zero", "cmd/server/main.go:0", "", 0, false},
		{"nothing", "", "", 0, false},
		{"a null byte", "cmd/server/main.go\x00:1", "", 0, false},
		{"too long", strings.Repeat("a/", maxCallerLen) + ":1", "", 0, false},
	}
	for _, tc := range tests {
		got, ok := resolveCaller(repo, tc.caller)
		if ok != tc.ok || (ok && (got.File != tc.file || got.Line != tc.line)) {
			t.Errorf("%s: %q gave %+v, %v; want %s:%d %v", tc.name, tc.caller, got, ok, tc.file, tc.line, tc.ok)
		}
	}
}

func TestWhereRoute(t *testing.T) {
	e, _, repo := whereServer(t)
	base := "/api/v1/workspaces/demo/stacks/full/logs/where"

	rec := do(e, http.MethodGet, base+"?service=api&caller="+url.QueryEscape("cmd/server/main.go:14"))
	if rec.Code != http.StatusOK {
		t.Fatalf("where = %d %s", rec.Code, rec.Body)
	}
	if got := decode[whereResponse](t, rec.Body.Bytes()); got.File != filepath.Join(repo, "cmd", "server", "main.go") || got.Line != 14 {
		t.Errorf("where = %+v", got)
	}
	// a compose container is looked up in its compose file's repo
	if rec := do(e, http.MethodGet, base+"?service="+url.QueryEscape("infra/keycloak")+"&caller="+url.QueryEscape("main.go:2")); rec.Code != http.StatusOK {
		t.Errorf("a container's caller = %d %s", rec.Code, rec.Body)
	}
	for name, u := range map[string]string{
		"a file of another repo": base + "?service=api&caller=" + url.QueryEscape("../other/secret.go:1"),
		"an unknown service":     base + "?service=nope&caller=" + url.QueryEscape("main.go:1"),
		"no service":             base + "?caller=" + url.QueryEscape("main.go:1"),
		"an unknown container":   base + "?service=" + url.QueryEscape("nope/x") + "&caller=" + url.QueryEscape("main.go:1"),
		"a missing file":         base + "?service=api&caller=" + url.QueryEscape("cmd/server/gone.go:1"),
		"an unknown workspace":   "/api/v1/workspaces/nope/stacks/full/logs/where?service=api&caller=main.go:1",
		"a sample workspace":     "/api/v1/workspaces/acme-shop/stacks/full/logs/where?service=api&caller=main.go:1",
		"an unknown stack":       "/api/v1/workspaces/demo/stacks/nope/logs/where?service=api&caller=main.go:1",
	} {
		if rec := do(e, http.MethodGet, u); rec.Code != http.StatusNotFound {
			t.Errorf("%s = %d, want 404", name, rec.Code)
		}
	}
}

func TestClearAndHistogramRoutes(t *testing.T) {
	e, store, _ := whereServer(t)
	base := "/api/v1/workspaces/demo/stacks/full/logs"
	now := time.Now()
	for i, lvl := range []string{"info", "error", "error"} {
		if _, err := store.Append(logs.Entry{Time: now.Add(-time.Duration(i) * time.Minute), Workspace: "demo", Stack: "full", Service: "api", Stream: "stdout", Text: "x", Level: lvl}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.Append(logs.Entry{Time: now, Workspace: "demo", Stack: "full", Service: "web", Stream: "stdout", Text: "y", Level: "warn"}); err != nil {
		t.Fatal(err)
	}

	rec := do(e, http.MethodGet, base+"/histogram?since=1h")
	if rec.Code != http.StatusOK {
		t.Fatalf("histogram = %d %s", rec.Code, rec.Body)
	}
	h := decode[logs.Histogram](t, rec.Body.Bytes())
	total := map[string]int{}
	for _, b := range h.Buckets {
		for l, n := range b.Counts {
			total[l] += n
		}
	}
	if h.Total != 4 || total["error"] != 2 || total["info"] != 1 || total["warn"] != 1 || h.BucketSeconds != 60 {
		t.Errorf("histogram = total %d %v, %ds buckets", h.Total, total, h.BucketSeconds)
	}
	h = decode[logs.Histogram](t, do(e, http.MethodGet, base+"/histogram?since=1h&service=web").Body.Bytes())
	if h.Total != 1 {
		t.Errorf("filtered histogram total = %d", h.Total)
	}
	for u, want := range map[string]int{
		base + "/histogram?regex=%28":                        http.StatusBadRequest,
		base + "/histogram?since=1h&until=2h":                http.StatusBadRequest,
		base + "/histogram?service=..%2Fx":                   http.StatusNotFound,
		"/api/v1/workspaces/DEMO/stacks/full/logs/histogram": http.StatusNotFound,
	} {
		if rec := do(e, http.MethodGet, u); rec.Code != want {
			t.Errorf("%s = %d, want %d", u, rec.Code, want)
		}
	}

	// clear one service, then the rest
	if rec := do(e, http.MethodDelete, base+"?service=api"); rec.Code != http.StatusOK {
		t.Fatalf("clear api = %d %s", rec.Code, rec.Body)
	}
	left := decode[logs.Result](t, do(e, http.MethodGet, base).Body.Bytes())
	if len(left.Entries) != 1 || left.Entries[0].Service != "web" {
		t.Errorf("after clearing api: %+v", left.Entries)
	}
	if rec := do(e, http.MethodDelete, base); rec.Code != http.StatusOK {
		t.Fatalf("clear all = %d", rec.Code)
	}
	if left := decode[logs.Result](t, do(e, http.MethodGet, base).Body.Bytes()); len(left.Entries) != 0 {
		t.Errorf("after clearing all: %+v", left.Entries)
	}
	for u, want := range map[string]int{
		base + "?service=..%2Fx":                   http.StatusNotFound,
		"/api/v1/workspaces/nope/stacks/full/logs": http.StatusNotFound,
	} {
		if rec := do(e, http.MethodDelete, u); rec.Code != want {
			t.Errorf("DELETE %s = %d, want %d", u, rec.Code, want)
		}
	}
}
