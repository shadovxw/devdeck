package doctor

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// fake answers Doctor's questions without touching the machine.
type fake struct {
	missing  map[string]bool // tools that are not installed
	dockerUp bool
	busy     map[int]bool
	down     map[string]bool   // host:port that does not answer
	git      map[string]string // "dir|key" -> value; dir "" is the global config
}

func newFake() *fake {
	return &fake{
		dockerUp: true,
		down:     map[string]bool{},
		git: map[string]string{
			"|user.name":  "Dev Eloper",
			"|user.email": "dev@example.com",
		},
	}
}

func (f *fake) probes() Probes {
	return Probes{
		Tool: func(_ context.Context, n sdk.Need) sdk.ToolStatus {
			if f.missing[n.Binary] {
				return sdk.ToolStatus{State: sdk.StateMissing, Detail: n.Binary + " not found on PATH"}
			}
			return sdk.ToolStatus{State: sdk.StateOK, Version: "9.9"}
		},
		DockerUp: func(context.Context) error {
			if !f.dockerUp {
				return errors.New("down")
			}
			return nil
		},
		PortFree:  func(port int) bool { return !f.busy[port] },
		Dial:      func(_ context.Context, addr string) bool { return !f.down[addr] },
		GitConfig: func(_ context.Context, dir, key string) string { return f.git[dir+"|"+key] },
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// project builds a workspace on disk: api (a git repo with .env.example), web and infra.
func project(t *testing.T) (string, *workspace.WorkspaceFile, []workspace.StackFile) {
	t.Helper()
	root := t.TempDir()
	for _, d := range []string{"api/.git", "web/.git", "web/app", "infra/.git"} {
		must(t, os.MkdirAll(filepath.Join(root, d), 0o755))
	}
	must(t, os.WriteFile(filepath.Join(root, "infra", "docker-compose.yml"), []byte("services: {}\n"), 0o600))
	must(t, os.WriteFile(filepath.Join(root, "api", ".env"), []byte("A=1\n"), 0o600))

	w := &workspace.WorkspaceFile{
		Version: 1, Name: "demo", Root: root,
		DefaultConnection: "work",
		Connections: []workspace.Connection{
			{ID: "work", Type: "github", Identity: &workspace.Identity{Name: "Dev Eloper", Email: "dev@example.com"}},
		},
		Repos: []workspace.Repo{
			{ID: "api", Path: "api", Type: "go", Remote: "github.com/acme/api"},
			{ID: "web", Path: "web", Type: "node"},
			{ID: "infra", Path: "infra", Type: "docker"},
		},
	}
	stacks := []workspace.StackFile{
		{
			Name:    "full",
			Compose: workspace.Composes{{Repo: "infra", File: "docker-compose.yml"}},
			Services: []workspace.Service{
				{ID: "api", Repo: "api", Kind: "go", Port: 8080, EnvFile: ".env"},
				{ID: "web", Repo: "web", Kind: "node", Dir: "app", Port: 5173},
			},
		},
		{
			Name:     "api-only",
			Services: []workspace.Service{{ID: "api", Repo: "api", Kind: "go", Port: 8080, EnvFile: ".env"}},
		},
	}
	return root, w, stacks
}

func run(t *testing.T, in Input, f *fake) Report {
	t.Helper()
	in.Name = "demo"
	in.Probes = f.probes()
	rep, err := Run(t.Context(), in)
	must(t, err)
	return rep
}

func find(t *testing.T, r Report, id string) Check {
	t.Helper()
	for _, c := range r.Checks {
		if c.ID == id {
			return c
		}
	}
	ids := make([]string, len(r.Checks))
	for i, c := range r.Checks {
		ids[i] = c.ID
	}
	t.Fatalf("no check %q in %v", id, ids)
	return Check{}
}

func TestReadyWhenEverythingIsThere(t *testing.T) {
	root, w, stacks := project(t)
	f := newFake()
	f.git[filepath.Join(root, "api")+"|user.email"] = "dev@example.com"
	f.git[filepath.Join(root, "web")+"|user.email"] = "dev@example.com"
	f.git[filepath.Join(root, "infra")+"|user.email"] = "dev@example.com"

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root}, f)
	if !rep.Ready() || rep.Warnings != 0 || rep.Failures != 0 || rep.Passed != len(rep.Checks) {
		for _, c := range rep.Checks {
			t.Logf("%s %s %s", c.Status, c.ID, c.Detail)
		}
		t.Fatalf("report = %+v", rep)
	}
	for _, id := range []string{"tool:git", "tool:go", "tool:node", "tool:npm", "tool:docker", "docker:engine", "repo:api", "stack:full:compose", "stack:full:api:env", "stack:full:web:dir", "stack:full:web:port"} {
		find(t, rep, id)
	}
}

