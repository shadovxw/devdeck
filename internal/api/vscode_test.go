package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/workspace"
)

func TestProjectVSCode(t *testing.T) {
	dir := t.TempDir()
	code := filepath.Join(dir, "code")
	if err := os.MkdirAll(filepath.Join(code, "api"), 0o755); err != nil {
		t.Fatal(err)
	}
	m := &workspace.Manager{Dir: filepath.Join(dir, "workspaces")}
	yaml := "version: 1\nname: shop\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n"
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("create: %v %v", err, issues)
	}
	e := echo.New()
	registerVSCode(e.Group("/api/v1"), m)
	want := filepath.Join(code, "shop.code-workspace")

	steps := []struct {
		name, method string
		body         any
		code         int
		state        string
	}{
		{name: "preview before any file", method: http.MethodGet, code: http.StatusOK, state: "new"},
		{name: "write without confirm", method: http.MethodPost, body: map[string]bool{}, code: http.StatusBadRequest},
		{name: "write", method: http.MethodPost, body: map[string]bool{"confirm": true}, code: http.StatusOK, state: "same"},
		{name: "preview after", method: http.MethodGet, code: http.StatusOK, state: "same"},
	}
	for _, s := range steps {
		var rec = do(e, s.method, "/api/v1/workspaces/shop/vscode")
		if s.method == http.MethodPost {
			rec = postJSON(e, s.method, "/api/v1/workspaces/shop/vscode", s.body)
		}
		if rec.Code != s.code {
			t.Fatalf("%s = %d (%s), want %d", s.name, rec.Code, rec.Body, s.code)
		}
		if s.state == "" {
			continue
		}
		f := decode[vscodeFile](t, rec.Body.Bytes())
		if f.State != s.state || f.Path != want || !strings.Contains(f.Content, `"devdeck: Update everything"`) {
			t.Errorf("%s: %s %s %.120s", s.name, f.State, f.Path, f.Content)
		}
	}
	if _, err := os.Stat(want); err != nil {
		t.Errorf("file not written: %v", err)
	}
	if err := os.WriteFile(want, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if f := decode[vscodeFile](t, do(e, http.MethodGet, "/api/v1/workspaces/shop/vscode").Body.Bytes()); f.State != "changed" {
		t.Errorf("an edited file = %q, want changed", f.State)
	}
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/nope/vscode"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown project = %d", rec.Code)
	}
}
