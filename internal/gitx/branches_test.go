package gitx

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestSafeRef(t *testing.T) {
	for ref, want := range map[string]bool{
		"main": true, "origin/feat-x": true, "acme-a1-blob.put": true, "plan/blob-archive": true,
		"": false, "-rf": false, "--upload-pack=x": false, "a b": false, "a;b": false, "a:b": false, ".hidden": false,
	} {
		if SafeRef(ref) != want {
			t.Errorf("SafeRef(%q) = %v, want %v", ref, !want, want)
		}
	}
}

func TestParseNumstat(t *testing.T) {
	got := ParseNumstat("10\t2\tinternal/a.go\n-\t-\tlogo.png\n0\t5\tb.go\n\nbad line\n")
	if got != (DiffStat{Files: 3, Added: 10, Deleted: 7}) {
		t.Errorf("numstat = %+v", got)
	}
	if got.Size() != 17 {
		t.Errorf("size = %d", got.Size())
	}
}

func TestParseWorktrees(t *testing.T) {
	out := "worktree C:/plans\nHEAD abc\nbranch refs/heads/main\n\nworktree C:/plans-wt/blob\nHEAD def\nbranch refs/heads/plan/blob-archive\n\nworktree C:/plans-wt/old\nHEAD 123\ndetached\n"
	got := ParseWorktrees(out)
	want := []Worktree{{"C:/plans", "main"}, {"C:/plans-wt/blob", "plan/blob-archive"}, {"C:/plans-wt/old", ""}}
	if !slices.Equal(got, want) {
		t.Errorf("worktrees = %+v, want %+v", got, want)
	}
}

func TestBranchSetRef(t *testing.T) {
	b := BranchSet{Local: map[string]bool{"a": true}, Remote: map[string]bool{"a": true, "b": true}}
	if b.Ref("a") != "a" || b.Ref("b") != "origin/b" || b.Ref("c") != "" || !b.Has("b") || b.Has("c") {
		t.Errorf("Ref/Has wrong: %q %q %q", b.Ref("a"), b.Ref("b"), b.Ref("c"))
	}
}

func TestBranchQuestionsAgainstARealRepository(t *testing.T) {
	ctx := context.Background()
	g := opsGit(t)
	dir := t.TempDir()
	mustGit(t, g, dir, "init", "-q", "-b", "main")
	commit(t, g, dir, "base.txt", "base\n")
	mustGit(t, g, dir, "switch", "-q", "-c", "plan/blob")
	commit(t, g, dir, "feature.yaml", "version: 1\n")
	commit(t, g, dir, "plan.md", "# plan\nline two\n")
	mustGit(t, g, dir, "switch", "-q", "main")

	set, err := g.Branches(ctx, dir)
	if err != nil {
		t.Fatal(err)
	}
	if !set.Local["main"] || !set.Local["plan/blob"] || len(set.Remote) != 0 {
		t.Errorf("branches = %+v", set)
	}

	st, err := g.DiffStat(ctx, dir, "main", "plan/blob")
	if err != nil || st.Files != 2 || st.Added != 3 || st.Deleted != 0 {
		t.Errorf("diffstat = %+v, %v (two files, three lines)", st, err)
	}
	commits, err := g.Commits(ctx, dir, "main", "plan/blob", 10)
	if err != nil || len(commits) != 2 || commits[0].Subject != "change plan.md" || !strings.Contains(commits[0].Date, "T") || commits[0].Hash == "" {
		t.Errorf("commits = %+v, %v (newest first)", commits, err)
	}
	if one, _ := g.Commits(ctx, dir, "main", "plan/blob", 1); len(one) != 1 {
		t.Errorf("limit not applied: %+v", one)
	}

	files, err := g.Files(ctx, dir, "plan/blob")
	if err != nil || !slices.Equal(files, []string{"base.txt", "feature.yaml", "plan.md"}) {
		t.Errorf("files = %v, %v", files, err)
	}
	text, err := g.Show(ctx, dir, "plan/blob", "plan.md")
	if err != nil || text != "# plan\nline two\n" {
		t.Errorf("show = %q, %v (the text exactly, with its newline)", text, err)
	}
	if _, err := g.Show(ctx, dir, "main", "plan.md"); err == nil {
		t.Errorf("a file that isn't on that branch must fail")
	}

	wt := filepath.Join(t.TempDir(), "wt")
	mustGit(t, g, dir, "worktree", "add", "-q", wt, "plan/blob")
	trees, err := g.Worktrees(ctx, dir)
	if err != nil || len(trees) != 2 || trees[1].Branch != "plan/blob" {
		t.Errorf("worktrees = %+v, %v", trees, err)
	}
	if _, err := os.Stat(filepath.Join(wt, "plan.md")); err != nil {
		t.Errorf("the worktree has the branch's files: %v", err)
	}
}

func TestBranchQuestionsRefuseOptionLookalikes(t *testing.T) {
	ctx := context.Background()
	g := opsGit(t)
	for name, err := range map[string]error{
		"diffstat": func() error { _, e := g.DiffStat(ctx, ".", "--output=x", "main"); return e }(),
		"commits":  func() error { _, e := g.Commits(ctx, ".", "main", "-p", 5); return e }(),
		"files":    func() error { _, e := g.Files(ctx, ".", "--help"); return e }(),
		"show":     func() error { _, e := g.Show(ctx, ".", "-x", "a"); return e }(),
	} {
		if err == nil || !strings.Contains(err.Error(), "isn't a branch name") {
			t.Errorf("%s: err = %v, want a refusal", name, err)
		}
	}
}
