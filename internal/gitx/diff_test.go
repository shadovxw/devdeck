package gitx

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiffIsTheBranchsOwnChangeWithoutTheFilesToSkip(t *testing.T) {
	ctx := context.Background()
	g := opsGit(t)
	dir := t.TempDir()
	mustGit(t, g, dir, "init", "-q", "-b", "main")
	commit(t, g, dir, "a.txt", "one\n")
	mustGit(t, g, dir, "switch", "-q", "-c", "feat")
	if err := os.MkdirAll(filepath.Join(dir, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	commit(t, g, dir, "b.txt", "the branch's change\n")
	commit(t, g, dir, ".env", "SAMPLE=left-out-one\n")
	commit(t, g, dir, "sub/site.pem", "left-out-two\n")
	mustGit(t, g, dir, "switch", "-q", "main")
	commit(t, g, dir, "c.txt", "made on main after the branch was cut\n")

	got, err := g.Diff(ctx, dir, "main", "feat", []string{".env*", "*.pem"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, "diff --git a/b.txt b/b.txt") || !strings.Contains(got, "+the branch's change") {
		t.Errorf("the branch's change is missing:\n%s", got)
	}
	for _, never := range []string{"left-out-one", "left-out-two", ".env", "site.pem"} {
		if strings.Contains(got, never) {
			t.Errorf("%q should be skipped, in every folder:\n%s", never, got)
		}
	}
	// base...branch is the change since the two diverged, so main's later commit isn't in it
	if strings.Contains(got, "c.txt") {
		t.Errorf("a commit made on the base after the branch was cut must not show:\n%s", got)
	}

	all, err := g.Diff(ctx, dir, "main", "feat", nil)
	if err != nil || !strings.Contains(all, "left-out-one") || !strings.Contains(all, "left-out-two") {
		t.Errorf("with nothing to skip every file shows: %v\n%s", err, all)
	}
}

func TestDiffRefusesWhatIsNotABranch(t *testing.T) {
	ctx := context.Background()
	g := opsGit(t)
	dir := t.TempDir()
	mustGit(t, g, dir, "init", "-q", "-b", "main")
	commit(t, g, dir, "a.txt", "one\n")
	for _, c := range [][2]string{{"main", "--output=x"}, {"-x", "main"}, {"main", "no-such-branch"}, {"", "main"}} {
		if _, err := g.Diff(ctx, dir, c[0], c[1], nil); err == nil {
			t.Errorf("Diff(%q, %q) should fail", c[0], c[1])
		}
	}
}
