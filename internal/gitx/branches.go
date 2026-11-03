package gitx

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// These are read-only questions about branches. Features (a plan, its PRs, its worktrees) are built
// from them. Nothing here changes a repository.

// safeRef is what a branch or revision may look like when it is handed to git: it can't start with a
// dash, so it can never be taken for an option.
var safeRef = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$`)

// SafeRef reports whether name is fit to pass to git as a branch or revision.
func SafeRef(name string) bool { return safeRef.MatchString(name) }

// BranchSet is the branches a repository has: its own, and the ones it has fetched from origin.
type BranchSet struct {
	Local  map[string]bool
	Remote map[string]bool
}

// Has reports whether the branch exists locally or on origin.
func (b BranchSet) Has(name string) bool { return b.Local[name] || b.Remote[name] }

// Ref is the name to give git for the branch: the local one when there is one, else origin's.
// "" when neither exists.
func (b BranchSet) Ref(name string) string {
	switch {
	case b.Local[name]:
		return name
	case b.Remote[name]:
		return "origin/" + name
	}
	return ""
}

// Branches lists the branches of the repository in dir, with no network call (origin's are the ones
// the last fetch saw).
func (g Git) Branches(ctx context.Context, dir string) (BranchSet, error) {
	out, code, err := g.run(ctx, dir, "for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes/origin")
	if err != nil || code != 0 {
		return BranchSet{}, fmt.Errorf("git couldn't list the branches of %s", dir)
	}
	set := BranchSet{Local: map[string]bool{}, Remote: map[string]bool{}}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimSpace(line)
		if name, ok := strings.CutPrefix(line, "refs/heads/"); ok {
			set.Local[name] = true
		} else if name, ok := strings.CutPrefix(line, "refs/remotes/origin/"); ok && name != "HEAD" {
			set.Remote[name] = true
		}
	}
	return set, nil
}

// DiffStat is how big a branch's change is.
type DiffStat struct {
	Files   int `json:"files"`
	Added   int `json:"added"`
	Deleted int `json:"deleted"`
}

// Size is the lines added and deleted together.
func (d DiffStat) Size() int { return d.Added + d.Deleted }

// ParseNumstat reads `git diff --numstat`. A binary file counts as a file with no lines.
func ParseNumstat(out string) DiffStat {
	var d DiffStat
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(strings.TrimSpace(line), "\t")
		if len(f) < 3 {
			continue
		}
		d.Files++
		if n, err := strconv.Atoi(f[0]); err == nil {
			d.Added += n
		}
		if n, err := strconv.Atoi(f[1]); err == nil {
			d.Deleted += n
		}
	}
	return d
}

// DiffStat is the change a branch makes on top of its base (base...branch: since the two diverged).
func (g Git) DiffStat(ctx context.Context, dir, base, branch string) (DiffStat, error) {
	if !SafeRef(base) || !SafeRef(branch) {
		return DiffStat{}, fmt.Errorf("%q or %q isn't a branch name", base, branch)
	}
	out, code, err := g.run(ctx, dir, "diff", "--numstat", base+"..."+branch)
	if err != nil || code != 0 {
		return DiffStat{}, fmt.Errorf("git couldn't compare %s with %s", branch, base)
	}
	return ParseNumstat(out), nil
}

// Commit is one commit of a branch.
type Commit struct {
	Hash    string `json:"hash"`
	Subject string `json:"subject"`
}

// Commits lists the commits a branch has that its base doesn't (base..branch), newest first, at most limit.
func (g Git) Commits(ctx context.Context, dir, base, branch string, limit int) ([]Commit, error) {
	if !SafeRef(base) || !SafeRef(branch) {
		return nil, fmt.Errorf("%q or %q isn't a branch name", base, branch)
	}
	out, code, err := g.run(ctx, dir, "log", "--format=%h%x09%s", "-n", strconv.Itoa(limit), base+".."+branch)
	if err != nil || code != 0 {
		return nil, fmt.Errorf("git couldn't list the commits of %s", branch)
	}
	var list []Commit
	for _, line := range strings.Split(out, "\n") {
		if hash, subject, ok := strings.Cut(strings.TrimSpace(line), "\t"); ok {
			list = append(list, Commit{Hash: hash, Subject: subject})
		}
	}
	return list, nil
}

// Worktree is one checked-out working folder of a repository.
type Worktree struct {
	Path string `json:"path"`
	// Branch is the short branch name; empty for a detached head.
	Branch string `json:"branch"`
}

// ParseWorktrees reads `git worktree list --porcelain`.
func ParseWorktrees(out string) []Worktree {
	var list []Worktree
	var cur *Worktree
	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "worktree "):
			list = append(list, Worktree{Path: strings.TrimPrefix(line, "worktree ")})
			cur = &list[len(list)-1]
		case cur != nil && strings.HasPrefix(line, "branch "):
			cur.Branch = strings.TrimPrefix(strings.TrimPrefix(line, "branch "), "refs/heads/")
		}
	}
	return list
}

// Worktrees lists the working folders of the repository in dir, the main one first.
func (g Git) Worktrees(ctx context.Context, dir string) ([]Worktree, error) {
	out, code, err := g.run(ctx, dir, "worktree", "list", "--porcelain")
	if err != nil || code != 0 {
		return nil, fmt.Errorf("git couldn't list the worktrees of %s", dir)
	}
	return ParseWorktrees(out), nil
}

// Files lists the files of a branch (or any revision), as paths with forward slashes.
func (g Git) Files(ctx context.Context, dir, rev string) ([]string, error) {
	if !SafeRef(rev) {
		return nil, fmt.Errorf("%q isn't a branch name", rev)
	}
	out, code, err := g.run(ctx, dir, "ls-tree", "-r", "--name-only", rev)
	if err != nil || code != 0 {
		return nil, fmt.Errorf("git couldn't list the files of %s", rev)
	}
	var files []string
	for _, line := range strings.Split(out, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			files = append(files, line)
		}
	}
	return files, nil
}

// Show reads one file of a branch without checking it out. path is relative to the repository, and
// the answer is cut at 256 KiB.
func (g Git) Show(ctx context.Context, dir, rev, path string) (string, error) {
	if !SafeRef(rev) {
		return "", fmt.Errorf("%q isn't a branch name", rev)
	}
	name := g.Path
	if name == "" {
		name = "git"
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: name, Args: []string{"-C", dir, "show", rev + ":" + path}, Env: g.Env, Timeout: 15 * time.Second})
	if err != nil || !res.OK() {
		return "", fmt.Errorf("git couldn't read %s on %s", path, rev)
	}
	if len(res.Stdout) > maxFileBytes {
		return res.Stdout[:maxFileBytes], nil
	}
	return res.Stdout, nil
}
