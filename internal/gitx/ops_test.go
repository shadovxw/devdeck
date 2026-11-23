package gitx

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseWork(t *testing.T) {
	for name, tc := range map[string]struct {
		in   string
		want Work
	}{
		"clean, level with upstream": {
			"# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n",
			Work{Branch: "main", Upstream: "origin/main"},
		},
		"ahead, behind and changes": {
			"# branch.head feat/x\n# branch.upstream origin/feat/x\n# branch.ab +2 -3\n1 .M N... 100644 100644 100644 a b file.go\n2 R. N... 100644 100644 100644 a b R100 new.go\told.go\nu UU N... 1 2 3 4 a b c conflict.go\n? untracked.txt\n! ignored.log\n",
			Work{Branch: "feat/x", Upstream: "origin/feat/x", Ahead: 2, Behind: 3, Changed: 4},
		},
		"no upstream": {"# branch.oid abc\n# branch.head topic\n", Work{Branch: "topic"}},
		"detached":    {"# branch.oid abc\n# branch.head (detached)\n", Work{Detached: true}},
		"crlf":        {"# branch.head main\r\n# branch.ab +1 -0\r\n", Work{Branch: "main", Ahead: 1}},
		"odd counts":  {"# branch.head main\n# branch.ab +x -y\n", Work{Branch: "main"}},
		"empty":       {"", Work{}},
	} {
		if got := ParseWork(tc.in); got != tc.want {
			t.Errorf("%s: %+v, want %+v", name, got, tc.want)
		}
	}
}

func TestPlan(t *testing.T) {
	const dir = "C:/work/api"
	tracked := Work{Branch: "main", Upstream: "origin/main", Ahead: 1}
	for name, tc := range map[string]struct {
		op      string
		w       Work
		command string
		err     string
		nothing bool
	}{
		"fetch":                 {OpFetch, tracked, `git -C "C:/work/api" fetch --prune origin`, "", false},
		"fetch with no branch":  {OpFetch, Work{Detached: true}, `git -C "C:/work/api" fetch --prune origin`, "", false},
		"pull":                  {OpPull, tracked, `git -C "C:/work/api" pull --ff-only`, "", false},
		"pull with no upstream": {OpPull, Work{Branch: "topic"}, "", "tracks no upstream", false},
		"pull when detached":    {OpPull, Work{Detached: true}, "", "detached", false},
		"push":                  {OpPush, tracked, `git -C "C:/work/api" push`, "", false},
		"push a new branch":     {OpPush, Work{Branch: "topic"}, `git -C "C:/work/api" push -u origin topic`, "", false},
		"push with nothing":     {OpPush, Work{Branch: "main", Upstream: "origin/main"}, "", "no commits are waiting", true},
		"push when detached":    {OpPush, Work{Detached: true}, "", "detached", false},
		"something else":        {"rebase", tracked, "", "unknown operation", false},
	} {
		op, err := Plan(tc.op, dir, tc.w)
		if tc.err != "" {
			if err == nil || !strings.Contains(err.Error(), tc.err) || errors.Is(err, ErrNothingToDo) != tc.nothing {
				t.Errorf("%s: err = %v", name, err)
			}
			continue
		}
		if err != nil || op.Command != tc.command {
			t.Errorf("%s: %q, %v, want %q", name, op.Command, err, tc.command)
		}
		if strings.Contains(op.Command, "--force") || strings.Contains(op.Command, " -f ") {
			t.Errorf("%s: a forced push must never be offered: %s", name, op.Command)
		}
	}
	// Commands leaves out what can't run
	cmds := Commands(dir, Work{Branch: "main", Upstream: "origin/main"})
	if _, ok := cmds[OpPush]; ok || cmds[OpFetch] == "" || cmds[OpPull] == "" {
		t.Errorf("commands = %v", cmds)
	}
}

func TestCloneAddress(t *testing.T) {
	for in, want := range map[string]string{
		"https://github.com/acme/api.git":           "https://github.com/acme/api.git",
		"https://me:secret@github.com/acme/api.git": "https://github.com/acme/api.git",
		"https://GitHub.com/acme/api":               "https://GitHub.com/acme/api",
		"git@github.com:acme/api.git":               "",
		"ssh://git@github.com/acme/api.git":         "",
		"http://github.com/acme/api.git":            "",
		"https://gitlab.com/acme/api.git":           "",
		"https://github.com.evil.example/acme/api":  "",
		"https://github.com/acme":                   "",
		"--upload-pack=calc":                        "",
		"C:/somewhere/local":                        "",
		"":                                          "",
	} {
		got, ok := CloneAddress(in)
		if got != want || ok != (want != "") {
			t.Errorf("CloneAddress(%q) = %q, %v, want %q", in, got, ok, want)
		}
	}
}

// opsGit is isolated git with an author, so commits can be made.
func opsGit(t *testing.T) Git {
	g := isolatedGit(t)
	g.Env = append(g.Env, "GIT_AUTHOR_NAME=Tester", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=Tester", "GIT_COMMITTER_EMAIL=t@example.com")
	return g
}

func mustGit(t *testing.T, g Git, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), g.Env...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}

func commit(t *testing.T, g Git, dir, file, text string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, file), []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	mustGit(t, g, dir, "add", file)
	mustGit(t, g, dir, "commit", "-q", "-m", "change "+file)
}

