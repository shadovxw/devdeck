package api

import (
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/workspace"
)

// editorSetup makes a workspace called demo, with a folder that is not a git repository, and returns the server.
func editorSetup(t *testing.T) (http.Handler, string) {
	t.Helper()
	e := workspaceServer(t)
	code := filepath.Join(t.TempDir(), "code")
	if err := os.MkdirAll(filepath.Join(code, "infra"), 0o755); err != nil {
		t.Fatal(err)
	}
	yaml := "version: 1\nname: demo\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: infra\n    path: infra\n"
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", map[string]string{"yaml": yaml}); rec.Code != http.StatusCreated {
		t.Fatalf("create = %d %s", rec.Code, rec.Body)
	}
	return e, code
}

func TestTheFileComesWithAHashAndItsPath(t *testing.T) {
	e, _ := editorSetup(t)
	rec := do(e, http.MethodGet, "/api/v1/workspaces/demo/file")
	file := decode[workspace.File](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || file.Hash != workspace.Hash([]byte(file.YAML)) || !strings.HasSuffix(filepath.ToSlash(file.Path), "demo/workspace.yaml") {
		t.Fatalf("file = %d %+v", rec.Code, file)
	}
	if rec := do(e, http.MethodGet, "/api/v1/workspaces/nope/file"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown workspace = %d", rec.Code)
	}
}

func TestASaveFromAnOldVersionIsRefusedWithTheFileAsItIsNow(t *testing.T) {
	e, _ := editorSetup(t)
	start := decode[workspace.File](t, do(e, http.MethodGet, "/api/v1/workspaces/demo/file").Body.Bytes())

	mine := start.YAML + "# my note\n"
	rec := postJSON(e, http.MethodPut, "/api/v1/workspaces/demo", map[string]string{"yaml": mine, "base_hash": start.Hash})
	saved := decode[savedResponse](t, rec.Body.Bytes())
	if rec.Code != http.StatusOK || saved.Hash != workspace.Hash([]byte(mine)) || saved.ID != "demo" {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}

	// the file is changed behind the editor's back; a save from the first version is now stale
	if err := os.WriteFile(start.Path, []byte(start.YAML+"# by hand\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	rec = postJSON(e, http.MethodPut, "/api/v1/workspaces/demo", map[string]string{"yaml": mine + "# more\n", "base_hash": saved.Hash})
	conflict := decode[conflictResponse](t, rec.Body.Bytes())
	if rec.Code != http.StatusConflict || !strings.Contains(conflict.YAML, "# by hand") || conflict.Hash != workspace.Hash([]byte(conflict.YAML)) {
		t.Fatalf("stale save = %d %s", rec.Code, rec.Body)
	}
	if now := decode[workspace.File](t, do(e, http.MethodGet, "/api/v1/workspaces/demo/file").Body.Bytes()); strings.Contains(now.YAML, "# more") {
		t.Error("a refused save must not change the file")
	}

	// no hash: no check, as before
	if rec := postJSON(e, http.MethodPut, "/api/v1/workspaces/demo", map[string]string{"yaml": start.YAML}); rec.Code != http.StatusOK {
		t.Errorf("a save with no hash = %d %s", rec.Code, rec.Body)
	}
	// invalid text is a 422 with the issues, as before
	rec = postJSON(e, http.MethodPut, "/api/v1/workspaces/demo", map[string]string{"yaml": "version: 1\nname: demo\n"})
	if rec.Code != http.StatusUnprocessableEntity || len(decode[invalidResponse](t, rec.Body.Bytes()).Issues) == 0 {
		t.Errorf("invalid = %d %s", rec.Code, rec.Body)
	}
}

func TestTheSchemasAreServed(t *testing.T) {
	e := workspaceServer(t)
	for _, kind := range []string{"workspace", "stack", "flow", "log-filters"} {
		rec := do(e, http.MethodGet, "/api/v1/schema/"+kind)
		var schema map[string]any
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &schema) != nil || schema["$schema"] == nil {
			t.Errorf("%s = %d %.80s", kind, rec.Code, rec.Body)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "json") {
			t.Errorf("%s content type = %q", kind, ct)
		}
	}
	if rec := do(e, http.MethodGet, "/api/v1/schema/secrets"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown kind = %d", rec.Code)
	}
	// the workspace schema knows local_only
	if rec := do(e, http.MethodGet, "/api/v1/schema/workspace"); !strings.Contains(rec.Body.String(), "local_only") {
		t.Error("the schema should describe local_only")
	}
}

func TestTheFixesComeWithTheWarning(t *testing.T) {
	e, _ := editorSetup(t)
	d := decode[workspace.Detail](t, do(e, http.MethodGet, "/api/v1/workspaces/demo").Body.Bytes())
	var withFixes int
	for _, i := range d.Issues {
		if i.Code == "repo-not-git" && len(i.Fixes) == 2 {
			withFixes++
		}
	}
	if withFixes != 1 {
		t.Errorf("issues = %+v, want one repo-not-git with two fixes", d.Issues)
	}

	// text that hasn't been saved yet gets the same warning, with its line, from the validate route
	file := decode[workspace.File](t, do(e, http.MethodGet, "/api/v1/workspaces/demo/file").Body.Bytes())
	rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/validate", map[string]any{"kind": "workspace", "workspace_id": "demo", "yaml": file.YAML})
	v := decode[validateResponse](t, rec.Body.Bytes())
	var line int
	for _, i := range v.Issues {
		if i.Code == "repo-not-git" {
			line = i.Line
		}
	}
	if rec.Code != http.StatusOK || line == 0 {
		t.Errorf("validate = %d %+v, want the repo-not-git warning with a line", rec.Code, v.Issues)
	}
}

func TestGitInitRoute(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	e, code := editorSetup(t)
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/demo/repos/infra/git-init", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("git init = %d %s", rec.Code, rec.Body)
	}
	if _, err := os.Stat(filepath.Join(code, "infra", ".git")); err != nil {
		t.Errorf("no .git: %v", err)
	}
	for path, want := range map[string]int{
		"/api/v1/workspaces/demo/repos/infra/git-init":    http.StatusConflict,
		"/api/v1/workspaces/demo/repos/nope/git-init":     http.StatusNotFound,
		"/api/v1/workspaces/ghost/repos/infra/git-init":   http.StatusNotFound,
		"/api/v1/workspaces/acme-shop/repos/api/git-init": http.StatusForbidden,
	} {
		if rec := postJSON(e, http.MethodPost, path, nil); rec.Code != want {
			t.Errorf("%s = %d, want %d", path, rec.Code, want)
		}
	}
}
