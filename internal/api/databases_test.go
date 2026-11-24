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

func TestProjectDatabases(t *testing.T) {
	dir := t.TempDir()
	code := filepath.Join(dir, "code")
	write := func(rel, text string) {
		p := filepath.Join(code, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("infra/docker-compose.yml", "services:\n  db:\n    image: postgres:16\n    ports: [\"55432:5432\"]\n    environment:\n      POSTGRES_DB: shop\n      POSTGRES_PASSWORD: s3cret\n")
	write("api/.env", "DATABASE_URL=postgres://app:s3cret@localhost:55432/shop\n")
	m := &workspace.Manager{Dir: filepath.Join(dir, "workspaces")}
	yaml := "version: 1\nname: shop\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n    local_only: true\n"
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("create: %v %v", err, issues)
	}
	stack := "version: 1\nname: full\ncompose:\n  repo: infra\n  file: docker-compose.yml\n  services: [db]\nservices:\n  - id: api\n    repo: api\n    kind: command\n    cmd: echo hi\n"
	stacks := filepath.Join(dir, "workspaces", "shop", "stacks")
	if err := os.MkdirAll(stacks, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(stacks, "full.yaml"), []byte(stack), 0o600); err != nil {
		t.Fatal(err)
	}

	e := echo.New()
	registerDatabases(e.Group("/api/v1"), m)
	rec := do(e, http.MethodGet, "/api/v1/workspaces/shop/databases")
	if rec.Code != http.StatusOK {
		t.Fatalf("databases = %d (%s)", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "s3cret") || strings.Contains(rec.Body.String(), "app:") {
		t.Fatalf("the response holds a password: %s", rec.Body)
	}
	rep := decode[databases.Report](t, rec.Body.Bytes())
	if len(rep.Databases) != 1 {
		t.Fatalf("databases = %+v, want the compose db", rep.Databases)
	}
	db := rep.Databases[0]
	if db.ID != "db" || db.Engine != databases.Postgres || db.Port != 55432 || db.Name != "shop" || len(db.UsedBy) != 1 || db.UsedBy[0] != "api" || db.Where != "infra/docker-compose.yml · db" {
		t.Errorf("db = %+v", db)
	}
	if db.Status != "up" && db.Status != "down" {
		t.Errorf("status = %q, want up or down for this machine", db.Status)
	}
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/nope/databases"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown project = %d, want 404", rec.Code)
	}
}