func TestOperationsAgainstARealRemote(t *testing.T) {
	g := opsGit(t)
	ctx := context.Background()

	// a remote with one commit on main
	remote := filepath.Join(t.TempDir(), "remote.git")
	mustGit(t, g, t.TempDir(), "init", "-q", "--bare", "-b", "main", remote)
	seed := filepath.Join(t.TempDir(), "seed")
	mustGit(t, g, t.TempDir(), "init", "-q", "-b", "main", seed)
	commit(t, g, seed, "a.txt", "one")
	mustGit(t, g, seed, "remote", "add", "origin", remote)
	mustGit(t, g, seed, "push", "-q", "-u", "origin", "main")

	// clone it twice; the first takes the connection's identity
	cn := Connection{ID: "office", User: "office-dev", Name: "Me Office", Email: "me@office.example"}
	first := filepath.Join(t.TempDir(), "nested", "first")
	if _, err := g.Clone(ctx, remote, first, &cn); err != nil {
		t.Fatal(err)
	}
	if got := mustGit(t, g, first, "config", "--local", "user.email"); got != "me@office.example" {
		t.Errorf("identity after clone = %q", got)
	}
	second := filepath.Join(t.TempDir(), "second")
	if _, err := g.Clone(ctx, remote, second, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := g.Clone(ctx, remote, first, nil); err == nil || !strings.Contains(err.Error(), "already has files") {
		t.Errorf("cloning into a folder with files in it: %v", err)
	}

	w, err := g.Work(ctx, first)
	if err != nil || w != (Work{Branch: "main", Upstream: "origin/main"}) {
		t.Fatalf("fresh clone: %+v %v", w, err)
	}

	// a commit in the first clone: ahead 1, and a dirty file counts
	commit(t, g, first, "b.txt", "two")
	if err := os.WriteFile(filepath.Join(first, "scratch.txt"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if w, _ = g.Work(ctx, first); w.Ahead != 1 || w.Behind != 0 || w.Changed != 1 {
		t.Fatalf("ahead: %+v", w)
	}
	push, err := Plan(OpPush, first, w)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Run(ctx, first, push); err != nil {
		t.Fatal(err)
	}
	if w, _ = g.Work(ctx, first); w.Ahead != 0 {
		t.Errorf("after the push: %+v", w)
	}

	// the second clone learns of it by fetching (behind 1), then fast-forwards
	w, _ = g.Work(ctx, second)
	fetch, _ := Plan(OpFetch, second, w)
	if _, err := g.Run(ctx, second, fetch); err != nil {
		t.Fatal(err)
	}
	if w, _ = g.Work(ctx, second); w.Behind != 1 {
		t.Fatalf("behind: %+v", w)
	}
	pull, err := Plan(OpPull, second, w)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.Run(ctx, second, pull); err != nil {
		t.Fatal(err)
	}
	if w, _ = g.Work(ctx, second); w.Behind != 0 {
		t.Errorf("after the pull: %+v", w)
	}

	// a branch with no upstream is pushed with -u, after which it has one
	mustGit(t, g, second, "checkout", "-q", "-b", "topic")
	commit(t, g, second, "c.txt", "three")
	w, _ = g.Work(ctx, second)
	push, err = Plan(OpPush, second, w)
	if err != nil || !strings.HasSuffix(push.Command, "push -u origin topic") {
		t.Fatalf("a new branch: %+v %v", push, err)
	}
	if _, err := g.Run(ctx, second, push); err != nil {
		t.Fatal(err)
	}
	if w, _ = g.Work(ctx, second); w.Upstream != "origin/topic" {
		t.Errorf("after pushing a new branch: %+v", w)
	}

	// a diverged branch refuses to pull and is left as it was
	mustGit(t, g, second, "checkout", "-q", "main")
	commit(t, g, second, "d.txt", "mine")
	commit(t, g, first, "e.txt", "theirs")
	mustGit(t, g, first, "push", "-q")
	mustGit(t, g, second, "fetch", "-q")
	before := mustGit(t, g, second, "rev-parse", "HEAD")
	w, _ = g.Work(ctx, second)
	pull, _ = Plan(OpPull, second, w)
	if _, err := g.Run(ctx, second, pull); err == nil || !strings.Contains(err.Error(), "git pull failed") {
		t.Errorf("a diverged pull: %v", err)
	}
	if after := mustGit(t, g, second, "rev-parse", "HEAD"); after != before {
		t.Errorf("a refused pull moved HEAD from %s to %s", before, after)
	}
}

func TestOperationFailuresAreExplained(t *testing.T) {
	g := opsGit(t)
	dir := repo(t, g, filepath.Join(t.TempDir(), "gone.git"))
	op, _ := Plan(OpFetch, dir, Work{Branch: "main"})
	if _, err := g.Run(context.Background(), dir, op); err == nil || !strings.Contains(err.Error(), "git fetch failed") {
		t.Errorf("fetch from a remote that isn't there: %v", err)
	}
	if _, err := g.Work(context.Background(), filepath.Join(t.TempDir(), "nope")); err == nil {
		t.Error("the status of a folder that isn't a repository")
	}
	long := strings.Repeat("x", 5000)
	if got := tail(long); len(got) > maxOutput+len("…") || !strings.HasPrefix(got, "…") {
		t.Errorf("tail kept %d bytes", len(got))
	}
}
