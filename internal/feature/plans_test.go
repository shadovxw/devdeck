package feature

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// isolated is git with no user or system settings and an author, so tests don't depend on the machine.
func isolated(t *testing.T) gitx.Git {
	t.Helper()
	return gitx.Git{Env: []string{
		"GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_CONFIG_SYSTEM=" + os.DevNull, "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=Tester", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=Tester", "GIT_COMMITTER_EMAIL=t@example.com",
	}}
}

func run(t *testing.T, g gitx.Git, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), g.Env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func put(t *testing.T, dir, name, text string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, name)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
}

const tinyFeature = "version: 1\nfeature: acme\nrepos: [demo-api]\nprs:\n  - { id: a1, repo: demo-api, slug: x, title: First }\n"

// plansRepo makes a plans repository with: plan/blob (checked out in a worktree, with an edit not committed),
// plan/other (read through git only), plan/notes (no feature.yaml, so not a feature) and plan/broken (a bad file).
func plansRepo(t *testing.T) (gitx.Git, Env, string) {
	t.Helper()
	g := isolated(t)
	repo := t.TempDir()
	run(t, g, repo, "init", "-q", "-b", "main")
	put(t, repo, "README.md", "plans\n")
	run(t, g, repo, "add", ".")
	run(t, g, repo, "commit", "-q", "-m", "start")

	branch := func(name string, files map[string]string) {
		run(t, g, repo, "switch", "-q", "-c", name, "main")
		for f, text := range files {
			put(t, repo, f, text)
		}
		run(t, g, repo, "add", ".")
		run(t, g, repo, "commit", "-q", "-m", name)
	}
	branch("plan/blob", map[string]string{"feature.yaml": tinyFeature, "plan.md": "# plan\n"})
	branch("plan/other", map[string]string{"feature.yaml": strings.Replace(tinyFeature, "title: First", "title: Other first", 1), "reviews/a1-claude.md": "ok\n"})
	branch("plan/notes", map[string]string{"notes.md": "just notes\n"})
	branch("plan/broken", map[string]string{"feature.yaml": "version: 1\nfeature: x\nrepos: []\nprs: []\n"})
	run(t, g, repo, "switch", "-q", "main")

	wt := filepath.Join(t.TempDir(), "blob")
	run(t, g, repo, "worktree", "add", "-q", wt, "plan/blob")
	put(t, wt, "changes.md", "not committed yet\n")

	env := Env{Workspace: "demo", PlansRepo: repo, Repos: []workspace.Repo{{ID: "demo-api", Path: "api"}}, Root: t.TempDir()}
	return g, env, wt
}

func TestLoadPlans(t *testing.T) {
	g, env, wt := plansRepo(t)
	plans, err := LoadPlans(context.Background(), g, env)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, p := range plans {
		names = append(names, p.Name)
	}
	if !slices.Equal(names, []string{"blob", "broken", "other"}) {
		t.Fatalf("plans = %v: branches with a feature.yaml at the root, by name, and not plan/notes", names)
	}
	blob, broken, other := plans[0], plans[1], plans[2]
	if blob.Branch != "plan/blob" || blob.ReadOnly || filepath.Clean(blob.Worktree) != filepath.Clean(wt) || blob.File == nil {
		t.Errorf("blob = %+v (checked out, so it can be edited)", blob)
	}
	if !other.ReadOnly || other.Worktree != "" || other.File == nil || other.File.PRs[0].Title != "First" && other.File.PRs[0].Title != "Other first" {
		t.Errorf("other = %+v (no worktree: read with git)", other)
	}
	if other.File.PRs[0].Title != "Other first" {
		t.Errorf("other's file was not read from its own branch: %q", other.File.PRs[0].Title)
	}
	if broken.File != nil || !workspace.HasErrors(broken.Issues) {
		t.Errorf("a broken file keeps its problems and has no parsed file: %+v", broken)
	}
}

