package supervisor

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/workspace"
)

func TestSplitCommand(t *testing.T) {
	ok := map[string][]string{
		`npm run dev`:                  {"npm", "run", "dev"},
		`  go   run  ./cmd/api  `:      {"go", "run", "./cmd/api"},
		`python "my app.py" --port 80`: {"python", "my app.py", "--port", "80"},
		`echo 'a b' "c d"`:             {"echo", "a b", "c d"},
		`C:\tools\bin\x.exe -v`:        {`C:\tools\bin\x.exe`, "-v"},
		`say "he said \"hi\""`:         {"say", `he said "hi"`},
		`x ""`:                         {"x", ""},
	}
	for in, want := range ok {
		got, err := SplitCommand(in)
		if err != nil || !reflect.DeepEqual(got, want) {
			t.Errorf("SplitCommand(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{``, `   `, `echo "open`, `a && b`, `a | b`, `a > out.txt`, `a ; b`, `x &`} {
		if got, err := SplitCommand(in); err == nil {
			t.Errorf("SplitCommand(%q) = %q, want an error", in, got)
		}
	}
	if _, err := SplitCommand("a && b"); err == nil || !strings.Contains(err.Error(), "script") {
		t.Errorf("the error should point to a script: %v", err)
	}
}

func TestLoadEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	body := "\xef\xbb\xbf# comment\n\nA=1\nexport B = two words \nC=\"quoted value\"\nD='single'\nE=\nF=a=b\nG=100 # per second\nH=pa#ss\nI=\"quoted # kept\" # note\nJ='single'#glued\nK=a\tb\t# tab comment\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := LoadEnvFile(path)
	want := []string{"A=1", "B=two words", "C=quoted value", "D=single", "E=", "F=a=b", "G=100", "H=pa#ss", "I=quoted # kept", "J=single", "K=a\tb"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %q, %v; want %q", got, err, want)
	}

	// a bad line is reported by number and never repeats the value
	must(t, os.WriteFile(path, []byte("OK=1\nsecret-token-123\n"), 0o600))
	if _, err := LoadEnvFile(path); err == nil || !strings.Contains(err.Error(), "line 2") || strings.Contains(err.Error(), "secret-token") {
		t.Errorf("error = %v", err)
	}
	if _, err := LoadEnvFile(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Error("a missing file should be an error")
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func planFixture() (*workspace.WorkspaceFile, []workspace.StackFile) {
	w := &workspace.WorkspaceFile{
		Version: 1, Name: "demo", Root: "~/code",
		Repos: []workspace.Repo{{ID: "api", Path: "api"}, {ID: "web", Path: "web"}, {ID: "infra", Path: "infra"}},
	}
	stacks := []workspace.StackFile{{
		Name:    "full",
		Compose: workspace.Composes{{Repo: "infra", File: "docker-compose.yml", Services: []string{"db"}}},
		Services: []workspace.Service{
			{ID: "web", Repo: "web", Kind: "node", Port: 5173, After: []string{"api"}, Ready: &workspace.Ready{Log: "Local:", Timeout: "20s"}},
			{ID: "api", Repo: "api", Kind: "go", Cmd: "./cmd/api", Port: 8080, EnvFile: ".env", Dir: "svc", Env: map[string]string{"MODE": "dev"}},
		},
	}}
	return w, stacks
}

func TestPlanBuildsAbsolutePathsAndDefaults(t *testing.T) {
	root := t.TempDir()
	w, stacks := planFixture()

	spec, err := Plan("demo", root, w, stacks, "full")
	if err != nil {
		t.Fatal(err)
	}
	if len(spec.Compose) != 1 || spec.Compose[0].ID != "compose" || spec.Compose[0].File != filepath.Join(root, "infra", "docker-compose.yml") || spec.Compose[0].Dir != filepath.Join(root, "infra") {
		t.Fatalf("compose = %+v", spec.Compose)
	}
	web, api := spec.Services[0], spec.Services[1]

	if !reflect.DeepEqual(web.Argv, []string{"npm", "run", "dev"}) {
		t.Errorf("node should default to npm run dev: %q", web.Argv)
	}
	if web.Ready.Log != "Local:" || web.ReadyTimeout != 20*time.Second || web.Restart != "on-failure" {
		t.Errorf("web = %+v", web)
	}
	if api.Package != "./cmd/api" || api.Dir != filepath.Join(root, "api", "svc") || api.EnvFile != filepath.Join(root, "api", "svc", ".env") {
		t.Errorf("api paths = %+v", api)
	}
	if api.Ready.TCP != "127.0.0.1:8080" || api.ReadyTimeout != defaultReadyTimeout {
		t.Errorf("a service with a port and no ready check should be checked on its port: %+v", api.Ready)
	}
	if api.Env["MODE"] != "dev" {
		t.Errorf("env = %v", api.Env)
	}
}

func TestPlanRefusesWhatCannotRun(t *testing.T) {
	root := t.TempDir()
	cases := map[string]func(*workspace.WorkspaceFile, []workspace.StackFile){
		"repo path leaves root":    func(w *workspace.WorkspaceFile, _ []workspace.StackFile) { w.Repos[0].Path = "../elsewhere" },
		"service dir leaves repo":  func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[1].Dir = "../../x" },
		"env file leaves folder":   func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[1].EnvFile = "../../.env" },
		"compose file leaves repo": func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Compose[0].File = "../x.yml" },
		"unknown repo":             func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[0].Repo = "ghost" },
		"unknown dependency":       func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[0].After = []string{"ghost"} },
		"loop":                     func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[1].After = []string{"web"} },
		"unknown kind":             func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[0].Kind = "perl" },
		"command needs a cmd": func(_ *workspace.WorkspaceFile, s []workspace.StackFile) {
			s[0].Services[0].Kind, s[0].Services[0].Cmd = "command", ""
		},
		"cmd needs a shell":          func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[0].Cmd = "npm i && npm start" },
		"bad ready timeout":          func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Services[0].Ready.Timeout = "soon" },
		"compose repo isn't present": func(_ *workspace.WorkspaceFile, s []workspace.StackFile) { s[0].Compose[0].Repo = "ghost" },
	}
	for name, mutate := range cases {
		w, stacks := planFixture()
		mutate(w, stacks)
		if _, err := Plan("demo", root, w, stacks, "full"); !errors.Is(err, ErrBadStack) {
			t.Errorf("%s: err = %v, want ErrBadStack", name, err)
		}
	}

	w, stacks := planFixture()
	if _, err := Plan("demo", root, w, stacks, "nope"); !errors.Is(err, ErrNoSuchStack) {
		t.Errorf("unknown stack: %v", err)
	}
}

func TestLevelsOrderServices(t *testing.T) {
	svcs := []ServiceSpec{
		{ID: "web", After: []string{"api", "auth"}},
		{ID: "api", After: []string{"db"}},
		{ID: "auth"},
		{ID: "db"},
	}
	got, err := Levels(svcs)
	want := [][]string{{"auth", "db"}, {"api"}, {"web"}}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("levels = %v, %v; want %v", got, err, want)
	}
	if _, err := Levels([]ServiceSpec{{ID: "a", After: []string{"b"}}, {ID: "b", After: []string{"a"}}}); err == nil {
		t.Error("a loop should be an error")
	}
	if _, err := Levels([]ServiceSpec{{ID: "a", After: []string{"zzz"}}}); err == nil {
		t.Error("a missing dependency should be an error")
	}
}

func TestNormalizeExit(t *testing.T) {
	for in, want := range map[int]int{0: 0, 3: 3, -1: -1, 4294967295: -1, 4294967294: -2, 2147483647: 2147483647} {
		if got := normalizeExit(in); got != want {
			t.Errorf("normalizeExit(%d) = %d, want %d", in, got, want)
		}
	}
}

func TestPlanNamesSeveralComposeFiles(t *testing.T) {
	root := t.TempDir()
	w, stacks := planFixture()
	w.Repos = append(w.Repos, workspace.Repo{ID: "vault", Path: "vault"})
	stacks[0].Compose = workspace.Composes{
		{Repo: "infra", File: "docker-compose.yml", Services: []string{"db"}},
		{Repo: "vault", File: "docker-compose.yml"},
		{Repo: "vault", File: "other.yml"},
	}
	spec, err := Plan("demo", root, w, stacks, "full")
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, c := range spec.Compose {
		ids = append(ids, c.ID)
	}
	if want := []string{"compose-infra", "compose-vault", "compose-vault-3"}; !reflect.DeepEqual(ids, want) {
		t.Errorf("ids = %v, want %v", ids, want)
	}

	// a stack with only compose files has no services and is still a plan
	stacks[0].Services = nil
	if spec, err = Plan("demo", root, w, stacks, "full"); err != nil || len(spec.Services) != 0 || len(spec.Compose) != 3 {
		t.Errorf("compose-only: %+v, %v", spec, err)
	}
}
