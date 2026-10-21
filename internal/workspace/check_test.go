package workspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.yaml.in/yaml/v3"
)

// has fails unless some issue is on the given line, with the given severity and text.
func has(t *testing.T, issues []Issue, line int, sev Severity, contains string) {
	t.Helper()
	for _, i := range issues {
		if i.Line == line && i.Severity == sev && strings.Contains(i.Message, contains) {
			return
		}
	}
	t.Errorf("no %s on line %d containing %q\nissues:\n%s", sev, line, contains, dump(issues))
}

func dump(issues []Issue) string {
	var b strings.Builder
	for _, i := range issues {
		b.WriteString("  " + i.File + ":" + itoa(i.Line) + " [" + string(i.Severity) + "] " + i.Message + "\n")
	}
	return b.String()
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	s := ""
	for ; n > 0; n /= 10 {
		s = string(rune('0'+n%10)) + s
	}
	return s
}

func TestExampleWorkspaceIsClean(t *testing.T) {
	l, err := LoadDir("../../examples/workspaces/acme-shop", Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(l.Issues) != 0 {
		t.Fatalf("the shipped example must have no issues:\n%s", dump(l.Issues))
	}
	if l.Workspace == nil || l.Workspace.Name != "acme-shop" || len(l.Workspace.Repos) != 3 {
		t.Fatalf("unexpected workspace: %+v", l.Workspace)
	}
	if len(l.Stacks) != 2 || len(l.Flows) != 1 {
		t.Fatalf("stacks = %d, flows = %d, want 2 and 1", len(l.Stacks), len(l.Flows))
	}
}

func TestFileShapeProblems(t *testing.T) {
	tests := []struct {
		name string
		yaml string
		line int
		want string
	}{
		{"bad indentation", "version: 1\nname: demo\n  root: x\n", 3, "values are not allowed"},
		{"empty file", "", 1, "The file is empty."},
		{"a list instead of settings", "- a\n- b\n", 1, "key: value"},
		{"unknown setting", "version: 1\nname: demo\nroot: ~/code\nreops: []\n", 4, `"reops"`},
		{"missing root", "version: 1\nname: demo\n", 1, `"root" is required`},
		{"wrong version", "version: 2\nname: demo\nroot: x\n", 1, "must be 1"},
		{"bad name", "version: 1\nname: Bad_Name\nroot: x\n", 2, "can't be used as a name"},
		{"a list expected", "version: 1\nname: demo\nroot: x\nrepos: nope\n", 4, "should be a list"},
		{"a value not allowed", "version: 1\nname: demo\nroot: x\nrepos:\n  - id: api\n    path: api\n    type: rust\n", 7, "Use one of: go, node, python, docker, other"},
		{"duplicate key", "version: 1\nname: demo\nname: other\nroot: x\n", 3, "already defined"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			has(t, Check(KindWorkspace, "workspace.yaml", []byte(tt.yaml), nil, Options{}), tt.line, SeverityError, tt.want)
		})
	}
}

func TestWorkspaceReferencesAndRules(t *testing.T) {
	src := `version: 1
name: demo
root: ~/code
default_connection: gh
connections:
  - id: main
    type: github
repos:
  - id: api
    path: api
  - id: api
    path: ../escape
    remote: https://user:tok@github.com/a/b
    connection: ghost
account_rules:
  - match: github.com/*
    connection: nope
`
	issues := Check(KindWorkspace, "workspace.yaml", []byte(src), nil, Options{})
	has(t, issues, 4, SeverityError, `no connection with id "gh". Defined: main`)
	has(t, issues, 11, SeverityError, `Repo id "api" is used more than once`)
	has(t, issues, 12, SeverityError, "inside the workspace root")
	has(t, issues, 13, SeverityError, "Remove the user name or token")
	has(t, issues, 14, SeverityError, `no connection with id "ghost"`)
	has(t, issues, 17, SeverityError, `no connection with id "nope"`)
}