func TestPlanFiles(t *testing.T) {
	ctx := context.Background()
	g, env, wt := plansRepo(t)
	put(t, wt, "reviews/a1-x.md", "from a folder\n")
	plans, _ := LoadPlans(ctx, g, env)
	blob, other := &plans[0], &plans[2]

	if got := Files(ctx, g, env, blob); !slices.Equal(got, []string{"README.md", "changes.md", "feature.yaml", "plan.md", "reviews/a1-x.md"}) {
		t.Errorf("blob files = %v (from the folder, with the change not yet committed, and without .git)", got)
	}
	if got := Files(ctx, g, env, other); !slices.Equal(got, []string{"README.md", "feature.yaml", "reviews/a1-claude.md"}) {
		t.Errorf("other files = %v (from git)", got)
	}

	if text, err := ReadFile(ctx, g, env, blob, "changes.md"); err != nil || text != "not committed yet\n" {
		t.Errorf("a file only in the folder: %q, %v", text, err)
	}
	if text, err := ReadFile(ctx, g, env, blob, "reviews/a1-x.md"); err != nil || text != "from a folder\n" {
		t.Errorf("a file in a sub-folder of the worktree: %q, %v", text, err)
	}
	if _, err := ReadFile(ctx, g, env, blob, ".git"); err == nil {
		t.Errorf("the worktree's .git file isn't part of the plan")
	}
	if text, err := ReadFile(ctx, g, env, other, "reviews/a1-claude.md"); err != nil || text != "ok\n" {
		t.Errorf("a file read through git: %q, %v", text, err)
	}
	if _, err := ReadFile(ctx, g, env, other, "nope.md"); err == nil {
		t.Errorf("a missing file is an error")
	}
}

func TestReadFileStaysInsideThePlan(t *testing.T) {
	ctx := context.Background()
	g, env, _ := plansRepo(t)
	plans, _ := LoadPlans(ctx, g, env)
	for _, rel := range []string{"", "../x", "a/../../x", "/etc/passwd", `..\x`, "C:/x", "-p", ".git/config", "a//b", "./a", "a:b"} {
		for _, p := range []*Plan{&plans[0], &plans[2]} {
			if _, err := ReadFile(ctx, g, env, p, rel); err == nil || !strings.Contains(err.Error(), "isn't a file of the plan") {
				t.Errorf("%s: ReadFile(%q) err = %v, want a refusal", p.Name, rel, err)
			}
		}
	}
}

func TestLoadPlansWithoutARepository(t *testing.T) {
	g := isolated(t)
	if _, err := LoadPlans(context.Background(), g, Env{PlansRepo: filepath.Join(t.TempDir(), "missing")}); err != ErrNoPlansRepo {
		t.Errorf("a missing folder: %v", err)
	}
	if _, err := LoadPlans(context.Background(), g, Env{PlansRepo: t.TempDir()}); err != ErrNoPlansRepo {
		t.Errorf("a folder that isn't a repository: %v", err)
	}
}

func TestEnvOf(t *testing.T) {
	if _, ok := EnvOf("demo", "C:/ws/demo", &workspace.WorkspaceFile{}); ok {
		t.Errorf("no plans_repo, no env")
	}
	w := &workspace.WorkspaceFile{Root: "../code", PlansRepo: &workspace.PlansRepo{Path: "../plans", Worktrees: "../plans-wt"}, Repos: []workspace.Repo{{ID: "api", Path: "api"}, {ID: "evil", Path: "../../x"}}}
	e, ok := EnvOf("demo", filepath.FromSlash("/ws/demo"), w)
	if !ok || filepath.ToSlash(e.PlansRepo) != "/ws/plans" || filepath.ToSlash(e.Worktrees) != "/ws/plans-wt" || filepath.ToSlash(e.Root) != "/ws/code" {
		t.Errorf("env = %+v", e)
	}
	if dir, _, ok := e.RepoDir("api"); !ok || filepath.ToSlash(dir) != "/ws/code/api" {
		t.Errorf("RepoDir(api) = %q, %v", dir, ok)
	}
	if _, _, ok := e.RepoDir("evil"); ok {
		t.Errorf("a repo path that leaves the root is refused")
	}
	if _, _, ok := e.RepoDir("nope"); ok {
		t.Errorf("an unknown repo is refused")
	}
}
