package feature

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// PlanPrefix starts the branch of every plan in the plans repository: plan/<name>.
const PlanPrefix = "plan/"

// FileName is the file that makes a plan branch a feature.
const FileName = "feature.yaml"

var namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{0,59}$`)

// maxListed caps how many files of a plan are listed.
const maxListed = 500

// Git is what this package needs from git. gitx.Git is one.
type Git interface {
	Branches(ctx context.Context, dir string) (gitx.BranchSet, error)
	Worktrees(ctx context.Context, dir string) ([]gitx.Worktree, error)
	DiffStat(ctx context.Context, dir, base, branch string) (gitx.DiffStat, error)
	Commits(ctx context.Context, dir, base, branch string, limit int) ([]gitx.Commit, error)
	Rev(ctx context.Context, dir, ref string) (string, error)
	Files(ctx context.Context, dir, rev string) ([]string, error)
	Show(ctx context.Context, dir, rev, path string) (string, error)
}

// Env is the part of a workspace the feature code needs, with its folders worked out.
type Env struct {
	Workspace string
	Repos     []workspace.Repo
	// Root is the workspace root; PlansRepo and Worktrees are the plans repository's folders.
	Root      string
	PlansRepo string
	Worktrees string
}

// EnvOf reads the folders out of a workspace's file. ok is false when the workspace has no plans_repo.
func EnvOf(id, folder string, w *workspace.WorkspaceFile) (Env, bool) {
	if w == nil || w.PlansRepo == nil {
		return Env{}, false
	}
	e := Env{Workspace: id, Repos: w.Repos, Root: workspace.ResolveRoot(folder, w.Root), PlansRepo: workspace.ResolveRoot(folder, w.PlansRepo.Path)}
	if w.PlansRepo.Worktrees != "" {
		e.Worktrees = workspace.ResolveRoot(folder, w.PlansRepo.Worktrees)
	}
	return e, true
}

// RepoDir is where a workspace repo is on this machine. ok is false for an id the workspace doesn't
// have or a path that leaves the root.
func (e Env) RepoDir(id string) (string, workspace.Repo, bool) {
	for _, r := range e.Repos {
		if r.ID == id {
			dir, ok := workspace.JoinInside(e.Root, r.Path)
			return dir, r, ok
		}
	}
	return "", workspace.Repo{}, false
}

// Plan is one feature found in the plans repository.
type Plan struct {
	Workspace string `json:"workspace"`
	Name      string `json:"name"`
	// Branch is plan/<name>.
	Branch string `json:"branch"`
	// Worktree is the folder the branch is checked out in ("" when it isn't).
	Worktree string `json:"worktree,omitempty"`
	// ReadOnly means the branch is read with git and has no folder, so it can't be edited from there.
	ReadOnly bool `json:"read_only"`
	// File is the parsed feature.yaml; nil when it has errors, which are then in Issues.
	File   *workspace.FeatureFile `json:"-"`
	Issues []workspace.Issue      `json:"issues"`

	rev string
}

// ErrNoPlansRepo is returned when the plans repository folder isn't a git repository on this machine.
var ErrNoPlansRepo = errors.New("the plans repository isn't there: check plans_repo in workspace.yaml and that the folder is a git repository")

// LoadPlans finds the features in the plans repository: every branch plan/<name> whose root has a
// feature.yaml. A branch checked out in a worktree is read from its folder, so changes not yet
// committed show; any other is read from git. Sorted by name.
func LoadPlans(ctx context.Context, g Git, env Env) ([]Plan, error) {
	if st, err := os.Stat(env.PlansRepo); err != nil || !st.IsDir() {
		return nil, ErrNoPlansRepo
	}
	set, err := g.Branches(ctx, env.PlansRepo)
	if err != nil {
		return nil, ErrNoPlansRepo
	}
	trees, err := g.Worktrees(ctx, env.PlansRepo)
	if err != nil {
		return nil, ErrNoPlansRepo
	}
	checkedOut := map[string]string{}
	for _, t := range trees {
		if t.Branch != "" {
			checkedOut[t.Branch] = t.Path
		}
	}

	names := map[string]bool{}
	for _, m := range []map[string]bool{set.Local, set.Remote} {
		for b := range m {
			if name, ok := strings.CutPrefix(b, PlanPrefix); ok && namePattern.MatchString(name) {
				names[name] = true
			}
		}
	}
	var plans []Plan
	for name := range names {
		branch := PlanPrefix + name
		p := Plan{Workspace: env.Workspace, Name: name, Branch: branch, Worktree: checkedOut[branch], ReadOnly: checkedOut[branch] == "", rev: set.Ref(branch), Issues: []workspace.Issue{}}
		var data []byte
		if p.Worktree != "" {
			data, err = os.ReadFile(filepath.Join(p.Worktree, FileName))
		} else {
			var text string
			text, err = g.Show(ctx, env.PlansRepo, p.rev, FileName)
			data = []byte(text)
		}
		if err != nil {
			continue // not a feature: no feature.yaml at the root
		}
		f, issues := workspace.LoadFeature(FileName, data, env.Repos)
		p.File = f
		if issues != nil {
			p.Issues = issues
		}
		plans = append(plans, p)
	}
	slices.SortFunc(plans, func(a, b Plan) int { return strings.Compare(a.Name, b.Name) })
	return plans, nil
}

// CleanRel checks a path inside a plan: relative, forward slashes, no .. and nothing that looks like
// an option. It returns the path as git wants it.
func CleanRel(rel string) (string, bool) {
	if rel == "" || strings.ContainsAny(rel, "\\:\x00") || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "-") {
		return "", false
	}
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." || part == ".." || part == ".git" {
			return "", false
		}
	}
	return rel, true
}

// ReadFile reads one file of a plan, from its folder when it has one and from git when not.
func ReadFile(ctx context.Context, g Git, env Env, p *Plan, rel string) (string, error) {
	clean, ok := CleanRel(rel)
	if !ok {
		return "", fmt.Errorf("%q isn't a file of the plan", rel)
	}
	if p.Worktree != "" {
		// The file opened is one found by walking the plan's folder, never a path built from rel, so a
		// name that isn't in the plan (or a symlink that points out of it) can't be opened.
		for _, f := range planFiles(p.Worktree) {
			if f != clean {
				continue
			}
			b, err := os.ReadFile(filepath.Join(p.Worktree, filepath.FromSlash(f)))
			if err != nil {
				break
			}
			if len(b) > 256<<10 {
				b = b[:256<<10]
			}
			return string(b), nil
		}
		return "", fmt.Errorf("%s isn't in the plan", clean)
	}
	return g.Show(ctx, env.PlansRepo, p.rev, clean)
}

// Files lists the files of a plan (at most 500), from its folder or from git, without the .git folder.
func Files(ctx context.Context, g Git, env Env, p *Plan) []string {
	var files []string
	if p.Worktree == "" {
		files, _ = g.Files(ctx, env.PlansRepo, p.rev)
	} else {
		files = planFiles(p.Worktree)
	}
	slices.Sort(files)
	if len(files) > maxListed {
		files = files[:maxListed]
	}
	if files == nil {
		files = []string{}
	}
	return files
}

// planFiles lists the regular files under a plan's folder, as paths with forward slashes. The .git entry
// (in a worktree a file that points at the repository, not a folder) is left out, and so is any symlink.
func planFiles(root string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.Name() == ".git" {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type().IsRegular() {
			if rel, err := filepath.Rel(root, path); err == nil {
				files = append(files, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	return files
}