func TestSecretsNeverInYAML(t *testing.T) {
	bad := "version: 1\nname: demo\nroot: x\nconnections:\n  - id: gh\n    type: github\n    settings:\n      token: abc123\n"
	has(t, Check(KindWorkspace, "workspace.yaml", []byte(bad), nil, Options{}), 8, SeverityError, "Secrets never go in YAML")

	// a reference to an environment variable is fine: the value isn't in the file
	ok := strings.Replace(bad, "abc123", "${GITHUB_TOKEN}", 1)
	if issues := Check(KindWorkspace, "workspace.yaml", []byte(ok), nil, Options{}); HasErrors(issues) {
		t.Fatalf("an env reference should be allowed:\n%s", dump(issues))
	}
}

func TestStackProblems(t *testing.T) {
	src := `version: 1
name: demo
services:
  - id: a
    repo: ghost
    kind: command
    port: 80
    after: [b]
    ready:
      http: 127.0.0.1:80/health
      log: x
  - id: b
    repo: api
    kind: go
    port: 80
    after: [a, zzz, b]
`
	issues := Check(KindStack, "stacks/demo.yaml", []byte(src), map[string]bool{"api": true, "infra": true}, Options{})
	has(t, issues, 5, SeverityError, `no repo with id "ghost"`)
	has(t, issues, 4, SeverityError, "needs cmd")
	has(t, issues, 15, SeverityError, `Port 80 is already used by "a"`)
	has(t, issues, 9, SeverityError, "Choose one of http, tcp or log")
	has(t, issues, 10, SeverityError, "full URL")
	has(t, issues, 16, SeverityError, `no service "zzz"`)
	has(t, issues, 16, SeverityError, "can't wait for itself")
	has(t, issues, 3, SeverityError, "a → b → a")
}

func TestStackReadyAndSchemaMistakes(t *testing.T) {
	tests := []struct {
		name string
		yaml string
		line int
		want string
	}{
		{"ready with nothing to wait for", "version: 1\nname: s\nservices:\n  - id: a\n    repo: r\n    kind: go\n    ready:\n      timeout: 5s\n", 7, "needs one of http, tcp or log"},
		{"bad duration", "version: 1\nname: s\nservices:\n  - id: a\n    repo: r\n    kind: go\n    ready:\n      tcp: 127.0.0.1:1\n      timeout: soon\n", 9, "isn't a duration"},
		{"bad tcp", "version: 1\nname: s\nservices:\n  - id: a\n    repo: r\n    kind: go\n    ready:\n      tcp: nowhere\n", 8, "host:port"},
		{"port out of range", "version: 1\nname: s\nservices:\n  - id: a\n    repo: r\n    kind: go\n    port: 99999\n", 7, "Maximum"},
		{"no services", "version: 1\nname: s\nservices: []\n", 3, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := Check(KindStack, "stacks/s.yaml", []byte(tt.yaml), nil, Options{})
			if tt.want == "" {
				if !HasErrors(issues) {
					t.Fatal("expected an error")
				}
				return
			}
			has(t, issues, tt.line, SeverityError, tt.want)
		})
	}
}

func TestFlowProblems(t *testing.T) {
	src := `version: 1
name: demo
steps:
  - id: a
    uses: gitleaks.scan
    needs: [b]
  - id: b
    uses: git.status
    needs: [a, zzz]
`
	issues := Check(KindFlow, "flows/demo.yaml", []byte(src), nil, Options{KnownPlugins: []string{"git", "docker"}})
	has(t, issues, 5, SeverityWarning, `no plugin "gitleaks" installed. Installed: docker, git`)
	has(t, issues, 9, SeverityError, `no step "zzz"`)
	has(t, issues, 3, SeverityError, "a → b → a")

	// without a plugin list, plugin names are not checked
	if has := Check(KindFlow, "flows/demo.yaml", []byte(src), nil, Options{}); Count(has, SeverityWarning) != 0 {
		t.Fatalf("no warnings expected without a plugin list:\n%s", dump(has))
	}

	bad := "version: 1\nname: demo\nsteps:\n  - id: a\n    uses: nodots\n"
	has2 := Check(KindFlow, "flows/demo.yaml", []byte(bad), nil, Options{})
	has(t, has2, 5, SeverityError, "plugin.action")
}

