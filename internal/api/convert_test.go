package api

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/databases"
	"github.com/shadovxw/devdeck/internal/workspace"
)

func TestConvertToProjectYAML(t *testing.T) {
	dir := t.TempDir()
	code := filepath.Join(dir, "code")
	write := func(p, text string) {
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(code, "infra", "docker-compose.yml"), "services:\n  db:\n    image: postgres:16\n    ports: [\"55432:5432\"]\n")
	write(filepath.Join(code, "api", ".git", "HEAD"), "ref: refs/heads/main\n")
	write(filepath.Join(code, "api", ".env"), "DATABASE_URL=postgres://app:s3cret@localhost:55432/shop\n")
	m := &workspace.Manager{Dir: filepath.Join(dir, "workspaces")}
	yaml := "version: 1\nname: shop\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n    local_only: true\n"
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("create: %v %v", err, issues)
	}
	write(filepath.Join(dir, "workspaces", "shop", "stacks", "full.yaml"),
		"version: 1\nname: full\ncompose:\n  repo: infra\n  file: docker-compose.yml\nservices:\n  - id: api\n    repo: api\n    kind: command\n    cmd: echo hi\n")

	e := echo.New()
	v1 := e.Group("/api/v1")
	registerConvert(v1, m)
	registerDatabases(v1, m)
	const path = "/api/v1/workspaces/shop/convert"

	rec := do(e, http.MethodGet, path)
	if rec.Code != http.StatusOK {
		t.Fatalf("preview = %d %s", rec.Code, rec.Body)
	}
	conv := decode[workspace.Conversion](t, rec.Body.Bytes())
	if len(conv.Issues) != 0 || !strings.Contains(conv.YAML, "compose: db") || !strings.Contains(conv.YAML, "- name: full") || strings.Contains(conv.YAML, "s3cret") {
		t.Fatalf("preview: %+v", conv)
	}

	if rec := postJSON(e, http.MethodPost, path, map[string]bool{}); rec.Code != http.StatusBadRequest {
		t.Errorf("without confirm = %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, path, map[string]bool{"confirm": true}); rec.Code != http.StatusOK {
		t.Fatalf("convert = %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(dir, "workspaces", "shop", "project.yaml")); err != nil {
		t.Fatalf("no project.yaml: %v", err)
	}
	if rec := do(e, http.MethodGet, path); rec.Code != http.StatusConflict {
		t.Errorf("second preview = %d, want 409", rec.Code)
	}

	// After: the database comes from the file's declaration, the same one as before.
	rep := decode[databases.Report](t, do(e, http.MethodGet, "/api/v1/workspaces/shop/databases").Body.Bytes())
	if len(rep.Databases) != 1 || rep.Databases[0].ID != "db" || rep.Databases[0].From != databases.FromCompose || rep.Databases[0].UsedBy[0] != "api" {
		t.Errorf("databases after = %+v", rep.Databases)
	}
}