func TestFindsProblemsAndSaysWhatToDo(t *testing.T) {
	root, w, stacks := project(t)
	must(t, os.RemoveAll(filepath.Join(root, "web")))
	must(t, os.Remove(filepath.Join(root, "api", ".env")))
	must(t, os.WriteFile(filepath.Join(root, "api", ".env.example"), []byte("A=\n"), 0o600))

	f := newFake()
	f.missing = map[string]bool{"go": true}
	f.dockerUp = false
	f.busy = map[int]bool{8080: true}

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root}, f)
	if rep.Ready() {
		t.Fatal("should not be ready")
	}

	goCheck := find(t, rep, "tool:go")
	if goCheck.Status != Fail || len(goCheck.Fix) == 0 || !strings.Contains(strings.Join(goCheck.Fix, "\n"), "GoLang.Go") {
		t.Errorf("go: %+v", goCheck)
	}
	if c := find(t, rep, "docker:engine"); c.Status != Fail || len(c.Fix) == 0 {
		t.Errorf("docker engine: %+v", c)
	}
	// web has no remote, so there is no clone command, only advice naming the folder
	if c := find(t, rep, "repo:web"); c.Status != Fail || len(c.Fix) != 1 || !strings.Contains(c.Fix[0], filepath.Join(root, "web")) {
		t.Errorf("repo web: %+v", c)
	}
	if c := find(t, rep, "repo:api"); c.Status != OK {
		t.Errorf("repo api: %+v", c)
	}
	env := find(t, rep, "stack:full:api:env")
	if env.Status != Fail || env.Stack != "full" || len(env.Fix) != 1 || !strings.Contains(env.Fix[0], ".env.example") {
		t.Errorf("env: %+v", env)
	}
	if c := find(t, rep, "stack:full:api:port"); c.Status != Fail || !strings.Contains(c.Detail, "8080") {
		t.Errorf("port: %+v", c)
	}
	if c := find(t, rep, "stack:full:web:port"); c.Status != OK {
		t.Errorf("free port: %+v", c)
	}
	if rep.Failures < 5 || rep.Passed == 0 {
		t.Errorf("counts: %+v", rep)
	}
}

func TestOneStackOnly(t *testing.T) {
	root, w, stacks := project(t)
	f := newFake()

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root, Stack: "api-only"}, f)
	for _, c := range rep.Checks {
		if c.Stack != "" && c.Stack != "api-only" {
			t.Errorf("check %s belongs to stack %q", c.ID, c.Stack)
		}
	}
	ids := map[string]bool{}
	for _, c := range rep.Checks {
		ids[c.ID] = true
	}
	for _, id := range []string{"repo:web", "repo:infra", "tool:docker", "docker:engine", "tool:node"} {
		if ids[id] {
			t.Errorf("api-only should not check %s", id)
		}
	}
	for _, id := range []string{"repo:api", "tool:go", "tool:git"} {
		if !ids[id] {
			t.Errorf("api-only should check %s", id)
		}
	}

	if _, err := Run(t.Context(), Input{Workspace: w, Stacks: stacks, Root: root, Stack: "nope", Probes: f.probes()}); !errors.Is(err, ErrNoSuchStack) {
		t.Errorf("unknown stack: %v", err)
	}
	if _, err := Run(t.Context(), Input{Probes: f.probes()}); err == nil {
		t.Error("a missing workspace should be an error")
	}
}

func TestPortsHeldByRunningServicesAreFine(t *testing.T) {
	root, w, stacks := project(t)
	f := newFake()
	f.busy = map[int]bool{8080: true}

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root, OwnPorts: map[int]bool{8080: true}}, f)
	if c := find(t, rep, "stack:full:api:port"); c.Status != OK {
		t.Errorf("own port: %+v", c)
	}
}

func TestPathsCannotLeaveTheWorkspace(t *testing.T) {
	root, w, stacks := project(t)
	w.Repos[0].Path = "../elsewhere"
	stacks[0].Services[1].Dir = "../../etc"

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root}, newFake())
	if c := find(t, rep, "repo:api"); c.Status != Fail || !strings.Contains(c.Detail, "leaves") {
		t.Errorf("repo: %+v", c)
	}
	if c := find(t, rep, "stack:full:web:dir"); c.Status != Fail {
		t.Errorf("dir: %+v", c)
	}
}

