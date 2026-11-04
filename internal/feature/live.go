package feature

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// GitHub is what this package needs from GitHub. *gitx.GH is one.
type GitHub interface {
	PullRequests(ctx context.Context, user, repo string) ([]gitx.PullRequest, error)
}

// Service reads plans and adds the live state. It changes nothing.
type Service struct {
	Git Git
	GH  GitHub
	// Account says which gh account a repository uses, given its remote. "" means gh's active account.
	Account func(rm gitx.Remote) string
	// TTL is how long a repository's pull request list is reused (a minute when zero).
	TTL time.Duration
	// Now is the clock, for tests.
	Now func() time.Time

	mu    sync.Mutex
	cache map[string]cachedPRs
}

type cachedPRs struct {
	at  time.Time
	prs []gitx.PullRequest
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Summary is one feature in the list: cheap to make, with no call to GitHub.
type Summary struct {
	Workspace string   `json:"workspace"`
	Name      string   `json:"name"`
	Branch    string   `json:"branch"`
	Title     string   `json:"title,omitempty"`
	Kind      string   `json:"kind"`
	Feature   string   `json:"feature,omitempty"`
	Base      string   `json:"base,omitempty"`
	Repos     []string `json:"repos"`
	PRs       int      `json:"prs"`
	Steps     int      `json:"steps"`
	StepsDone int      `json:"steps_done"`
	Worktree  string   `json:"worktree,omitempty"`
	ReadOnly  bool     `json:"read_only"`
	Errors    int      `json:"errors"`
	Warnings  int      `json:"warnings"`
}

// SummaryOf describes a plan from its feature.yaml alone. A plan whose file has errors still shows, with its errors counted.
func SummaryOf(p *Plan) Summary {
	s := Summary{Workspace: p.Workspace, Name: p.Name, Branch: p.Branch, Worktree: p.Worktree, ReadOnly: p.ReadOnly, Kind: workspace.DefaultFeatureKind, Repos: []string{},
		Errors: workspace.Count(p.Issues, workspace.SeverityError), Warnings: workspace.Count(p.Issues, workspace.SeverityWarning)}
	if f := p.File; f != nil {
		s.Title, s.Kind, s.Feature, s.Base, s.Repos, s.PRs = f.Title, f.KindOrDefault(), f.Feature, f.BaseOrDefault(), f.Repos, len(f.PRs)
		for _, pr := range f.PRs {
			for _, st := range pr.Steps {
				s.Steps++
				if st.StatusOrTodo() == workspace.StepDone {
					s.StepsDone++
				}
			}
		}
	}
	return s
}

// Detail is a whole feature with its live state.
type Detail struct {
	Summary
	Budget workspace.FeatureBudget `json:"budget"`
	PRs    []PR                    `json:"pr_list"`
	NextUp []NextItem              `json:"next_up"`
	// Pick is the PR to hand Claude next ("" when none).
	Pick string `json:"pick,omitempty"`
	// Counts is how many PRs are in each state.
	Counts map[string]int `json:"counts"`
	// RepoLayers are the feature's repos with their layers: the columns of the layer grid.
	RepoLayers []RepoLayers `json:"repo_layers"`
	// Problems are things that kept some of the live state from being read (a repo missing on this
	// machine, gh not installed). What could be read is still shown.
	Problems []string          `json:"problems"`
	Files    []string          `json:"files"`
	Issues   []workspace.Issue `json:"issues"`
}

// RepoLayers is one repo of a feature with the layers the workspace defines for it.
type RepoLayers struct {
	ID     string            `json:"id"`
	Layers []workspace.Layer `json:"layers"`
}

// Detail reads a plan's PRs from git and GitHub. A problem with one repository is reported in
// Problems and doesn't stop the rest. refresh skips the cached pull request lists.
func (s *Service) Detail(ctx context.Context, env Env, p *Plan, refresh bool) Detail {
	d := Detail{Summary: SummaryOf(p), PRs: []PR{}, NextUp: []NextItem{}, Counts: map[string]int{}, Problems: []string{}, RepoLayers: []RepoLayers{}, Issues: p.Issues}
	d.Files = Files(ctx, s.Git, env, p)
	f := p.File
	if f == nil {
		return d
	}
	d.Budget = workspace.FeatureBudget{Files: workspace.DefaultBudgetFiles, Lines: workspace.DefaultBudgetLines}
	if f.Budget != nil {
		d.Budget.Files, d.Budget.Lines = cmp.Or(f.Budget.Files, d.Budget.Files), cmp.Or(f.Budget.Lines, d.Budget.Lines)
	}

	for _, id := range f.Repos {
		rl := RepoLayers{ID: id, Layers: []workspace.Layer{}}
		for _, r := range env.Repos {
			if r.ID == id && r.Layers != nil {
				rl.Layers = r.Layers
			}
		}
		d.RepoLayers = append(d.RepoLayers, rl)
	}

	prs := Derive(f)
	byRepo := map[string][]int{}
	for i, pr := range prs {
		byRepo[pr.Repo] = append(byRepo[pr.Repo], i)
	}
	baseSet := map[string]bool{}
	for _, in := range f.PRs {
		baseSet[in.ID] = in.Base != ""
	}

	var mu sync.Mutex
	problem := func(format string, a ...any) {
		mu.Lock()
		d.Problems = append(d.Problems, fmt.Sprintf(format, a...))
		mu.Unlock()
	}
	var wg sync.WaitGroup
	for repoID, idx := range byRepo {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.readRepo(ctx, env, repoID, f.Feature, prs, idx, baseSet, d.Budget, refresh, problem)
		}()
	}
	wg.Wait()

	SetStates(prs)
	d.PRs = prs
	d.NextUp = NextUp(prs)
	d.Pick = Pick(prs)
	for _, pr := range prs {
		d.Counts[pr.State]++
	}
	return d
}

