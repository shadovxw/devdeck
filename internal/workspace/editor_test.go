package workspace

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// editorWorkspace is a workspace of the user's own with a repo that has .git, one that has not, and one that is not meant to.
func editorWorkspace(t *testing.T, extra string) (*Manager, string) {
	t.Helper()
	m := newManager(t)
	code := filepath.Join(t.TempDir(), "code")
	must(t, os.MkdirAll(filepath.Join(code, "api", ".git"), 0o755))
	must(t, os.MkdirAll(filepath.Join(code, "infra"), 0o755))
	yaml := "version: 1\nname: demo\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n" + extra
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("Create: %v %v", err, issues)
	}
	return m, code
}

func TestLocalOnlyStopsTheGitWarning(t *testing.T) {
	m, _ := editorWorkspace(t, "")
	d, err := m.Get("demo")
	if err != nil {
		t.Fatal(err)
	}
	var found *Issue
	for i := range d.Issues {
		if d.Issues[i].Code == "repo-not-git" {
			found = &d.Issues[i]
		}
	}
	if found == nil || found.Path != "/repos/1/path" || found.Severity != SeverityWarning {
		t.Fatalf("issues = %+v, want one repo-not-git warning on the second repo", d.Issues)
	}
	if len(found.Fixes) != 2 || found.Fixes[0].ID != "mark-local-only" || found.Fixes[0].Kind != FixEdit || found.Fixes[1].ID != "git-init" || found.Fixes[1].Kind != FixAction {
		t.Errorf("fixes = %+v", found.Fixes)
	}

	local := "version: 1\nname: demo\nroot: " + filepath.ToSlash(d.Workspace.Root) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n    local_only: true\n"
	if _, issues, err := m.Update("demo", local); err != nil || issues != nil {
		t.Fatalf("Update: %v %v", err, issues)
	}
	d, _ = m.Get("demo")
	for _, i := range d.Issues {
		if i.Code == "repo-not-git" {
			t.Errorf("a local_only repo must not warn about .git: %+v", i)
		}
	}
	if !d.Workspace.Repos[1].LocalOnly {
		t.Error("local_only should be read")
	}
}

func TestAFolderThatIsMissingIsStillReportedForALocalOnlyRepo(t *testing.T) {
	m, code := editorWorkspace(t, "  - id: gone\n    path: gone\n    local_only: true\n")
	d, _ := m.Get("demo")
	var codes []string
	for _, i := range d.Issues {
		codes = append(codes, i.Code)
	}
	if !strings.Contains(strings.Join(codes, ","), "repo-folder-missing") {
		t.Errorf("codes = %v (root %s)", codes, code)
	}
}

func TestTheEditorReadsAHashAndNeverOverwritesNewerWork(t *testing.T) {
	m, _ := editorWorkspace(t, "")
	file, err := m.File("demo")
	if err != nil || file.Hash != Hash([]byte(file.YAML)) || !strings.HasSuffix(filepath.ToSlash(file.Path), "demo/workspace.yaml") {
		t.Fatalf("File = %+v, %v", file, err)
	}

	edited := strings.Replace(file.YAML, "path: api\n", "path: api\n    type: go\n", 1)
	_, hash, issues, err := m.UpdateIf("demo", edited, file.Hash)
	if err != nil || issues != nil || hash != Hash([]byte(edited)) {
		t.Fatalf("UpdateIf = %q, %v, %v", hash, issues, err)
	}

	// someone else changes the file; an edit that started from the old version is refused and writes nothing
	other := edited + "# changed by hand\n"
	must(t, os.WriteFile(file.Path, []byte(other), 0o644))
	mine := strings.Replace(edited, "type: go", "type: node", 1)
	if _, _, _, err := m.UpdateIf("demo", mine, file.Hash); !errors.Is(err, ErrConflict) {
		t.Fatalf("a stale save = %v, want ErrConflict", err)
	}
	if now, _ := m.File("demo"); now.YAML != other {
		t.Errorf("a refused save must not change the file:\n%s", now.YAML)
	}

	// an edit that starts from the new version goes through, and without a hash nothing is checked
	now, _ := m.File("demo")
	if _, _, _, err := m.UpdateIf("demo", mine, now.Hash); err != nil {
		t.Errorf("a save from the current version: %v", err)
	}
	if _, _, _, err := m.UpdateIf("demo", edited, ""); err != nil {
		t.Errorf("a save with no hash: %v", err)
	}
	// invalid text is still refused with its issues, hash or not
	if _, _, issues, err := m.UpdateIf("demo", "version: 1\nname: demo\n", ""); !errors.Is(err, ErrInvalid) || len(issues) == 0 {
		t.Errorf("invalid = %v %v", err, issues)
	}
}

func TestGitInitOnlyActsOnAFolderThatExistsAndHasNoGit(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is not installed")
	}
	m, code := editorWorkspace(t, "  - id: gone\n    path: gone\n")

	if err := m.GitInit(context.Background(), "demo", "infra"); err != nil {
		t.Fatalf("GitInit: %v", err)
	}
	if _, err := os.Stat(filepath.Join(code, "infra", ".git")); err != nil {
		t.Errorf("git init didn't make .git: %v", err)
	}
	if err := m.GitInit(context.Background(), "demo", "infra"); !errors.Is(err, ErrHasGit) {
		t.Errorf("again = %v, want ErrHasGit", err)
	}
	if err := m.GitInit(context.Background(), "demo", "api"); !errors.Is(err, ErrHasGit) {
		t.Errorf("a repo = %v, want ErrHasGit", err)
	}
	if err := m.GitInit(context.Background(), "demo", "gone"); !errors.Is(err, ErrNoFolder) {
		t.Errorf("a missing folder = %v, want ErrNoFolder", err)
	}
	if err := m.GitInit(context.Background(), "demo", "nope"); !errors.Is(err, ErrNoRepo) {
		t.Errorf("an unknown repo = %v, want ErrNoRepo", err)
	}
	if err := m.GitInit(context.Background(), "ghost", "api"); !errors.Is(err, ErrNotFound) {
		t.Errorf("an unknown workspace = %v, want ErrNotFound", err)
	}
	if err := m.GitInit(context.Background(), "acme-shop", "api"); !errors.Is(err, ErrReadOnly) {
		t.Errorf("a sample = %v, want ErrReadOnly", err)
	}
}

func TestValidatingTheTextOfAWorkspaceAlsoChecksItsFolders(t *testing.T) {
	m, code := editorWorkspace(t, "")
	head := "version: 1\nname: demo\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: api\n    path: api\n  - id: infra\n    path: infra\n"

	var warned []Issue
	for _, i := range m.Validate(KindWorkspace, head, "demo") {
		if i.Code == "repo-not-git" {
			warned = append(warned, i)
		}
	}
	if len(warned) != 1 || warned[0].Line == 0 || len(warned[0].Fixes) != 2 {
		t.Fatalf("issues = %+v, want one repo-not-git with a line and two fixes", warned)
	}

	for _, i := range m.Validate(KindWorkspace, head+"    local_only: true\n", "demo") {
		if i.Code == "repo-not-git" {
			t.Errorf("a local_only repo must not warn: %+v", i)
		}
	}
	// without a workspace the folders are not looked at
	for _, i := range m.Validate(KindWorkspace, head, "") {
		if i.Code != "" {
			t.Errorf("no workspace, no folder checks: %+v", i)
		}
	}
}
