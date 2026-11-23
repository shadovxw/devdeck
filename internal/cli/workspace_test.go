package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const exampleWorkspace = "../../examples/workspaces/acme-shop"

func runWorkspace(t *testing.T, env map[string]string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errw bytes.Buffer
	code = Workspace(args, func(k string) string { return env[k] }, &out, &errw)
	return code, out.String(), errw.String()
}

func badWorkspace(t *testing.T, name string) (workspacesDir string) {
	t.Helper()
	workspacesDir = t.TempDir()
	dir := filepath.Join(workspacesDir, name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	yaml := "version: 1\nname: BAD NAME\nroot: .\nrepos: nope\n"
	if err := os.WriteFile(filepath.Join(dir, "workspace.yaml"), []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	return workspacesDir
}

func TestWorkspaceCheck(t *testing.T) {
	t.Run("a good workspace passes, with its warnings", func(t *testing.T) {
		code, out, errw := runWorkspace(t, nil, "check", exampleWorkspace)
		if code != exitOK || !strings.Contains(out, "2 stacks, 1 flows, 0 errors") {
			t.Errorf("code %d, stdout %q, stderr %q", code, out, errw)
		}
	})

	t.Run("json, with the flag after the folder", func(t *testing.T) {
		code, out, errw := runWorkspace(t, nil, "check", exampleWorkspace, "--json")
		if code != exitOK {
			t.Fatalf("code %d: %s", code, errw)
		}
		var v struct {
			Valid  bool              `json:"valid"`
			Stacks int               `json:"stacks"`
			Issues []json.RawMessage `json:"issues"`
		}
		if err := json.Unmarshal([]byte(out), &v); err != nil || !v.Valid || v.Stacks != 2 || v.Issues == nil {
			t.Errorf("stdout isn't the expected JSON (%v): %s", err, out)
		}
	})

	t.Run("errors give exit 1 and name the file", func(t *testing.T) {
		dir := badWorkspace(t, "demo")
		code, out, _ := runWorkspace(t, nil, "check", filepath.Join(dir, "demo"))
		if code != exitFail || !strings.Contains(out, "error workspace.yaml") || strings.Contains(out, " 0 errors") {
			t.Errorf("code %d, stdout %q", code, out)
		}
	})

	t.Run("a bare name is looked up in the workspaces folder", func(t *testing.T) {
		dir := badWorkspace(t, "demo")
		env := map[string]string{"DEVDECK_WORKSPACES_DIR": dir}
		if code, out, _ := runWorkspace(t, env, "check", "demo"); code != exitFail || !strings.Contains(out, "error workspace.yaml") {
			t.Errorf("by name: code %d, stdout %q", code, out)
		}
		if code, _, errw := runWorkspace(t, env, "check", "nope"); code != exitFail || !strings.Contains(errw, `no workspace named "nope"`) {
			t.Errorf("unknown name: code %d, stderr %q", code, errw)
		}
	})

	t.Run("a path that isn't a folder", func(t *testing.T) {
		if code, _, errw := runWorkspace(t, nil, "check", filepath.Join("no", "such", "folder")); code != exitFail || !strings.Contains(errw, "isn't a folder") {
			t.Errorf("code %d, stderr %q", code, errw)
		}
	})
}

func TestWorkspaceUsage(t *testing.T) {
	for _, args := range [][]string{nil, {"bogus"}, {"check"}, {"check", "a", "b"}, {"check", "--nope", "x"}} {
		if code, _, errw := runWorkspace(t, nil, args...); code != exitUsage || errw == "" {
			t.Errorf("devdeck workspace %v: code %d, stderr %q, want exit 2 and a message", args, code, errw)
		}
	}
}

func TestSchema(t *testing.T) {
	for _, kind := range []string{"workspace", "stack", "flow"} {
		var out, errw bytes.Buffer
		if code := Schema([]string{kind}, &out, &errw); code != exitOK {
			t.Fatalf("%s: code %d: %s", kind, code, errw.String())
		}
		var v map[string]any
		if err := json.Unmarshal(out.Bytes(), &v); err != nil || v["$schema"] == nil {
			t.Errorf("%s: not a JSON Schema (%v)", kind, err)
		}
	}
	for _, args := range [][]string{nil, {"nope"}, {"stack", "flow"}} {
		var out, errw bytes.Buffer
		if code := Schema(args, &out, &errw); code != exitUsage || errw.Len() == 0 || out.Len() != 0 {
			t.Errorf("devdeck schema %v: code %d, stdout %q, stderr %q", args, code, out.String(), errw.String())
		}
	}
}