func TestLoadDirProblems(t *testing.T) {
	t.Run("a folder with no workspace.yaml", func(t *testing.T) {
		l, err := LoadDir(t.TempDir(), Options{})
		if err != nil {
			t.Fatal(err)
		}
		has(t, l.Issues, 0, SeverityError, "no workspace.yaml")
	})

	t.Run("a missing folder is an error, not an issue", func(t *testing.T) {
		if _, err := LoadDir(filepath.Join(t.TempDir(), "nope"), Options{}); err == nil {
			t.Fatal("expected an error")
		}
	})

	t.Run("names, stacks and paths", func(t *testing.T) {
		base := t.TempDir()
		dir := filepath.Join(base, "demo")
		code := filepath.Join(base, "code")
		must(t, os.MkdirAll(filepath.Join(dir, "stacks"), 0o755))
		must(t, os.MkdirAll(filepath.Join(code, "api", ".git"), 0o755))
		must(t, os.MkdirAll(filepath.Join(code, "web"), 0o755)) // exists, but no .git
		write(t, filepath.Join(dir, "workspace.yaml"), "version: 1\nname: other\nroot: "+filepath.ToSlash(code)+"\nrepos:\n  - id: api\n    path: api\n  - id: web\n    path: web\n  - id: gone\n    path: gone\n")
		write(t, filepath.Join(dir, "stacks", "one.yaml"), "version: 1\nname: shared\nservices:\n  - id: a\n    repo: api\n    kind: go\n")
		write(t, filepath.Join(dir, "stacks", "two.yaml"), "version: 1\nname: shared\nservices:\n  - id: a\n    repo: unknown\n    kind: go\n")

		l, err := LoadDir(dir, Options{CheckPaths: true})
		if err != nil {
			t.Fatal(err)
		}
		has(t, l.Issues, 1, SeverityWarning, `doesn't match the folder name "demo"`)
		has(t, l.Issues, 8, SeverityWarning, "isn't a git repository")
		has(t, l.Issues, 10, SeverityWarning, "isn't there")
		// the second stack reuses the first one's name, and names a repo that doesn't exist
		has(t, l.Issues, 1, SeverityError, "already used by stacks/one.yaml")
		has(t, l.Issues, 5, SeverityError, `no repo with id "unknown" in this workspace. Defined: api, gone, web`)
		// a stack whose name differs from its file name is only a warning
		has(t, l.Issues, 2, SeverityWarning, `doesn't match the file name "one"`)
		if len(l.Stacks) != 2 {
			t.Fatalf("both stacks should still load, got %d", len(l.Stacks))
		}
	})

	t.Run("an unreadable root is a warning", func(t *testing.T) {
		dir := filepath.Join(t.TempDir(), "demo")
		must(t, os.MkdirAll(dir, 0o755))
		write(t, filepath.Join(dir, "workspace.yaml"), "version: 1\nname: demo\nroot: /definitely/not/here\n")
		l, err := LoadDir(dir, Options{CheckPaths: true})
		if err != nil {
			t.Fatal(err)
		}
		has(t, l.Issues, 3, SeverityWarning, "doesn't exist on this machine")
	})
}

func TestIssuesAreSortedAndDeduplicated(t *testing.T) {
	in := []Issue{
		{File: "b.yaml", Line: 1, Severity: SeverityError, Message: "x"},
		{File: "a.yaml", Line: 9, Severity: SeverityWarning, Message: "w"},
		{File: "a.yaml", Line: 9, Severity: SeverityError, Message: "e"},
		{File: "a.yaml", Line: 2, Severity: SeverityError, Message: "first"},
		{File: "a.yaml", Line: 2, Severity: SeverityError, Message: "first"},
	}
	got := tidy(in)
	want := []string{"a.yaml:2 first", "a.yaml:9 e", "a.yaml:9 w", "b.yaml:1 x"}
	if len(got) != len(want) {
		t.Fatalf("got %d issues, want %d:\n%s", len(got), len(want), dump(got))
	}
	for i, g := range got {
		if s := g.File + ":" + itoa(g.Line) + " " + g.Message; s != want[i] {
			t.Errorf("issue %d = %q, want %q", i, s, want[i])
		}
	}
}

