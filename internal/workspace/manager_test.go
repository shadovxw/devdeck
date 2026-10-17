package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const examples = "../../examples/workspaces"

const goodYAML = "version: 1\nname: demo\nroot: ~/code\nrepos:\n  - id: api\n    path: api\n"

func newManager(t *testing.T) *Manager {
	t.Helper()
	return &Manager{Dir: filepath.Join(t.TempDir(), "workspaces"), ExamplesDir: examples}
}

func TestListShowsExamplesWithoutPathWarnings(t *testing.T) {
	list := newManager(t).List()
	if len(list) != 1 || list[0].ID != "acme-shop" {
		t.Fatalf("list = %+v", list)
	}
	s := list[0]
	if s.Source != SourceExample || s.Repos != 3 || s.Stacks != 2 || s.Flows != 1 {
		t.Errorf("summary = %+v", s)
	}
	// the example's folders are only illustrations, so they must not be reported as missing
	if s.Errors != 0 || s.Warnings != 0 {
		t.Errorf("the example should be clean, got %d errors and %d warnings", s.Errors, s.Warnings)
	}
}

func TestCreateGetAndNeverOverwrite(t *testing.T) {
	m := newManager(t)

	sum, issues, err := m.Create(goodYAML)
	if err != nil || issues != nil {
		t.Fatalf("Create: %v %v", err, issues)
	}
	if sum.ID != "demo" || sum.Source != SourceLocal || sum.Repos != 1 {
		t.Errorf("summary = %+v", sum)
	}
	if _, err := os.Stat(filepath.Join(m.Dir, "demo", "workspace.yaml")); err != nil {
		t.Errorf("the file wasn't written: %v", err)
	}

	d, err := m.Get("demo")
	if err != nil || d.Workspace == nil || d.Workspace.Name != "demo" {
		t.Fatalf("Get: %v %+v", err, d)
	}
	// it is on this machine, so the missing root is worth a warning
	if d.Warnings == 0 {
		t.Errorf("expected a warning about the missing root folder: %+v", d.Issues)
	}

	if _, _, err := m.Create(goodYAML); !errors.Is(err, ErrExists) {
		t.Errorf("second Create: %v, want ErrExists", err)
	}
	if got := len(m.List()); got != 2 {
		t.Errorf("List has %d, want the example and the new one", got)
	}
}

func TestCreateRefusesInvalidAndUnsafe(t *testing.T) {
	m := newManager(t)

	_, issues, err := m.Create("version: 1\nname: demo\n")
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid", err)
	}
	has(t, issues, 1, SeverityError, `"root" is required`)
	if _, err := os.Stat(filepath.Join(m.Dir, "demo")); err == nil {
		t.Error("nothing may be written for an invalid workspace")
	}

	// a name that tries to leave the folder is rejected by the schema, before any path is built
	for _, name := range []string{"../evil", "..", "a/b", `a\b`, "Bad", "/abs", ""} {
		yaml := "version: 1\nname: \"" + strings.ReplaceAll(name, `\`, `\\`) + "\"\nroot: x\n"
		if _, _, err := m.Create(yaml); !errors.Is(err, ErrInvalid) {
			t.Errorf("name %q: err = %v, want ErrInvalid", name, err)
		}
	}
	if entries, _ := os.ReadDir(filepath.Dir(m.Dir)); len(entries) > 1 {
		t.Errorf("unexpected files next to the workspaces folder: %v", entries)
	}

	if _, _, err := (&Manager{}).Create(goodYAML); !errors.Is(err, ErrNoDir) {
		t.Errorf("no folder configured: %v, want ErrNoDir", err)
	}
}

func TestGetRejectsOddIDs(t *testing.T) {
	m := newManager(t)
	for _, id := range []string{"../etc", "..", "Bad", "a/b", "", "nope"} {
		if _, err := m.Get(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q) = %v, want ErrNotFound", id, err)
		}
	}
}

func TestLocalWorkspaceWinsOverAnExampleOfTheSameName(t *testing.T) {
	m := newManager(t)
	yaml := "version: 1\nname: acme-shop\nroot: ~/mine\n"
	if _, _, err := m.Create(yaml); !errors.Is(err, ErrExists) {
		// the example already uses that name, so creating it is refused
		t.Fatalf("err = %v, want ErrExists", err)
	}

	// but a folder placed there by hand shadows the example
	dir := filepath.Join(m.Dir, "acme-shop")
	must(t, os.MkdirAll(dir, 0o755))
	write(t, filepath.Join(dir, "workspace.yaml"), yaml)
	d, err := m.Get("acme-shop")
	if err != nil || d.Source != SourceLocal || d.Repos != 0 {
		t.Fatalf("Get = %+v, %v", d, err)
	}
}

func TestValidateUsesTheWorkspacesRepos(t *testing.T) {
	m := newManager(t)
	stack := "version: 1\nname: s\nservices:\n  - id: a\n    repo: api\n    kind: go\n  - id: b\n    repo: ghost\n    kind: go\n"

	issues := m.Validate(KindStack, stack, "acme-shop")
	has(t, issues, 8, SeverityError, `no repo with id "ghost"`)
	for _, i := range issues {
		if strings.Contains(i.Message, `"api"`) {
			t.Errorf("api is a real repo in acme-shop, but got: %s", i.Message)
		}
	}

	// without a workspace there are no repo ids to check against
	if issues := m.Validate(KindStack, stack, ""); HasErrors(issues) {
		t.Errorf("no cross-checks expected without a workspace:\n%s", dump(issues))
	}
}

func TestSchemasAreServedForEditors(t *testing.T) {
	for _, k := range []Kind{KindWorkspace, KindStack, KindFlow} {
		raw, err := SchemaJSON(k)
		if err != nil || !strings.Contains(string(raw), `"$schema"`) {
			t.Errorf("schema %s: %v", k, err)
		}
	}
}
