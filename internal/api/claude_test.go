package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/store"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// The Doctor route looks at Claude Code's settings on the machine; tests don't depend on whose.
func init() {
	claudeProbe = func(context.Context) doctor.ClaudeConnector { return doctor.ClaudeConnector{} }
}

// claudeServer is a server with the Claude access page's routes, a real database for the
// audit list and a log store, all in temporary folders.
func claudeServer(t *testing.T) (http.Handler, *Claude) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(context.Background(), filepath.Join(dir, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	logStore, err := logs.Open(logs.Options{Dir: filepath.Join(dir, "logs"), Capacity: 100, FlushEvery: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = logStore.Close() })
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	claude := NewClaude(db.DB, filepath.Join(dir, "claude-access.yaml"))
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins:    sdk.NewRegistry(),
		Workspaces: &workspace.Manager{Dir: filepath.Join(dir, "workspaces")},
		Logs:       logStore,
		Claude:     claude,
	})
	return e, claude
}

func callAPI(h http.Handler, method, path, body string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Host = "127.0.0.1:7070"
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var asClaude = map[string]string{ConnectorHeader: ConnectorClient}

func jsonOf[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("answer isn't the expected JSON (%v): %s", err, rec.Body)
	}
	return v
}

func TestClaudeStateAndSwitches(t *testing.T) {
	e, claude := claudeServer(t)

	st := jsonOf[ClaudeState](t, callAPI(e, http.MethodGet, "/api/v1/claude", "", nil))
	if len(st.Areas) != len(areas) || st.Calls != 0 || st.LastCall != nil {
		t.Fatalf("fresh state = %+v", st)
	}
	want := map[string]bool{AreaWorkspaces: true, AreaLogs: true, AreaGit: true, AreaHosts: false, AreaUI: true}
	for _, a := range st.Areas {
		if a.On != want[a.ID] || a.Default != want[a.ID] || a.Label == "" || a.Description == "" {
			t.Errorf("area %+v, want on=%v", a, want[a.ID])
		}
	}

	rec := callAPI(e, http.MethodPut, "/api/v1/claude/access", `{"hosts":true,"logs":false}`, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT access = %d: %s", rec.Code, rec.Body)
	}
	if !claude.Allowed(AreaHosts) || claude.Allowed(AreaLogs) || !claude.Allowed(AreaGit) {
		t.Error("the switches didn't take: hosts should be on, logs off, git unchanged")
	}
	b, err := os.ReadFile(claude.Path)
	if err != nil || !strings.Contains(string(b), "hosts: true") || !strings.Contains(string(b), "git: true") {
		t.Errorf("the file should hold every area (%v): %s", err, b)
	}
	if info, err := os.Stat(claude.Path); err != nil || info.Mode().Perm()&0o077 != 0 && filepath.Separator == '/' {
		t.Errorf("the file should be private to the user: %v %v", info, err)
	}

	for name, body := range map[string]string{"an unknown area": `{"files":true}`, "nothing": `{}`, "not JSON": `{`, "not a bool": `{"hosts":"yes"}`} {
		if rec := callAPI(e, http.MethodPut, "/api/v1/claude/access", body, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400: %s", name, rec.Code, rec.Body)
		}
	}
	if !claude.Allowed(AreaHosts) {
		t.Error("a refused change altered the file")
	}
}

func TestClaudeCantSwitchItself(t *testing.T) {
	e, claude := claudeServer(t)
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/v1/claude", ""},
		{http.MethodPut, "/api/v1/claude/access", `{"hosts":true}`},
		{http.MethodGet, "/api/v1/claude/calls", ""},
		{http.MethodDelete, "/api/v1/claude/calls", ""},
	} {
		if rec := callAPI(e, tc.method, tc.path, tc.body, asClaude); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as Claude = %d, want 403", tc.method, tc.path, rec.Code)
		}
	}
	if claude.Allowed(AreaHosts) {
		t.Error("Claude switched hosts on for itself")
	}
}

