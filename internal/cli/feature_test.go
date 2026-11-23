package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const featureText = `version: 1
feature: acme
repos: [api]
prs:
  - { id: a1, repo: api, slug: first, title: First, steps: [ { title: One, layer: handler } ] }
`

func runFeature(t *testing.T, env map[string]string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errw bytes.Buffer
	code = Feature(args, func(k string) string { return env[k] }, &out, &errw)
	return code, out.String(), errw.String()
}

func writeFeature(t *testing.T, text string) (dir, file string) {
	t.Helper()
	dir = t.TempDir()
	file = filepath.Join(dir, "feature.yaml")
	if err := os.WriteFile(file, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return dir, file
}

// workspaceWith makes a workspaces folder holding one workspace "demo" with the given repo section.
func workspaceWith(t *testing.T, repos string) (workspacesDir string) {
	t.Helper()
	workspacesDir = t.TempDir()
	dir := filepath.Join(workspacesDir, "demo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	yaml := "version: 1\nname: demo\nroot: .\nrepos:\n" + repos
	if err := os.WriteFile(filepath.Join(dir, "workspace.yaml"), []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	return workspacesDir
}

func TestFeatureCheck(t *testing.T) {
	t.Run("a good file passes and says what it didn't check", func(t *testing.T) {
		_, file := writeFeature(t, featureText)
		code, out, errw := runFeature(t, nil, "check", file)
		if code != exitOK || !strings.Contains(out, "1 PRs, 0 errors, 0 warnings (repos and layers not checked: add --workspace)") {
			t.Errorf("code %d, stdout %q, stderr %q", code, out, errw)
		}
	})

	t.Run("a plan folder works as well as the file", func(t *testing.T) {
		dir, _ := writeFeature(t, featureText)
		if code, out, errw := runFeature(t, nil, "check", dir); code != exitOK {
			t.Errorf("code %d, stdout %q, stderr %q", code, out, errw)
		}
	})

	t.Run("errors give exit 1 and name the line", func(t *testing.T) {
		_, file := writeFeature(t, strings.Replace(featureText, "repo: api", "repo: nope", 1))
		code, out, _ := runFeature(t, nil, "check", file)
		if code != exitFail || !strings.Contains(out, "error feature.yaml:5:") || !strings.Contains(out, "isn't in this feature's repos") {
			t.Errorf("code %d, stdout %q", code, out)
		}
	})

	t.Run("a workspace adds the repo and layer checks", func(t *testing.T) {
		_, file := writeFeature(t, featureText)
		env := map[string]string{"DEVDECK_WORKSPACES_DIR": workspaceWith(t, "  - id: api\n    path: api\n    layers: [ { id: db } ]\n")}
		code, out, errw := runFeature(t, env, "check", "--workspace", "demo", file)
		if code != exitFail || !strings.Contains(out, `The repo "api" has no layer "handler". Defined: db.`) {
			t.Errorf("code %d, stdout %q, stderr %q", code, out, errw)
		}
		code, out, _ = runFeature(t, env, "check", file, "--workspace", "demo", "--json")
		var v struct {
			Valid        bool              `json:"valid"`
			PRs          int               `json:"prs"`
			CrossChecked bool              `json:"cross_checked"`
			Issues       []json.RawMessage `json:"issues"`
		}
		if err := json.Unmarshal([]byte(out), &v); err != nil || v.Valid || v.PRs != 1 || !v.CrossChecked || len(v.Issues) != 1 || code != exitFail {
			t.Errorf("json (%v), code %d: %s", err, code, out)
		}
	})

	t.Run("usage and unreadable files", func(t *testing.T) {
		if code, _, errw := runFeature(t, nil); code != exitUsage || !strings.Contains(errw, "devdeck feature check") {
			t.Errorf("no arguments: code %d, %q", code, errw)
		}
		if code, _, _ := runFeature(t, nil, "check"); code != exitUsage {
			t.Errorf("no file: code %d", code)
		}
		if code, _, errw := runFeature(t, nil, "check", filepath.Join(t.TempDir(), "missing.yaml")); code != exitFail || !strings.Contains(errw, "can't be read") {
			t.Errorf("missing file: code %d, %q", code, errw)
		}
		_, file := writeFeature(t, featureText)
		if code, _, errw := runFeature(t, map[string]string{"DEVDECK_WORKSPACES_DIR": t.TempDir()}, "check", "--workspace", "nope", file); code != exitFail || !strings.Contains(errw, `no workspace named "nope"`) {
			t.Errorf("unknown workspace: code %d, %q", code, errw)
		}
	})
}

func TestSchemaOfFeature(t *testing.T) {
	var out, errw bytes.Buffer
	if code := Schema([]string{"feature"}, &out, &errw); code != exitOK || !strings.Contains(out.String(), "devdeck feature") {
		t.Errorf("code %d, %q, %q", code, out.String(), errw.String())
	}
}