// readRepo fills the live facts of the PRs that are in one repository: idx are their places in prs, in order.
func (s *Service) readRepo(ctx context.Context, env Env, repoID, featureBranch string, prs []PR, idx []int, baseSet map[string]bool, budget workspace.FeatureBudget, refresh bool, problem func(string, ...any)) {
	dir, repo, ok := env.RepoDir(repoID)
	if !ok {
		problem("%s: the folder isn't on this machine, so only the GitHub state is shown", repoID)
	}
	var set gitx.BranchSet
	haveGit := false
	if ok {
		var err error
		if set, err = s.Git.Branches(ctx, dir); err != nil {
			problem("%s: %v", repoID, err)
		} else {
			haveGit = true
		}
	}

	var pulls []gitx.PullRequest
	if rm, ok := remoteOf(repo.Remote); ok {
		var err error
		if pulls, err = s.pulls(ctx, rm, refresh); err != nil {
			problem("%s: GitHub: %v", repoID, err)
		}
	} else {
		problem("%s: the workspace gives it no github.com remote, so its pull requests can't be read", repoID)
	}

	byID := map[string]*PR{}
	for _, i := range idx {
		pr := &prs[i]
		byID[pr.ID] = pr
		pr.GitHub = matchPR(pulls, pr)
		// Once the PR below is merged GitHub points this one at the feature branch.
		if below := byID[pr.Below]; below != nil && !baseSet[pr.ID] && below.GitHub != nil && below.GitHub.State == "merged" {
			pr.Base = featureBranch
		}
		if haveGit {
			s.readBranch(ctx, dir, set, pr)
		}
		pr.Size = sizeOf(pr)
		if pr.Size != nil {
			if pr.Size.Files > budget.Files {
				pr.Over = append(pr.Over, "files")
			}
			if pr.Size.Size() > budget.Lines {
				pr.Over = append(pr.Over, "lines")
			}
		}
	}
}

// readBranch asks git about one PR's branch: whether it exists, its commits and its size.
func (s *Service) readBranch(ctx context.Context, dir string, set gitx.BranchSet, pr *PR) {
	if !set.Has(pr.Branch) {
		return
	}
	l := &Local{Exists: true, Pushed: set.Remote[pr.Branch]}
	pr.Local = l
	ref, baseRef := set.Ref(pr.Branch), set.Ref(pr.Base)
	if baseRef == "" {
		l.BaseMissing = true
		return
	}
	if st, err := s.Git.DiffStat(ctx, dir, baseRef, ref); err == nil {
		pr.Size = &st
	}
	if cs, err := s.Git.Commits(ctx, dir, baseRef, ref, 100); err == nil {
		l.Commits = cs
	}
}

// sizeOf is the size git worked out, or the one GitHub reports when git couldn't.
func sizeOf(pr *PR) *gitx.DiffStat {
	if pr.Size != nil {
		return pr.Size
	}
	if g := pr.GitHub; g != nil {
		return &gitx.DiffStat{Files: g.ChangedFiles, Added: g.Additions, Deleted: g.Deletions}
	}
	return nil
}

// matchPR finds a PR's pull request: the one from its branch, or the one feature.yaml names. When a
// branch has had several (one closed, a new one open) the open one wins, then a merged one, then the
// latest.
func matchPR(pulls []gitx.PullRequest, pr *PR) *gitx.PullRequest {
	rank := func(p gitx.PullRequest) int {
		switch p.State {
		case "open":
			return 0
		case "merged":
			return 1
		}
		return 2
	}
	var best *gitx.PullRequest
	for i := range pulls {
		p := &pulls[i]
		if p.Head != pr.Branch && (pr.number <= 0 || p.Number != pr.number) {
			continue
		}
		if best == nil || rank(*p) < rank(*best) || (rank(*p) == rank(*best) && p.UpdatedAt > best.UpdatedAt) {
			best = p
		}
	}
	if best == nil {
		return nil
	}
	c := *best
	return &c
}

// pulls lists a repository's pull requests, reusing a recent answer unless refresh is set.
func (s *Service) pulls(ctx context.Context, rm gitx.Remote, refresh bool) ([]gitx.PullRequest, error) {
	user := ""
	if s.Account != nil {
		user = s.Account(rm)
	}
	key := user + "|" + rm.Owner + "/" + rm.Repo
	ttl := cmp.Or(s.TTL, time.Minute)

	s.mu.Lock()
	c, hit := s.cache[key]
	s.mu.Unlock()
	if hit && !refresh && s.now().Sub(c.at) < ttl {
		return c.prs, nil
	}
	if s.GH == nil {
		return nil, errors.New("GitHub isn't available")
	}
	list, err := s.GH.PullRequests(ctx, user, rm.Owner+"/"+rm.Repo)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	if s.cache == nil {
		s.cache = map[string]cachedPRs{}
	}
	s.cache[key] = cachedPRs{at: s.now(), prs: list}
	s.mu.Unlock()
	return list, nil
}

// remoteOf reads a repo's remote as the workspace writes it (host/owner/repo) or as a git address. Only
// github.com has pull requests devdeck can read.
func remoteOf(raw string) (gitx.Remote, bool) {
	rm, ok := gitx.ParseRemote(raw)
	if !ok {
		if parts := strings.Split(strings.Trim(strings.TrimSpace(raw), "/"), "/"); len(parts) == 3 && strings.Contains(parts[0], ".") && parts[1] != "" && parts[2] != "" {
			rm, ok = gitx.Remote{Host: strings.ToLower(parts[0]), Owner: parts[1], Repo: strings.TrimSuffix(parts[2], ".git")}, true
		}
	}
	return rm, ok && rm.Host == gitx.Host
}
