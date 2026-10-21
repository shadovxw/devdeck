package api

import (
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
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

// logsServer is a server with a workspace manager and a log store in temporary folders.
func logsServer(t *testing.T) (http.Handler, *logs.Store) {
	t.Helper()
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
		Plugins:    sdk.NewRegistry(),
		Workspaces: &workspace.Manager{Dir: filepath.Join(t.TempDir(), "workspaces")},
		Logs:       store,
	})
	return e, store
}

func put(t *testing.T, store *logs.Store, service, text string) logs.Entry {
	t.Helper()
	e, err := store.Append(logs.Entry{Time: time.Now(), Workspace: "demo", Stack: "full", Service: service, Stream: "stdout", Text: text})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestLogRoutesNeedAStore(t *testing.T) {
	e := workspaceServer(t) // workspaces, but no log store
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs"); rec.Code != http.StatusNotFound {
		t.Errorf("logs without a store = %d, want 404", rec.Code)
	}
}

func TestReadLogs(t *testing.T) {
	e, store := logsServer(t)
	base := "/api/v1/workspaces/demo/stacks/full/logs"

	if rec := do(e, http.MethodGet, base); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"entries":[]`) {
		t.Fatalf("empty = %d %s", rec.Code, rec.Body)
	}

	for i := 1; i <= 5; i++ {
		put(t, store, "api", "a"+string(rune('0'+i)))
	}
	put(t, store, "web", "w1")

	res := decode[logs.Result](t, do(e, http.MethodGet, base+"?limit=3").Body.Bytes())
	if len(res.Entries) != 3 || res.Entries[2].Text != "w1" || res.NextBefore == 0 {
		t.Fatalf("newest = %+v", res)
	}
	older := decode[logs.Result](t, do(e, http.MethodGet, base+"?limit=2&before="+itoa(res.NextBefore)).Body.Bytes())
	if len(older.Entries) != 2 || older.Entries[0].Text != "a2" || older.Entries[1].Text != "a3" {
		t.Errorf("older = %+v", older)
	}
	newer := decode[logs.Result](t, do(e, http.MethodGet, base+"?after="+itoa(older.Entries[1].Seq)).Body.Bytes())
	if len(newer.Entries) != 3 || newer.Entries[0].Text != "a4" {
		t.Errorf("newer = %+v", newer)
	}
	web := decode[logs.Result](t, do(e, http.MethodGet, base+"?service=web").Body.Bytes())
	if len(web.Entries) != 1 || web.Entries[0].Service != "web" {
		t.Errorf("web = %+v", web)
	}
}

func itoa(n uint64) string { return strconv.FormatUint(n, 10) }

func TestReadLogsRefusals(t *testing.T) {
	e, _ := logsServer(t)
	base := "/api/v1/workspaces/demo/stacks/full/logs"
	for url, want := range map[string]int{
		base + "?limit=0":                                      http.StatusBadRequest,
		base + "?limit=lots":                                   http.StatusBadRequest,
		base + "?before=x":                                     http.StatusBadRequest,
		base + "?after=-1":                                     http.StatusBadRequest,
		base + "?service=..%2F..%2Fetc":                        http.StatusNotFound,
		"/api/v1/workspaces/DEMO/stacks/full/logs":             http.StatusNotFound,
		"/api/v1/workspaces/demo/stacks/Full%20Stack/logs":     http.StatusNotFound,
		"/api/v1/workspaces/demo/stacks/full/logs?service=A/b": http.StatusNotFound,
	} {
		if rec := do(e, http.MethodGet, url); rec.Code != want {
			t.Errorf("GET %s = %d, want %d (%s)", url, rec.Code, want, rec.Body)
		}
	}
}

func TestCaptureRoutes(t *testing.T) {
	e, store := logsServer(t)
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: goodWorkspace}); rec.Code != http.StatusCreated {
		t.Fatalf("create workspace = %d", rec.Code)
	}
	base := "/api/v1/workspaces/demo/stacks/full/logs/capture"
	svc := "?service=" + url.QueryEscape("compose-kc/keycloak")

	store.SetDefaults("demo", "full", map[string]logs.Rule{"api": {Store: logs.StoreMatching, Match: "ERROR"}})
	list := decode[[]logs.CaptureInfo](t, do(e, http.MethodGet, base).Body.Bytes())
	if len(list) != 1 || list[0].Service != "api" || list[0].Source != logs.SourceFile {
		t.Errorf("list = %+v", list)
	}

	// pause a compose container
	rec := postJSON(e, http.MethodPut, base+svc, logs.Rule{Store: logs.StoreOff})
	if got := decode[logs.CaptureInfo](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.Store != logs.StoreOff || got.Source != logs.SourceOverride || got.Service != "compose-kc/keycloak" {
		t.Fatalf("put = %d %+v", rec.Code, got)
	}
	if store.Accept("demo", "full", "compose-kc/keycloak", "anything") {
		t.Error("a paused service must not store")
	}
	// a rule with a pattern
	if rec := postJSON(e, http.MethodPut, base+svc, logs.Rule{Store: logs.StoreMatching, Match: "WARN"}); rec.Code != http.StatusOK {
		t.Errorf("matching = %d %s", rec.Code, rec.Body)
	}
	// and back to the file's rule (here: nothing says otherwise, so everything)
	rec = do(e, http.MethodDelete, base+svc)
	if got := decode[logs.CaptureInfo](t, rec.Body.Bytes()); rec.Code != http.StatusOK || got.Source != logs.SourceDefault || got.Store != logs.StoreAll {
		t.Errorf("delete = %d %+v", rec.Code, got)
	}

	// rules that can't work, and names that can't be used
	for _, bad := range []logs.Rule{{Store: "sometimes"}, {Store: logs.StoreMatching}, {Store: logs.StoreMatching, Match: "("}, {Store: logs.StoreOff, Match: "x"}} {
		if rec := postJSON(e, http.MethodPut, base+svc, bad); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("rule %+v = %d, want 422 (%s)", bad, rec.Code, rec.Body)
		}
	}
	if rec := postJSON(e, http.MethodPut, base, logs.Rule{Store: logs.StoreOff}); rec.Code != http.StatusNotFound {
		t.Errorf("no service = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, base+"?service=..%2Fx", logs.Rule{Store: logs.StoreOff}); rec.Code != http.StatusNotFound {
		t.Errorf("bad service = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, "/api/v1/workspaces/ghost/stacks/full/logs/capture"+svc, logs.Rule{Store: logs.StoreOff}); rec.Code != http.StatusNotFound {
		t.Errorf("unknown workspace = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPut, base+svc, "not an object"); rec.Code != http.StatusBadRequest {
		t.Errorf("bad body = %d, want 400", rec.Code)
	}
}
