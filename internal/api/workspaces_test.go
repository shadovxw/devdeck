package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

const goodWorkspace = "version: 1\nname: demo\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n"

func workspaceServer(t *testing.T) *echo.Echo {
	t.Helper()
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard,
		Hub:     NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(),
		Workspaces: &workspace.Manager{
			Dir:         filepath.Join(t.TempDir(), "workspaces"),
			ExamplesDir: "../../examples/workspaces",
		},
	})
	return e
}

func postJSON(h http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	var rdr *strings.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = strings.NewReader(string(b))
	} else {
		rdr = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rdr)
	req.Host = "127.0.0.1:7070"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestWorkspaceRoutesNeedAManager(t *testing.T) {
	if rec := do(newTestServer(t), http.MethodGet, "/api/v1/workspaces"); rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 when no manager is wired", rec.Code)
	}
}

func TestListAndGetWorkspaces(t *testing.T) {
	e := workspaceServer(t)

	rec := do(e, http.MethodGet, "/api/v1/workspaces")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var list []workspace.Summary
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil || len(list) != 1 || list[0].ID != "acme-shop" {
		t.Fatalf("list = %+v (%v)", list, err)
	}

	rec = do(e, http.MethodGet, "/api/v1/workspaces/acme-shop")
	var d workspace.Detail
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil || rec.Code != http.StatusOK || len(d.Stacks) != 2 || d.Issues == nil {
		t.Fatalf("detail = %d %s", rec.Code, rec.Body)
	}

	for _, id := range []string{"nope", "..", "Bad"} {
		if rec := do(e, http.MethodGet, "/api/v1/workspaces/"+id); rec.Code != http.StatusNotFound {
			t.Errorf("GET %q = %d, want 404", id, rec.Code)
		}
	}
}

func TestValidateEndpoint(t *testing.T) {
	e := workspaceServer(t)

	rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/validate", validateRequest{Kind: "workspace", YAML: goodWorkspace})
	var ok validateResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &ok); err != nil || rec.Code != 200 || !ok.Valid || ok.Issues == nil {
		t.Fatalf("good: %d %s", rec.Code, rec.Body)
	}

	rec = postJSON(e, http.MethodPost, "/api/v1/workspaces/validate", validateRequest{Kind: "workspace", YAML: "version: 1\nname: demo\n"})
	var bad validateResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &bad)
	if rec.Code != 200 || bad.Valid || len(bad.Issues) == 0 || bad.Issues[0].Line != 1 {
		t.Fatalf("bad: %d %s", rec.Code, rec.Body)
	}

	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/validate", validateRequest{Kind: "banana"}); rec.Code != 400 {
		t.Errorf("unknown kind = %d, want 400", rec.Code)
	}
}

func TestScanEndpoint(t *testing.T) {
	e := workspaceServer(t)
	root := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(root, "api", ".git"), 0o755))

	rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/scan", scanRequest{Root: root})
	var res workspace.ScanResult
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil || rec.Code != 200 || len(res.Repos) != 1 || res.Repos[0].ID != "api" {
		t.Fatalf("scan: %d %s", rec.Code, rec.Body)
	}

	for body, want := range map[string]int{"": 400, "   ": 400, "relative/dir": 400, filepath.Join(root, "missing"): 422} {
		if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/scan", scanRequest{Root: body}); rec.Code != want {
			t.Errorf("scan %q = %d, want %d (%s)", body, rec.Code, want, rec.Body)
		}
	}
}

func TestCreateEndpoint(t *testing.T) {
	e := workspaceServer(t)

	rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: goodWorkspace})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: goodWorkspace}); rec.Code != http.StatusConflict {
		t.Errorf("second create = %d, want 409", rec.Code)
	}

	rec = postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: "version: 1\nname: other\n"})
	var inv invalidResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &inv)
	if rec.Code != http.StatusUnprocessableEntity || len(inv.Issues) == 0 {
		t.Errorf("invalid create = %d %s", rec.Code, rec.Body)
	}

	if rec := do(e, http.MethodGet, "/api/v1/workspaces/demo"); rec.Code != 200 {
		t.Errorf("created workspace isn't readable: %d", rec.Code)
	}
}

func TestWorkspaceBodyLimit(t *testing.T) {
	e := workspaceServer(t)
	big := strings.Repeat("a", 600*1024)
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/validate", validateRequest{Kind: "workspace", YAML: big}); rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized body = %d, want 413", rec.Code)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