func TestAreaSwitchesDecideWhatTheConnectorGets(t *testing.T) {
	e, _ := claudeServer(t)
	logsPath := "/api/v1/workspaces/demo/stacks/full/logs"
	if rec := callAPI(e, http.MethodGet, logsPath, "", asClaude); rec.Code != http.StatusOK {
		t.Fatalf("logs on by default = %d: %s", rec.Code, rec.Body)
	}
	callAPI(e, http.MethodPut, "/api/v1/claude/access", `{"logs":false}`, nil)
	rec := callAPI(e, http.MethodGet, logsPath, "", asClaude)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "Logs are switched off for Claude") {
		t.Errorf("logs off = %d: %s", rec.Code, rec.Body)
	}
	// Switching an area off changes the connector only: the page keeps reading its own logs.
	if rec := callAPI(e, http.MethodGet, logsPath, "", nil); rec.Code != http.StatusOK {
		t.Errorf("the app's own request = %d, want 200", rec.Code)
	}
	callAPI(e, http.MethodPut, "/api/v1/claude/access", `{"logs":true}`, nil)
	if rec := callAPI(e, http.MethodGet, logsPath, "", asClaude); rec.Code != http.StatusOK {
		t.Errorf("logs back on = %d", rec.Code)
	}
}

func TestAuditListNotesEveryConnectorRequest(t *testing.T) {
	e, claude := claudeServer(t)
	callAPI(e, http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs?level=error&limit=5", "", map[string]string{ConnectorHeader: ConnectorClient, ToolHeader: "query_logs"})
	callAPI(e, http.MethodPost, "/api/v1/workspaces", `{"yaml":"x"}`, map[string]string{ConnectorHeader: ConnectorClient, ToolHeader: "Not A Tool!"})
	callAPI(e, http.MethodGet, "/api/v1/health", "", nil) // the app's own request: not noted

	calls := jsonOf[[]Call](t, callAPI(e, http.MethodGet, "/api/v1/claude/calls", "", nil))
	if len(calls) != 2 {
		t.Fatalf("%d calls, want 2 (the app's own request isn't noted): %+v", len(calls), calls)
	}
	refused, allowed := calls[0], calls[1] // newest first
	if allowed.Tool != "query_logs" || allowed.Method != http.MethodGet || allowed.Path != "/api/v1/workspaces/demo/stacks/full/logs" || allowed.Query != "level=error&limit=5" || allowed.Status != http.StatusOK || allowed.Bytes == 0 || time.Since(allowed.At) > time.Minute {
		t.Errorf("allowed call = %+v", allowed)
	}
	if refused.Tool != "" || refused.Method != http.MethodPost || refused.Status != http.StatusForbidden || strings.Contains(refused.Query, "yaml") {
		t.Errorf("refused call = %+v: a refusal is noted too, an odd tool name is dropped and no body is kept", refused)
	}

	st := jsonOf[ClaudeState](t, callAPI(e, http.MethodGet, "/api/v1/claude", "", nil))
	if st.Calls != 2 || st.LastCall == nil || time.Since(*st.LastCall) > time.Minute {
		t.Errorf("state = %+v", st)
	}

	if rec := callAPI(e, http.MethodGet, "/api/v1/claude/calls?limit=1", "", nil); len(jsonOf[[]Call](t, rec)) != 1 {
		t.Error("limit=1 should give one call")
	}
	for _, bad := range []string{"0", "abc", "1001"} {
		if rec := callAPI(e, http.MethodGet, "/api/v1/claude/calls?limit="+bad, "", nil); rec.Code != http.StatusBadRequest {
			t.Errorf("limit=%s = %d, want 400", bad, rec.Code)
		}
	}
	if rec := callAPI(e, http.MethodDelete, "/api/v1/claude/calls", "", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE calls = %d", rec.Code)
	}
	if got, _ := claude.Calls(10); len(got) != 0 {
		t.Errorf("%d calls left after clearing", len(got))
	}
}

func TestAuditListKeepsTheNewest(t *testing.T) {
	_, claude := claudeServer(t)
	for i := 0; i < maxCalls+25; i++ {
		claude.record(Call{Method: http.MethodGet, Path: "/api/v1/health", Status: 200})
	}
	got, err := claude.Calls(maxCalls + 100)
	if err != nil || len(got) != maxCalls {
		t.Errorf("%d calls kept (%v), want %d", len(got), err, maxCalls)
	}
}

func TestWithoutClaudeNothingIsNotedOrServed(t *testing.T) {
	e, _ := logsServer(t) // no Claude in Deps
	if rec := callAPI(e, http.MethodGet, "/api/v1/claude", "", nil); rec.Code != http.StatusNotFound {
		t.Errorf("/claude without Claude = %d, want 404", rec.Code)
	}
	if rec := callAPI(e, http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs", "", asClaude); rec.Code != http.StatusOK {
		t.Errorf("the connector with the default areas = %d, want 200", rec.Code)
	}
}

func TestUIState(t *testing.T) {
	e, _ := claudeServer(t)
	if s := jsonOf[UISnapshot](t, callAPI(e, http.MethodGet, "/api/v1/ui/state", "", nil)); s.Route != "" || s.At != nil {
		t.Errorf("before anything is reported: %+v", s)
	}

	body := `{"route":"/logs","label":"Logs","params":{"stack":"full","level":"error"},"notice":"The logs couldn't be read"}`
	if rec := callAPI(e, http.MethodPut, "/api/v1/ui/state", body, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT = %d: %s", rec.Code, rec.Body)
	}
	for _, hdr := range []map[string]string{nil, asClaude} {
		s := jsonOf[UISnapshot](t, callAPI(e, http.MethodGet, "/api/v1/ui/state", "", hdr))
		if s.Route != "/logs" || s.Params["level"] != "error" || s.Notice == "" || s.At == nil || time.Since(*s.At) > time.Minute {
			t.Errorf("state (as %v) = %+v", hdr, s)
		}
	}

	callAPI(e, http.MethodPut, "/api/v1/claude/access", `{"ui":false}`, nil)
	if rec := callAPI(e, http.MethodGet, "/api/v1/ui/state", "", asClaude); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "switched off for Claude") {
		t.Errorf("ui off: %d %s", rec.Code, rec.Body)
	}
	if rec := callAPI(e, http.MethodPut, "/api/v1/ui/state", body, asClaude); rec.Code != http.StatusForbidden {
		t.Errorf("Claude reporting a screen of its own = %d, want 403", rec.Code)
	}
}

