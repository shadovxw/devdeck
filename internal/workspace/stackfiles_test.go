package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const goodStack = "version: 1\nname: web\nservices:\n  - id: web\n    repo: api\n    kind: command\n    cmd: echo hi\n"

// stackManager is a manager with one local workspace "demo" (a repo "api") and no stacks.
func stackManager(t *testing.T) *Manager {
	t.Helper()
	m := newManager(t)
	if _, _, err := m.Create(goodYAML); err != nil {
		t.Fatal(err)
	}
	return m
}

func stackPath(m *Manager, name string) string {
	return filepath.Join(m.Dir, "demo", "stacks", name)
}

func TestCreateStackSavesUnderItsOwnName(t *testing.T) {
	m := stackManager(t)

	st, issues, err := m.CreateStack("demo", goodStack)
	if err != nil {
		t.Fatalf("CreateStack: %v %v", err, issues)
	}
	if st.Name != "web" || st.File != "stacks/web.yaml" {
		t.Errorf("stack = %+v", st)
	}
	got, err := os.ReadFile(stackPath(m, "web.yaml"))
	if err != nil || string(got) != goodStack {
		t.Errorf("file = %q, %v: it should be saved exactly as written", got, err)
	}
	if d, err := m.Get("demo"); err != nil || len(d.Stacks) != 1 || d.Stacks[0].Name != "web" {
		t.Errorf("the workspace should list it: %v %+v", err, d)
	}
	if text, err := m.StackYAML("demo", "web"); err != nil || text != goodStack {
		t.Errorf("StackYAML = %q, %v", text, err)
	}
}

func TestCreateStackRefusals(t *testing.T) {
	m := stackManager(t)
	if _, _, err := m.CreateStack("demo", goodStack); err != nil {
		t.Fatal(err)
	}
	// a stack that is loaded under another file name still holds its name
	if err := os.WriteFile(stackPath(m, "other.yaml"), []byte(strings.Replace(goodStack, "name: web", "name: other-name", 1)), 0o600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		ws   string
		yaml string
		want error
	}{
		{"name taken", "demo", goodStack, ErrStackExists},
		{"name taken by a file with another name", "demo", strings.Replace(goodStack, "name: web", "name: other-name", 1), ErrStackExists},
		{"errors in the yaml", "demo", "version: 1\nname: x\nservices:\n  - id: a\n    repo: ghost\n    kind: go\n", ErrInvalid},
		{"not yaml", "demo", "a: [", ErrInvalid},
		{"empty", "demo", "", ErrInvalid},
		{"nothing to run", "demo", "version: 1\nname: empty\n", ErrInvalid},
		{"a sample workspace", "acme-shop", goodStack, ErrReadOnly},
		{"no such workspace", "ghost", goodStack, ErrNotFound},
		{"a path as workspace id", "../demo", goodStack, ErrNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, issues, err := m.CreateStack(tc.ws, tc.yaml)
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if tc.want == ErrInvalid && len(issues) == 0 {
				t.Error("an invalid stack should say what is wrong")
			}
		})
	}

	entries, _ := os.ReadDir(filepath.Join(m.Dir, "demo", "stacks"))
	if len(entries) != 2 {
		t.Errorf("nothing else should have been written: %v", entries)
	}
}

func TestCreateStackNameCannotEscapeTheStacksFolder(t *testing.T) {
	m := stackManager(t)
	for _, name := range []string{"../evil", "a/b", `a\b`, "..", "Web", ""} {
		src := "version: 1\nname: \"" + name + "\"\nservices:\n  - id: a\n    repo: api\n    kind: go\n"
		if _, _, err := m.CreateStack("demo", src); !errors.Is(err, ErrInvalid) {
			t.Errorf("name %q: %v, want ErrInvalid", name, err)
		}
	}
	if _, err := os.Stat(filepath.Join(m.Dir, "demo", "evil.yaml")); err == nil {
		t.Error("a file escaped the stacks folder")
	}
}