func TestResolveRoot(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home folder")
	}
	if got := ResolveRoot("/ws/demo", "~/code"); got != filepath.Join(home, "code") {
		t.Errorf("~ not expanded: %s", got)
	}
	if got := ResolveRoot(filepath.FromSlash("/ws/demo"), "../repos"); got != filepath.Clean(filepath.FromSlash("/ws/repos")) {
		t.Errorf("relative path not resolved against the workspace folder: %s", got)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	must(t, os.WriteFile(path, []byte(content), 0o644))
}

func TestStackComposeAndRequires(t *testing.T) {
	repos := map[string]bool{"api": true, "vault": true, "storage": true}
	valid := []struct{ name, yaml string }{
		{"one compose file", "version: 1\nname: s\ncompose:\n  repo: vault\n  file: docker-compose.yml\nservices:\n  - id: a\n    repo: api\n    kind: go\n"},
		{"a list of compose files", "version: 1\nname: s\ncompose:\n  - repo: vault\n    file: docker-compose.yml\n  - repo: storage\n    file: docker-compose.yml\n    services: [garage]\nservices:\n  - id: a\n    repo: api\n    kind: go\n"},
		{"compose files and no services", "version: 1\nname: s\ncompose:\n  - repo: vault\n    file: docker-compose.yml\n"},
		{"requires on this machine", "version: 1\nname: s\nrequires:\n  - name: Postgres\n    tcp: 127.0.0.1:5432\n  - name: Cache\n    tcp: localhost:6379\nservices:\n  - id: a\n    repo: api\n    kind: go\n"},
	}
	for _, tt := range valid {
		t.Run(tt.name, func(t *testing.T) {
			if issues := Check(KindStack, "stacks/s.yaml", []byte(tt.yaml), repos, Options{}); len(issues) != 0 {
				t.Errorf("unexpected issues:\n%s", dump(issues))
			}
		})
	}

	// the stack decodes the same whichever way compose was written
	for name, src := range map[string]string{
		"object": "version: 1\nname: s\ncompose:\n  repo: vault\n  file: f.yml\n",
		"list":   "version: 1\nname: s\ncompose:\n  - repo: vault\n    file: f.yml\n",
	} {
		var st StackFile
		if err := yaml.Unmarshal([]byte(src), &st); err != nil || len(st.Compose) != 1 || st.Compose[0].Repo != "vault" {
			t.Errorf("%s: %+v, %v", name, st.Compose, err)
		}
	}

	problems := []struct {
		name string
		yaml string
		line int
		want string
	}{
		{"unknown repo in a list", "version: 1\nname: s\ncompose:\n  - repo: vault\n    file: f.yml\n  - repo: ghost\n    file: f.yml\n", 6, `no repo with id "ghost"`},
		{"unknown repo in one file", "version: 1\nname: s\ncompose:\n  repo: ghost\n  file: f.yml\n", 4, `no repo with id "ghost"`},
		{"compose file outside its repo", "version: 1\nname: s\ncompose:\n  - repo: vault\n    file: ../f.yml\n", 5, "inside the repo"},
		{"nothing to run", "version: 1\nname: s\n", 0, "needs services, compose files, or both"},
		{"a service called compose", "version: 1\nname: s\nservices:\n  - id: compose-vault\n    repo: api\n    kind: go\n", 4, `Ids starting with "compose"`},
		{"requires another machine", "version: 1\nname: s\nrequires:\n  - name: Db\n    tcp: db.example.com:5432\nservices:\n  - id: a\n    repo: api\n    kind: go\n", 5, "Only this machine"},
		{"requires a port out of range", "version: 1\nname: s\nrequires:\n  - name: Db\n    tcp: 127.0.0.1:99999\nservices:\n  - id: a\n    repo: api\n    kind: go\n", 5, "Only this machine"},
	}
	for _, tt := range problems {
		t.Run(tt.name, func(t *testing.T) {
			issues := Check(KindStack, "stacks/s.yaml", []byte(tt.yaml), repos, Options{})
			if tt.line == 0 {
				for _, i := range issues {
					if strings.Contains(i.Message, tt.want) {
						return
					}
				}
				t.Errorf("no issue containing %q:\n%s", tt.want, dump(issues))
				return
			}
			has(t, issues, tt.line, SeverityError, tt.want)
		})
	}
}

