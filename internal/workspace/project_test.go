package workspace

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const goodProject = `version: 2
name: acme
root: ../code
repos:
  - id: demo-api
    path: demo-api
  - id: infra
    path: infra
    local_only: true
run:
  default: full
  modes:
    - name: full
      compose:
        repo: infra
        file: docker-compose.yml
      services:
        - id: api
          repo: demo-api
          kind: command
          cmd: node server.js
databases:
  - id: shop
    engine: postgres
    from: { compose: db }
    used_by: [demo-api]
`

func TestCheckProject(t *testing.T) {
	tests := []struct {
		name string
		text string
		// want are "severity path line message-part" (line - for any); empty means no issues.
		want []string
	}{
		{name: "a good file", text: goodProject},
		{name: "version 1 is workspace.yaml's", text: strings.Replace(goodProject, "version: 2", "version: 1", 1), want: []string{"error /version 1 2"}},
		{name: "a mode's unknown repo, on its line", text: strings.Replace(goodProject, "repo: demo-api\n          kind", "repo: nope\n          kind", 1),
			want: []string{"error /run/modes/0/services/0/repo 19 no repo with id \"nope\""}},
		{name: "a mode needs no version", text: strings.Replace(goodProject, "    - name: full\n", "    - name: full\n      version: 1\n", 1),
			want: []string{"error /run/modes/0/version 14 isn't a setting"}},
		{name: "two modes of one name", text: goodProject[:strings.Index(goodProject, "databases:")] + "    - name: full\n",
			want: []string{"error /run/modes/1 22 needs services", "error /run/modes/1/name 22 used twice"}},
		{name: "a default that isn't there", text: strings.Replace(goodProject, "default: full", "default: nope", 1), want: []string{"warning /run/default 11 no run mode \"nope\""}},
		{name: "used_by a repo that isn't there", text: strings.Replace(goodProject, "used_by: [demo-api]", "used_by: [ghost]", 1),
			want: []string{"warning /databases/0/used_by/0 - ghost"}},
		{name: "local without a port", text: strings.Replace(goodProject, "from: { compose: db }", "from: { local: true }", 1), want: []string{"warning /databases/0/port - needs its port"}},
		{name: "two places at once", text: strings.Replace(goodProject, "from: { compose: db }", "from: { compose: db, local: true }", 1), want: []string{"error /databases/0/from - "}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := Check(KindProject, "project.yaml", []byte(tt.text), nil, Options{})
			if len(issues) != len(tt.want) {
				t.Fatalf("issues = %+v, want %v", issues, tt.want)
			}
			for i, w := range tt.want {
				parts := strings.SplitN(w, " ", 4)
				got := issues[i]
				if string(got.Severity) != parts[0] || got.Path != parts[1] || (parts[2] != "-" && parts[2] != itoa(got.Line)) || !strings.Contains(got.Message, parts[3]) {
					t.Errorf("issue %d = %s %s %d %q, want %s", i, got.Severity, got.Path, got.Line, got.Message, w)
				}
			}
		})
	}
}


func TestSchemasForProjectAndMode(t *testing.T) {
	for _, k := range []Kind{KindProject, kindMode} {
		b, err := SchemaJSON(k)
		if err != nil || !strings.Contains(string(b), `"$id": "https://devdeck.local/schemas/`+string(k)+`.schema.json"`) {
			t.Errorf("%s schema: %v %.120s", k, err, b)
		}
	}
}