func TestGitIdentity(t *testing.T) {
	root, w, stacks := project(t)
	f := newFake()
	delete(f.git, "|user.email")
	f.git[filepath.Join(root, "api")+"|user.email"] = "someone@else.org"

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root}, f)

	global := find(t, rep, "git:identity")
	if global.Status != Warn || len(global.Fix) != 1 || !strings.Contains(global.Fix[0], "--global user.email") {
		t.Errorf("global: %+v", global)
	}
	mismatch := find(t, rep, "git:identity:api")
	if mismatch.Status != Warn || !strings.Contains(mismatch.Detail, "someone@else.org") || len(mismatch.Fix) != 2 {
		t.Errorf("api identity: %+v", mismatch)
	}
	if c := find(t, rep, "git:identity:web"); c.Status != Warn || !strings.Contains(c.Detail, "No email is set") {
		t.Errorf("web identity: %+v", c)
	}
	if !rep.Ready() {
		t.Error("warnings alone must not block a stack")
	}

	// no connection means no identity to compare with
	w.DefaultConnection = ""
	rep = run(t, Input{Workspace: w, Stacks: stacks, Root: root}, f)
	if slices.ContainsFunc(rep.Checks, func(c Check) bool { return strings.HasPrefix(c.ID, "git:identity:") }) {
		t.Error("repo identity checks should be skipped without a connection")
	}
}

type fakePlugin struct{ m sdk.Manifest }

func (p fakePlugin) Manifest() sdk.Manifest               { return p.m }
func (p fakePlugin) Check(context.Context) sdk.ToolStatus { return sdk.ToolStatus{State: sdk.StateOK} }

func TestPluginInstallHintsWin(t *testing.T) {
	root, w, stacks := project(t)
	reg := sdk.NewRegistry()
	must(t, reg.Register(fakePlugin{sdk.Manifest{
		ID: "docker", Name: "Docker",
		Needs: []sdk.Need{{Binary: "docker", MinVersion: "25", Install: []sdk.InstallMethod{{Method: "manual", Command: "from the plugin"}}}},
	}}))
	f := newFake()
	f.missing = map[string]bool{"docker": true}

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root, Plugins: reg}, f)
	c := find(t, rep, "tool:docker")
	if c.Title != "Docker 25 or newer" || len(c.Fix) != 1 || c.Fix[0] != "from the plugin" {
		t.Errorf("docker: %+v", c)
	}
}

func TestCommandsKeepPathsAsTheyAre(t *testing.T) {
	root, w, stacks := project(t)
	must(t, os.RemoveAll(filepath.Join(root, "api")))
	f := newFake()

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root}, f)
	want := `git clone https://github.com/acme/api.git "` + filepath.Join(root, "api") + `"`
	if c := find(t, rep, "repo:api"); len(c.Fix) != 1 || c.Fix[0] != want {
		t.Errorf("clone command = %v, want %q", c.Fix, want)
	}
}

func TestRequiresAndSeveralComposeFiles(t *testing.T) {
	root, w, stacks := project(t)
	w.Repos = append(w.Repos, workspace.Repo{ID: "vault", Path: "vault", Type: "docker"})
	must(t, os.MkdirAll(filepath.Join(root, "vault"), 0o750))
	must(t, os.WriteFile(filepath.Join(root, "vault", "docker-compose.yml"), []byte("services: {}\n"), 0o600))
	stacks[0].Compose = workspace.Composes{
		{Repo: "infra", File: "docker-compose.yml"},
		{Repo: "vault", File: "docker-compose.yml"},
		{Repo: "vault", File: "missing.yml"},
	}
	stacks[0].Requires = []workspace.Require{
		{Name: "Postgres", TCP: "127.0.0.1:5432"},
		{Name: "Cache", TCP: "127.0.0.1:6379"},
	}
	f := newFake()
	f.down["127.0.0.1:6379"] = true

	rep := run(t, Input{Workspace: w, Stacks: stacks, Root: root, Stack: "full"}, f)

	if c := find(t, rep, "stack:full:compose:2"); c.Status != OK || !strings.HasPrefix(c.Title, "vault: ") {
		t.Errorf("second compose file = %+v", c)
	}
	if c := find(t, rep, "stack:full:compose:3"); c.Status != Fail || !strings.Contains(c.Detail, "There is no file") {
		t.Errorf("third compose file = %+v", c)
	}
	if c := find(t, rep, "stack:full:requires:1"); c.Status != OK {
		t.Errorf("Postgres = %+v", c)
	}
	c := find(t, rep, "stack:full:requires:2")
	if c.Status != Fail || c.Detail != "Cache doesn't answer on 127.0.0.1:6379." || len(c.Fix) != 1 {
		t.Errorf("Cache = %+v", c)
	}
	if rep.Ready() {
		t.Error("a requirement that doesn't answer should stop the stack")
	}
}