func TestLoopbackAddr(t *testing.T) {
	for addr, want := range map[string]bool{
		"127.0.0.1:5432": true, "localhost:80": true, "[::1]:8080": true,
		"example.com:80": false, "10.0.0.5:80": false, "127.0.0.1": false, "127.0.0.1:0": false, "127.0.0.1:70000": false, "127.0.0.1:x": false,
	} {
		if got := loopbackAddr(addr); got != want {
			t.Errorf("loopbackAddr(%q) = %v, want %v", addr, got, want)
		}
	}
}

func TestStackLogsRules(t *testing.T) {
	repos := map[string]bool{"api": true, "kc": true}
	valid := "version: 1\nname: s\ncompose:\n  repo: kc\n  file: docker-compose.yml\n  logs:\n    keycloak: { store: off }\n    db: { store: matching, match: \"(?i)error\" }\nservices:\n  - id: a\n    repo: api\n    kind: go\n    logs: { store: matching, match: \"WARN|ERROR\" }\n  - id: b\n    repo: api\n    kind: go\n    logs: { store: all }\n"
	if issues := Check(KindStack, "stacks/s.yaml", []byte(valid), repos, Options{}); len(issues) != 0 {
		t.Fatalf("a valid file got issues:\n%s", dump(issues))
	}

	var st StackFile
	if err := yaml.Unmarshal([]byte(valid), &st); err != nil || st.Services[0].Logs == nil || st.Services[0].Logs.Match != "WARN|ERROR" || st.Compose[0].Logs["keycloak"].Store != "off" {
		t.Errorf("decoded %+v, %v", st, err)
	}

	problems := []struct {
		name string
		yaml string
		line int
		want string
	}{
		{"matching without a pattern", "version: 1\nname: s\nservices:\n  - id: a\n    repo: api\n    kind: go\n    logs: { store: matching }\n", 7, "needs match"},
		{"a pattern that doesn't compile", "version: 1\nname: s\nservices:\n  - id: a\n    repo: api\n    kind: go\n    logs: { store: matching, match: \"(\" }\n", 7, "isn't a valid pattern"},
		{"a pattern with store all", "version: 1\nname: s\nservices:\n  - id: a\n    repo: api\n    kind: go\n    logs: { store: all, match: x }\n", 7, "only applies"},
		{"an unknown mode", "version: 1\nname: s\nservices:\n  - id: a\n    repo: api\n    kind: go\n    logs: { store: sometimes }\n", 7, "sometimes"},
		{"a bad pattern in a compose container", "version: 1\nname: s\ncompose:\n  repo: kc\n  file: f.yml\n  logs:\n    keycloak: { store: matching, match: \"[\" }\n", 7, "isn't a valid pattern"},
		{"a bad pattern in a compose list", "version: 1\nname: s\ncompose:\n  - repo: kc\n    file: f.yml\n    logs:\n      keycloak: { store: matching, match: \"[\" }\n", 7, "isn't a valid pattern"},
	}
	for _, tt := range problems {
		t.Run(tt.name, func(t *testing.T) {
			has(t, Check(KindStack, "stacks/s.yaml", []byte(tt.yaml), repos, Options{}), tt.line, SeverityError, tt.want)
		})
	}
}