func TestUIStateRefusals(t *testing.T) {
	e, _ := claudeServer(t)
	many := map[string]string{}
	for i := 0; i < maxParams+1; i++ {
		many[strings.Repeat("k", i+1)] = "v"
	}
	manyJSON, _ := json.Marshal(UISnapshot{Route: "/logs", Params: many})
	tests := map[string]string{
		"no route":          `{"label":"Logs"}`,
		"route not a path":  `{"route":"logs"}`,
		"route too long":    `{"route":"/` + strings.Repeat("a", maxRoute) + `"}`,
		"label too long":    `{"route":"/","label":"` + strings.Repeat("a", maxLabel+1) + `"}`,
		"notice too long":   `{"route":"/","notice":"` + strings.Repeat("a", maxNotice+1) + `"}`,
		"a param too long":  `{"route":"/","params":{"q":"` + strings.Repeat("a", maxParamV+1) + `"}}`,
		"too many params":   string(manyJSON),
		"not JSON":          `{`,
		"body over the cap": `{"route":"/","notice":"` + strings.Repeat("a", 2<<20) + `"}`,
	}
	for name, body := range tests {
		if rec := callAPI(e, http.MethodPut, "/api/v1/ui/state", body, nil); rec.Code < 400 || rec.Code >= 500 {
			t.Errorf("%s = %d, want a 4xx", name, rec.Code)
		}
	}
	if s := jsonOf[UISnapshot](t, callAPI(e, http.MethodGet, "/api/v1/ui/state", "", nil)); s.Route != "" {
		t.Errorf("a refused snapshot was kept: %+v", s)
	}
}