// convertFixture is a workspace.yaml project with two stacks and a flow, comments included.
func convertFixture(t *testing.T) (*Manager, string) {
	t.Helper()
	m := newManager(t)
	code := filepath.Join(t.TempDir(), "code")
	for _, d := range []string{"demo-api", "demo-web"} {
		if err := os.MkdirAll(filepath.Join(code, d, ".git"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	ws := "# The acme shop\nversion: 1\nname: acme\nroot: " + filepath.ToSlash(code) + "\nrepos:\n  - id: demo-api # the API\n    path: demo-api\n  - id: demo-web\n    path: demo-web\n"
	if _, issues, err := m.Create(ws); err != nil {
		t.Fatalf("create: %v %v", err, issues)
	}
	dir := filepath.Join(m.Dir, "acme")
	files := map[string]string{
		"stacks/full.yaml":     "# Everything\nversion: 1\nname: full\nservices:\n  - id: api\n    repo: demo-api\n    kind: command\n    cmd: node server.js 18080\n    port: 18080\n  - id: web\n    repo: demo-web\n    kind: command\n    cmd: node server.js 18081\n    after: [api]\n",
		"stacks/api-only.yaml": "version: 1\nname: api-only\nservices:\n  - id: api\n    repo: demo-api\n    kind: command\n    cmd: node server.js 18090\n",
	}
	for rel, text := range files {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return m, dir
}

func TestConvertRunsTheSame(t *testing.T) {
	m, dir := convertFixture(t)
	before, err := m.Get("acme")
	if err != nil || before.File != "workspace.yaml" {
		t.Fatalf("before: %v %q", err, before.File)
	}
	dbs := []DatabaseDecl{{ID: "shop", Engine: "postgres", From: DatabaseFrom{Compose: "db"}, UsedBy: []string{"demo-api"}}}

	preview, err := m.ConvertPreview("acme", dbs)
	if err != nil {
		t.Fatal(err)
	}
	if len(preview.Issues) != 0 || strings.Join(preview.Modes, ",") != "stacks/api-only.yaml,stacks/full.yaml" {
		t.Fatalf("preview: %+v", preview)
	}
	for _, keep := range []string{"# The acme shop", "# the API", "# Everything", "version: 2", "  modes:\n", "compose: db"} {
		if !strings.Contains(preview.YAML, keep) {
			t.Errorf("the preview lost %q:\n%s", keep, preview.YAML)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "project.yaml")); err == nil {
		t.Fatal("the preview wrote a file")
	}

	if _, err := m.Convert("acme", dbs); err != nil {
		t.Fatal(err)
	}
	after, err := m.Get("acme")
	if err != nil {
		t.Fatal(err)
	}
	if after.File != "project.yaml" || len(after.Issues) != 0 {
		t.Fatalf("after: %q %+v", after.File, after.Issues)
	}
	// It still runs the same: the repos and every run mode come out as before.
	if !reflect.DeepEqual(before.Workspace.Repos, after.Workspace.Repos) || after.Workspace.Version != 2 {
		t.Errorf("repos changed: %+v -> %+v", before.Workspace.Repos, after.Workspace.Repos)
	}
	strip := func(list []StackFile) []StackFile {
		out := make([]StackFile, len(list))
		for i, s := range list {
			s.File = ""
			out[i] = s
		}
		return out
	}
	if !reflect.DeepEqual(strip(before.Stacks), strip(after.Stacks)) {
		t.Errorf("run modes changed:\n%+v\n%+v", before.Stacks, after.Stacks)
	}
	if len(after.Databases) != 1 || after.Databases[0].ID != "shop" {
		t.Errorf("databases = %+v", after.Databases)
	}
	for _, kept := range []string{"workspace.yaml.v1", "stacks.v1/full.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, filepath.FromSlash(kept))); err != nil {
			t.Errorf("%s isn't kept: %v", kept, err)
		}
	}

	// The editor works on project.yaml now; inline modes are edited there, not as files.
	f, err := m.File("acme")
	if err != nil || f.Kind != KindProject || !strings.HasSuffix(f.Path, "project.yaml") {
		t.Errorf("file = %v %+v", err, f)
	}
	if _, _, err := m.Update("acme", strings.Replace(f.YAML, "# The acme shop", "# Renamed comment", 1)); err != nil {
		t.Errorf("update project.yaml: %v", err)
	}
	if _, err := m.StackYAML("acme", "full"); !errors.Is(err, ErrInline) {
		t.Errorf("stack yaml = %v, want ErrInline", err)
	}
	if err := m.DeleteStack("acme", "full"); !errors.Is(err, ErrInline) {
		t.Errorf("delete = %v, want ErrInline", err)
	}
	if _, err := m.ConvertPreview("acme", nil); !errors.Is(err, ErrConverted) {
		t.Errorf("second conversion = %v", err)
	}
}

func TestConvertRefuses(t *testing.T) {
	m, dir := convertFixture(t)
	if err := os.WriteFile(filepath.Join(dir, "workspace.yaml.v1"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Convert("acme", nil); !errors.Is(err, ErrOldFilesThere) {
		t.Errorf("with an old .v1 = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "stacks", "full.yaml")); err != nil {
		t.Errorf("a refused conversion moved the stacks: %v", err)
	}
	// A stack with a problem makes the new file invalid: nothing is written.
	if err := os.WriteFile(filepath.Join(dir, "stacks", "bad.yaml"), []byte("version: 1\nname: bad\nservices:\n  - id: x\n    repo: ghost\n    kind: command\n    cmd: x\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = os.Remove(filepath.Join(dir, "workspace.yaml.v1"))
	if c, err := m.Convert("acme", nil); !errors.Is(err, ErrInvalid) || c == nil || !HasErrors(c.Issues) {
		t.Errorf("invalid = %v %+v", err, c)
	}
	if _, err := os.Stat(filepath.Join(dir, "project.yaml")); err == nil {
		t.Error("an invalid conversion wrote project.yaml")
	}
}