func TestUpdateStackReplacesInPlace(t *testing.T) {
	m := stackManager(t)
	if _, _, err := m.CreateStack("demo", goodStack); err != nil {
		t.Fatal(err)
	}
	// the stack lives in a file with a different name, as the loader allows
	if err := os.Rename(stackPath(m, "web.yaml"), stackPath(m, "frontend.yaml")); err != nil {
		t.Fatal(err)
	}

	next := strings.Replace(goodStack, "echo hi", "echo changed", 1)
	st, _, err := m.UpdateStack("demo", "web", next)
	if err != nil || st.File != "stacks/frontend.yaml" {
		t.Fatalf("UpdateStack: %v %+v", err, st)
	}
	got, _ := os.ReadFile(stackPath(m, "frontend.yaml"))
	if string(got) != next {
		t.Errorf("file = %q", got)
	}
	entries, _ := os.ReadDir(filepath.Join(m.Dir, "demo", "stacks"))
	if len(entries) != 1 {
		t.Errorf("no temp or extra files should be left: %v", entries)
	}
}

func TestUpdateStackRefusals(t *testing.T) {
	m := stackManager(t)
	if _, _, err := m.CreateStack("demo", goodStack); err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name  string
		ws    string
		stack string
		yaml  string
		want  error
	}{
		{"renamed inside", "demo", "web", strings.Replace(goodStack, "name: web", "name: webby", 1), ErrRename},
		{"errors", "demo", "web", "version: 1\nname: web\nservices:\n  - id: a\n    repo: ghost\n    kind: go\n", ErrInvalid},
		{"no such stack", "demo", "ghost", goodStack, ErrStackNotFound},
		{"sample", "acme-shop", "full", goodStack, ErrReadOnly},
		{"no such workspace", "ghost", "web", goodStack, ErrNotFound},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, _, err := m.UpdateStack(tc.ws, tc.stack, tc.yaml); !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
		})
	}
	if got, _ := os.ReadFile(stackPath(m, "web.yaml")); string(got) != goodStack {
		t.Errorf("a refused update must leave the file alone, got %q", got)
	}
}

func TestDeleteStackMovesItToTrash(t *testing.T) {
	m := stackManager(t)
	for range 2 {
		if _, _, err := m.CreateStack("demo", goodStack); err != nil {
			t.Fatal(err)
		}
		if err := m.DeleteStack("demo", "web"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Stat(stackPath(m, "web.yaml")); err == nil {
		t.Error("the file should be gone from stacks/")
	}
	trash, _ := os.ReadDir(filepath.Join(m.Dir, "demo", ".trash", "stacks"))
	if len(trash) != 2 {
		t.Errorf("two deletes in the same second must both be kept: %v", trash)
	}
	if d, _ := m.Get("demo"); len(d.Stacks) != 0 {
		t.Errorf("trashed stacks must not be listed: %+v", d.Stacks)
	}
	// and the trash folder is not mistaken for a workspace
	if list := m.List(); len(list) != 2 { // demo and the sample
		t.Errorf("list = %+v", list)
	}
}

func TestDeleteStackRefusals(t *testing.T) {
	m := stackManager(t)
	for _, tc := range []struct {
		ws, stack string
		want      error
	}{
		{"demo", "ghost", ErrStackNotFound},
		{"acme-shop", "full", ErrReadOnly},
		{"ghost", "web", ErrNotFound},
		{"../demo", "web", ErrNotFound},
	} {
		if err := m.DeleteStack(tc.ws, tc.stack); !errors.Is(err, tc.want) {
			t.Errorf("DeleteStack(%q, %q) = %v, want %v", tc.ws, tc.stack, err, tc.want)
		}
	}
	if _, err := os.Stat(filepath.Join(examples, "acme-shop", "stacks", "full.yaml")); err != nil {
		t.Errorf("the sample must be untouched: %v", err)
	}
}

func TestStackYAMLReadsSamplesToo(t *testing.T) {
	m := stackManager(t)
	text, err := m.StackYAML("acme-shop", "full")
	if err != nil || !strings.Contains(text, "name: full") {
		t.Errorf("StackYAML = %q, %v", text, err)
	}
	if _, err := m.StackYAML("demo", "ghost"); !errors.Is(err, ErrStackNotFound) {
		t.Errorf("missing stack: %v", err)
	}
	if _, err := m.StackYAML("../x", "web"); !errors.Is(err, ErrNotFound) {
		t.Errorf("odd workspace id: %v", err)
	}
}
