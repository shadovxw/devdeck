package gitx

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorktreeAddAndRemove(t *testing.T) {
	ctx := context.Background()
	g := opsGit(t)
	dir := t.TempDir()
	mustGit(t, g, dir, "init", "-q", "-b", "main")
	commit(t, g, dir, "a.txt", "one")
	mustGit(t, g, dir, "switch", "-q", "-c", "feat")
	commit(t, g, dir, "b.txt", "two")
	mustGit(t, g, dir, "switch", "-q", "main")

	rev, err := g.Rev(ctx, dir, "feat")
	if want := mustGit(t, g, dir, "rev-parse", "feat"); err != nil || rev != want || len(rev) != 40 {
		t.Errorf("Rev = %q, %v, want %q", rev, err, want)
	}
	for _, bad := range []string{"nope", "-x", "", "a b"} {
		if _, err := g.Rev(ctx, dir, bad); err == nil {
			t.Errorf("Rev(%q) should fail", bad)
		}
	}

	// A hook of the repository must not run when devdeck checks a branch out for a tool.
	marker := filepath.Join(t.TempDir(), "hook-ran")
	hook := filepath.Join(dir, ".git", "hooks", "post-checkout")
	script := "#!/bin/sh\ntouch '" + filepath.ToSlash(marker) + "'\n"
	if err := os.WriteFile(hook, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	wt := filepath.Join(t.TempDir(), "wt")
	if err := g.WorktreeAdd(ctx, dir, wt, "feat"); err != nil {
		t.Fatalf("WorktreeAdd: %v", err)
	}
	if _, err := os.Stat(filepath.Join(wt, "b.txt")); err != nil {
		t.Errorf("the checkout holds the branch's files: %v", err)
	}
	if _, err := os.Stat(marker); err == nil {
		t.Errorf("the repository's post-checkout hook ran")
	}
	if got := mustGit(t, g, dir, "branch", "--show-current"); got != "main" {
		t.Errorf("the repository's own checkout moved to %q", got)
	}
	// detached, so the same branch can be checked out twice
	wt2 := filepath.Join(t.TempDir(), "wt2")
	if err := g.WorktreeAdd(ctx, dir, wt2, "feat"); err != nil {
		t.Errorf("a second checkout of the same branch: %v", err)
	}
	if err := g.WorktreeAdd(ctx, dir, filepath.Join(t.TempDir(), "x"), "--detach"); err == nil {
		t.Errorf("a ref that looks like an option must be refused")
	}

	for _, p := range []string{wt, wt2} {
		if err := g.WorktreeRemove(ctx, dir, p); err != nil {
			t.Errorf("WorktreeRemove: %v", err)
		}
		if _, err := os.Stat(p); err == nil {
			t.Errorf("%s should be gone", p)
		}
	}
	if n := len(strings.Split(mustGit(t, g, dir, "worktree", "list"), "\n")); n != 1 {
		t.Errorf("git still lists %d worktrees", n)
	}
	// removing what is already gone is not an error: the stale entry is pruned
	gone := filepath.Join(t.TempDir(), "gone")
	if err := g.WorktreeAdd(ctx, dir, gone, "feat"); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(gone); err != nil {
		t.Fatal(err)
	}
	if err := g.WorktreeRemove(ctx, dir, gone); err != nil {
		t.Errorf("WorktreeRemove of a folder that is already gone: %v", err)
	}
	if n := len(strings.Split(mustGit(t, g, dir, "worktree", "list"), "\n")); n != 1 {
		t.Errorf("the stale entry should be pruned, git lists %d", n)
	}
}
