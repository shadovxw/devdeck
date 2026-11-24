package api

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/scripts"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// cleanGit says every repo is on main, tracking origin/main, with nothing changed.
type cleanGit struct{}

func (cleanGit) Work(context.Context, string) (gitx.Work, error) {
	return gitx.Work{Branch: "main", Upstream: "origin/main"}, nil
}
func (cleanGit) Run(context.Context, string, gitx.Operation) (string, error) { return "ok", nil }

// scriptsFixture is a project "acme" with an api repo (with a package.json) and a local-only
// infra folder, its own script in the file, and the example project next to it.
func scriptsFixture(t *testing.T) (*echo.Echo, *[]string) {
	t.Helper()
	dir := t.TempDir()
	code := filepath.Join(dir, "code")
	for _, d := range []string{"api", "infra"} {
		if err := os.MkdirAll(filepath.Join(code, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(code, "api", "package.json"), []byte(`{"scripts":{"test":"vitest"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	yaml := "version: 1\nname: acme\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n    local_only: true\nscripts:\n  - id: lint\n    title: Lint the API\n    repo: api\n    steps:\n      - run: npm run lint\n"
	m := &workspace.Manager{Dir: filepath.Join(dir, "workspaces"), ExamplesDir: "../../examples/workspaces"}
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("create: %v %v", err, issues)
	}
	var ran []string
	runner := &scripts.Runner{Git: cleanGit{}, Exec: func(_ context.Context, dir string, args []string) (string, error) {
		ran = append(ran, filepath.Base(dir)+": "+strings.Join(args, " "))
		return "done", nil
	}}
	e := echo.New()
	registerScripts(e.Group("/api/v1"), m, runner)
	return e, &ran
}

func TestScriptsAreListedFromEveryPlace(t *testing.T) {
	e, _ := scriptsFixture(t)
	rec := do(e, http.MethodGet, "/api/v1/workspaces/acme/scripts")
	if rec.Code != http.StatusOK {
		t.Fatalf("list = %d (%s)", rec.Code, rec.Body)
	}
	rows := decode[[]scriptRow](t, rec.Body.Bytes())
	got := map[string]string{}
	for _, r := range rows {
		got[r.ID] = r.Source
	}
	want := map[string]string{
		"update-all": scripts.SourceBuiltIn, "sync-dev": scripts.SourceBuiltIn, "status-all": scripts.SourceBuiltIn,
		"lint": scripts.SourceFile, "npm:api:test": scripts.SourcePackage,
	}
	for id, src := range want {
		if got[id] != src {
			t.Errorf("%s: source %q, want %q (all: %v)", id, got[id], src, got)
		}
	}
	for _, r := range rows {
		if r.ID == "status-all" && r.Writes {
			t.Error("status-all reads only, so it shouldn't ask first")
		}
		if r.ID == "sync-dev" && !r.Writes {
			t.Error("sync-dev changes files, so it should ask first")
		}
	}
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/nope/scripts"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown project = %d, want 404", rec.Code)
	}
}

func TestRunningAScript(t *testing.T) {
	e, ran := scriptsFixture(t)
	tests := []struct {
		name   string
		path   string
		body   any
		status int
	}{
		{"a write asks first", "/api/v1/workspaces/acme/scripts/sync-dev/run", nil, http.StatusBadRequest},
		{"an unknown script", "/api/v1/workspaces/acme/scripts/nope/run", map[string]bool{"confirm": true}, http.StatusNotFound},
		{"an example project doesn't run scripts", "/api/v1/workspaces/acme-shop/scripts/status-all/run", nil, http.StatusUnprocessableEntity},
		{"a read-only script runs without asking", "/api/v1/workspaces/acme/scripts/status-all/run", nil, http.StatusAccepted},
		{"a confirmed write runs", "/api/v1/workspaces/acme/scripts/lint/run", map[string]bool{"confirm": true}, http.StatusAccepted},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec := postJSON(e, http.MethodPost, tc.path, tc.body)
			if rec.Code != tc.status {
				t.Fatalf("status = %d (%s), want %d", rec.Code, rec.Body, tc.status)
			}
			if rec.Code != http.StatusAccepted {
				return
			}
			run := decode[scripts.Run](t, rec.Body.Bytes())
			for i := 0; i < 200 && run.State == scripts.StateRunning; i++ {
				time.Sleep(5 * time.Millisecond)
				run = decode[scripts.Run](t, do(e, http.MethodGet, "/api/v1/script-runs/"+run.ID).Body.Bytes())
			}
			if run.State != scripts.StateOK {
				t.Errorf("run = %+v", run)
			}
			// status-all runs in api only: the local-only infra folder isn't a git repository
			if strings.HasSuffix(tc.path, "status-all/run") && (len(run.Repos) != 1 || run.Repos[0].Repo != "api") {
				t.Errorf("repos = %+v, want just api", run.Repos)
			}
		})
	}
	if len(*ran) != 1 || (*ran)[0] != "api: npm run lint" {
		t.Errorf("ran %v, want the lint command in api", *ran)
	}
	if rec := do(e, http.MethodGet, "/api/v1/script-runs/nope"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown run = %d, want 404", rec.Code)
	}
}
