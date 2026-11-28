package scripts

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/gitx"
)

func TestValidate(t *testing.T) {
	tests := []struct {
		name   string
		script Script
		want   string // part of the error; "" for none
	}{
		{"a git script", Script{ID: "sync-dev", Steps: []Step{{Git: GitFetch}, {Git: GitCheckout, Branch: "dev"}, {Git: GitPull}}}, ""},
		{"a command", Script{ID: "test", Steps: []Step{{Run: "npm test"}}}, ""},
		{"a bad id", Script{ID: "Sync Dev", Steps: []Step{{Git: GitFetch}}}, "id must be"},
		{"no steps", Script{ID: "x"}, "no steps"},
		{"both git and run", Script{ID: "x", Steps: []Step{{Git: GitFetch, Run: "ls"}}}, "either git or run"},
		{"neither", Script{ID: "x", Steps: []Step{{}}}, "either git or run"},
		{"push is not offered", Script{ID: "x", Steps: []Step{{Git: "push"}}}, "fetch, pull, checkout or status"},
		{"checkout without a branch", Script{ID: "x", Steps: []Step{{Git: GitCheckout}}}, "branch name"},
		{"checkout of an option", Script{ID: "x", Steps: []Step{{Git: GitCheckout, Branch: "--force"}}}, "branch name"},
		{"for_each other than repo", Script{ID: "x", ForEach: "host", Steps: []Step{{Git: GitFetch}}}, "for_each"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.script.Validate()
			if tc.want == "" && err != nil {
				t.Fatalf("Validate() = %v, want nil", err)
			}
			if tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("Validate() = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestWritesAndLabels(t *testing.T) {
	tests := []struct {
		name   string
		steps  []Step
		writes bool
		labels []string
	}{
		{"fetch and status only read", []Step{{Git: GitFetch}, {Git: GitStatus}}, false, []string{"fetch", "status"}},
		{"pull writes", []Step{{Git: GitFetch}, {Git: GitPull}}, true, []string{"fetch", "pull"}},
		{"checkout writes", []Step{{Git: GitCheckout, Branch: "dev"}}, true, []string{"checkout dev"}},
		{"a command may write", []Step{{Run: "npm test"}}, true, []string{"npm test"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := Script{ID: "x", Steps: tc.steps}
			if s.Writes() != tc.writes {
				t.Errorf("Writes() = %v, want %v", s.Writes(), tc.writes)
			}
			var got []string
			for _, st := range tc.steps {
				got = append(got, st.Label())
			}
			if !reflect.DeepEqual(got, tc.labels) {
				t.Errorf("labels = %v, want %v", got, tc.labels)
			}
		})
	}
}

func TestBuiltInsAreValid(t *testing.T) {
	for _, s := range BuiltIns() {
		if err := s.Validate(); err != nil {
			t.Errorf("%s: %v", s.ID, err)
		}
		if s.Source != SourceBuiltIn {
			t.Errorf("%s: source %q", s.ID, s.Source)
		}
	}
}

func TestFound(t *testing.T) {
	dir := t.TempDir()
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("package.json", `{"scripts": {"test": "vitest", "dev": "vite", "bad name; rm": "x"}}`)
	write("Makefile", ".PHONY: lint\nlint:\n\tgo vet ./...\nbuild: lint\n\tgo build\nVERSION := 1\n%.o: %.c\nlint:\n")
	got := Found("api", dir)
	var titles []string
	for _, s := range got {
		titles = append(titles, s.Title)
		if s.Repo != "api" || s.Validate() != nil {
			t.Errorf("%+v isn't a valid script for api", s)
		}
	}
	want := []string{"npm run dev", "npm run test", "make lint", "make build"}
	if !reflect.DeepEqual(titles, want) {
		t.Errorf("titles = %v, want %v", titles, want)
	}
	if got := Found("web", t.TempDir()); len(got) != 0 {
		t.Errorf("an empty folder found %v", got)
	}
}

func TestTargets(t *testing.T) {
	repos := []Repo{{ID: "api"}, {ID: "web"}}
	tests := []struct {
		name   string
		script Script
		want   []string
	}{
		{"for each repo", Script{ForEach: "repo", Steps: []Step{{Run: "make"}}}, []string{"api", "web"}},
		{"git steps run in every repo", Script{Steps: []Step{{Git: GitFetch}}}, []string{"api", "web"}},
		{"a command once runs in the first", Script{Steps: []Step{{Run: "make"}}}, []string{"api"}},
		{"a found script runs in its repo", Script{Repo: "web", Steps: []Step{{Run: "npm test"}}}, []string{"web"}},
		{"a repo that is gone gives none", Script{Repo: "docs", Steps: []Step{{Run: "make"}}}, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			for _, r := range Targets(tc.script, repos) {
				got = append(got, r.ID)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("Targets = %v, want %v", got, tc.want)
			}
		})
	}
}

// fakeGit answers Work from a table and records what it ran.
type fakeGit struct {
	mu   sync.Mutex
	work map[string]gitx.Work
	ran  []string
	fail map[string]bool
}

func (g *fakeGit) Work(_ context.Context, dir string) (gitx.Work, error) {
	return g.work[dir], nil
}

func (g *fakeGit) Run(_ context.Context, dir string, op gitx.Operation) (string, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.ran = append(g.ran, dir+": "+strings.Join(op.Args, " "))
	if g.fail[dir+":"+op.Name] {
		return "", errors.New("git " + op.Name + " failed: rejected")
	}
	return "done", nil
}

// wait follows a run until it finishes.
func wait(t *testing.T, rn *Runner, id string) Run {
	t.Helper()
	for i := 0; i < 200; i++ {
		if r, _ := rn.Get(id); r.State != StateRunning {
			return r
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the run didn't finish")
	return Run{}
}

func TestRunSkipsDirtyReposAndStopsAtAFailure(t *testing.T) {
	git := &fakeGit{
		work: map[string]gitx.Work{
			"/api":  {Branch: "main", Upstream: "origin/main"},
			"/web":  {Branch: "main", Upstream: "origin/main", Changed: 2},
			"/docs": {Branch: "dev", Upstream: "origin/dev"},
		},
		fail: map[string]bool{"/docs:pull": true},
	}
	rn := &Runner{Git: git}
	syncDev := BuiltIns()[1] // fetch, checkout dev, pull
	started := rn.Start("acme", syncDev, []Repo{{"api", "/api"}, {"web", "/web"}, {"docs", "/docs"}})
	if started.State != StateRunning || len(started.Repos) != 3 {
		t.Fatalf("started = %+v", started)
	}
	run := wait(t, rn, started.ID)

	states := map[string]string{}
	for _, r := range run.Repos {
		states[r.Repo] = r.State
	}
	if want := map[string]string{"api": StateOK, "web": StateSkipped, "docs": StateFailed}; !reflect.DeepEqual(states, want) {
		t.Errorf("states = %v, want %v", states, want)
	}
	if web := run.Repos[1]; web.Steps[0].State != StateOK || web.Steps[1].State != StateSkipped || !strings.Contains(web.Reason, "uncommitted") {
		t.Errorf("web = %+v: fetch runs, then it is skipped before checkout", web)
	}
	if docs := run.Repos[2]; docs.Steps[1].Output != "already on dev" || docs.Steps[2].State != StateFailed {
		t.Errorf("docs = %+v", docs)
	}
	for _, ran := range git.ran {
		if strings.HasPrefix(ran, "/web: checkout") || strings.HasPrefix(ran, "/web: pull") {
			t.Errorf("ran %q in the dirty repo", ran)
		}
	}
	if run.State != StateFailed || run.Finished == nil {
		t.Errorf("run = %s, finished %v", run.State, run.Finished)
	}
	if got := run.Summary(); got != "3 repos · 1 ok · 1 skipped · 1 failed" {
		t.Errorf("Summary = %q", got)
	}
	if latest := rn.Latest("acme"); latest["sync-dev"].ID != run.ID {
		t.Errorf("Latest = %+v", latest)
	}
}

func TestRunStatusAndCommands(t *testing.T) {
	git := &fakeGit{work: map[string]gitx.Work{"/api": {Branch: "dev", Behind: 2, Changed: 3}}}
	var gotDir string
	var gotArgs []string
	rn := &Runner{Git: git, Exec: func(_ context.Context, dir string, args []string) (string, error) {
		gotDir, gotArgs = dir, args
		return "tests passed", nil
	}}
	status := wait(t, rn, rn.Start("acme", BuiltIns()[2], []Repo{{"api", "/api"}}).ID)
	if out := status.Repos[0].Steps[0].Output; out != "dev · 2 behind · 3 changed" || status.Repos[0].State != StateOK {
		t.Errorf("status = %+v (status reads a dirty repo, it doesn't skip it)", status.Repos[0])
	}

	test := wait(t, rn, rn.Start("acme", Script{ID: "npm:api:test", Repo: "api", Steps: []Step{{Run: `npm run "unit tests"`}}}, []Repo{{"api", "/api"}}).ID)
	if test.Repos[0].Steps[0].Output != "tests passed" || gotDir != "/api" || !reflect.DeepEqual(gotArgs, []string{"npm", "run", "unit tests"}) {
		t.Errorf("command ran %q %v -> %+v", gotDir, gotArgs, test.Repos[0])
	}

	shell := wait(t, rn, rn.Start("acme", Script{ID: "x", Steps: []Step{{Run: "make && make test"}}}, []Repo{{"api", "/api"}}).ID)
	if s := shell.Repos[0].Steps[0]; s.State != StateFailed || !strings.Contains(s.Output, "needs a shell") {
		t.Errorf("a shell command = %+v, want it refused", s)
	}
}

func TestRunnerKeepsTheLatestRuns(t *testing.T) {
	rn := &Runner{Git: &fakeGit{work: map[string]gitx.Work{}}, Keep: 2}
	var ids []string
	for i := 0; i < 4; i++ {
		ids = append(ids, wait(t, rn, rn.Start("acme", BuiltIns()[2], nil).ID).ID)
	}
	if _, ok := rn.Get(ids[0]); ok {
		t.Error("the oldest run is still kept")
	}
	if _, ok := rn.Get(ids[3]); !ok {
		t.Error("the newest run is gone")
	}
}
