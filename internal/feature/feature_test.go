package feature

import (
	"context"
	"errors"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

const demoFeature = `version: 1
feature: acme
title: Demo
budget: { lines: 100 }
repos: [demo-api, demo-worker]
prs:
  - { id: a1, repo: demo-api, slug: x, title: First, steps: [ { title: s1, layer: config, status: done, commit: "1111111" } ] }
  - { id: a2, repo: demo-api, slug: x, title: Second, pr: 214, steps: [ { title: s2, layer: [handler, config], status: done }, { title: s3, layer: handler, status: done } ] }
  - { id: a3, repo: demo-api, slug: x, title: Third, steps: [ { title: s4, layer: handler, status: done }, { title: Wire the thing, layer: wiring, status: doing }, { title: s6, status: todo } ] }
  - { id: a4, repo: demo-api, slug: x, title: Fourth, steps: [ { title: s7, layer: handler } ] }
  - { id: w1, repo: demo-worker, slug: x, title: Worker one, after: [a3], steps: [ { title: s8, layer: db } ] }
  - { id: w2, repo: demo-worker, slug: x, title: Worker two, base: dev-x, steps: [ { title: s9, layer: db } ] }
`

func demoPlan(t *testing.T) *workspace.FeatureFile {
	t.Helper()
	f, issues := workspace.LoadFeature("feature.yaml", []byte(demoFeature), nil)
	if f == nil {
		t.Fatalf("the demo feature must load: %+v", issues)
	}
	return f
}

func byID(prs []PR) map[string]*PR {
	m := map[string]*PR{}
	for i := range prs {
		m[prs[i].ID] = &prs[i]
	}
	return m
}

func TestDerive(t *testing.T) {
	prs := byID(Derive(demoPlan(t)))
	if p := prs["a1"]; p.Branch != "acme-a1-x" || p.Base != "acme" || p.Below != "" || p.StepsDone != 1 {
		t.Errorf("a1 = %+v (first PR targets the feature branch)", p)
	}
	if p := prs["a3"]; p.Base != "acme-a2-x" || p.Below != "a2" || p.StepsDone != 1 {
		t.Errorf("a3 = %+v (targets the PR below in its repo)", p)
	}
	if p := prs["w1"]; p.Base != "acme" || p.Below != "" {
		t.Errorf("w1 = %+v (a stack is per repo, so the worker's first PR targets the feature branch)", p)
	}
	if p := prs["w2"]; p.Base != "dev-x" || p.Below != "w1" {
		t.Errorf("w2 = %+v (base: overrides the derived base)", p)
	}
	if got := prs["a2"].Layers; !slices.Equal(got, []string{"handler", "config"}) {
		t.Errorf("layers = %v, want the union in the order they first appear", got)
	}
	if got := prs["a4"].Layers; len(got) != 1 || got[0] != "handler" {
		t.Errorf("a4 layers = %v", got)
	}
}

func TestStates(t *testing.T) {
	local := &Local{Exists: true}
	gh := func(state, decision string, draft bool) *gitx.PullRequest {
		return &gitx.PullRequest{State: state, Decision: decision, Draft: draft}
	}
	for name, tc := range map[string]struct {
		pr   PR
		want string
	}{
		"nothing yet":          {PR{}, StatePlanned},
		"a branch only":        {PR{Local: local}, StateCoding},
		"merged":               {PR{GitHub: gh("merged", "approved", false), Local: local}, StateMerged},
		"closed":               {PR{GitHub: gh("closed", "", false)}, StateClosed},
		"changes requested":    {PR{GitHub: gh("open", "changes_requested", false)}, StateChanges},
		"changes beat draft":   {PR{GitHub: gh("open", "changes_requested", true)}, StateChanges},
		"draft":                {PR{GitHub: gh("open", "", true)}, StateDraft},
		"draft beats approved": {PR{GitHub: gh("open", "approved", true)}, StateDraft},
		"approved":             {PR{GitHub: gh("open", "approved", false)}, StateApproved},
		"open, no decision":    {PR{GitHub: gh("open", "review_required", false)}, StateReview},
		"open, no review set":  {PR{GitHub: gh("open", "", false)}, StateReview},
		"a pr and no branch":   {PR{GitHub: gh("open", "", false)}, StateReview},
	} {
		pr := tc.pr
		prs := []PR{pr}
		SetStates(prs)
		if prs[0].State != tc.want {
			t.Errorf("%s: state = %q, want %q", name, prs[0].State, tc.want)
		}
	}
}

func TestWaitingAndNext(t *testing.T) {
	prs := Derive(demoPlan(t))
	set := byID(prs)
	set["a1"].GitHub = &gitx.PullRequest{State: "merged"}
	set["a2"].GitHub = &gitx.PullRequest{State: "open", Decision: "approved"}
	set["a3"].Local = &Local{Exists: true}
	SetStates(prs)

	want := map[string]string{"a1": StateMerged, "a2": StateApproved, "a3": StateCoding, "a4": StatePlanned, "w1": StateWaiting, "w2": StatePlanned}
	for id, st := range want {
		if set[id].State != st {
			t.Errorf("%s = %q, want %q", id, set[id].State, st)
		}
	}
	if n := set["a2"].Next; n == nil || n.Who != "you" || n.Text != "Approved. Merge it on GitHub" {
		t.Errorf("a2 next = %+v (its PR below is merged)", n)
	}
	if n := set["a3"].Next; n == nil || n.Who != "claude" || n.Text != "Claude is on step 2: Wire the thing" {
		t.Errorf("a3 next = %+v (the first step that isn't done)", n)
	}
	if set["a4"].Next != nil || set["w1"].Next != nil {
		t.Errorf("planned and waiting PRs have nothing next")
	}

	// approved but the PR below isn't merged yet
	set["a1"].GitHub = &gitx.PullRequest{State: "open"}
	SetStates(prs)
	if n := set["a2"].Next; n == nil || n.Text != "Approved. Merge a1 first" {
		t.Errorf("a2 next = %+v", n)
	}
}

func TestNextUpOrderAndPick(t *testing.T) {
	prs := Derive(demoPlan(t))
	set := byID(prs)
	set["a1"].GitHub = &gitx.PullRequest{State: "open", Decision: "review_required"}
	set["a2"].GitHub = &gitx.PullRequest{State: "open", Decision: "approved"}
	set["a3"].GitHub = &gitx.PullRequest{State: "open", Decision: "changes_requested"}
	set["a4"].Local = &Local{Exists: true}
	SetStates(prs)

	var ids []string
	for _, n := range NextUp(prs) {
		ids = append(ids, n.PR)
	}
	if !slices.Equal(ids, []string{"a3", "a2", "a4", "a1"}) {
		t.Errorf("next up = %v, want changes requested, approved, coding, in review", ids)
	}
	if got := Pick(prs); got != "w1" {
		// w1 is waiting for a3, which isn't merged, so it isn't offered; w2's PR below (w1) hasn't started.
		if got != "" {
			t.Errorf("pick = %q, want nothing: w1 is waiting and w2 sits above it", got)
		}
	}

	set["a3"].GitHub = &gitx.PullRequest{State: "merged"}
	SetStates(prs)
	if got := Pick(prs); got != "w1" {
		t.Errorf("pick = %q, want w1 now that a3 is merged", got)
	}
}

// fakeGit answers from tables.
type fakeGit struct {
	mu      sync.Mutex
	set     gitx.BranchSet
	stats   map[string]gitx.DiffStat
	asked   []string
	failAll bool
}

func (f *fakeGit) Branches(context.Context, string) (gitx.BranchSet, error) {
	if f.failAll {
		return gitx.BranchSet{}, errors.New("git couldn't list the branches")
	}
	return f.set, nil
}
func (f *fakeGit) Worktrees(context.Context, string) ([]gitx.Worktree, error) { return nil, nil }
func (f *fakeGit) DiffStat(_ context.Context, _ string, base, branch string) (gitx.DiffStat, error) {
	key := base + "..." + branch
	f.mu.Lock()
	f.asked = append(f.asked, key)
	f.mu.Unlock()
	if st, ok := f.stats[key]; ok {
		return st, nil
	}
	return gitx.DiffStat{}, errors.New("no such diff")
}
func (f *fakeGit) Commits(_ context.Context, _ string, base, branch string, _ int) ([]gitx.Commit, error) {
	return []gitx.Commit{{Hash: "abc1234", Subject: "step"}}, nil
}
func (f *fakeGit) Files(context.Context, string, string) ([]string, error) { return nil, nil }
func (f *fakeGit) Show(context.Context, string, string, string) (string, error) {
	return "", errors.New("no")
}

type fakeGH struct {
	mu    sync.Mutex
	pulls map[string][]gitx.PullRequest
	err   error
	calls []string
}

func (f *fakeGH) PullRequests(_ context.Context, user, repo string) ([]gitx.PullRequest, error) {
	f.mu.Lock()
	f.calls = append(f.calls, user+"|"+repo)
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	return f.pulls[repo], nil
}

func demoEnv() Env {
	return Env{Workspace: "demo", Root: "C:/code", Repos: []workspace.Repo{
		{ID: "demo-api", Path: "api", Remote: "github.com/acme/demo-api"},
		{ID: "demo-worker", Path: "worker", Remote: "github.com/acme/demo-worker"},
	}}
}

func TestDetailReadsGitAndGitHub(t *testing.T) {
	f := demoPlan(t)
	g := &fakeGit{
		set: gitx.BranchSet{
			Local:  map[string]bool{"acme": true, "acme-a2-x": true, "acme-a3-x": true},
			Remote: map[string]bool{"acme-a2-x": true},
		},
		stats: map[string]gitx.DiffStat{
			"acme...acme-a2-x":      {Files: 6, Added: 300, Deleted: 20},
			"acme-a2-x...acme-a3-x": {Files: 2, Added: 40, Deleted: 5},
		},
	}
	gh := &fakeGH{pulls: map[string][]gitx.PullRequest{"acme/demo-api": {
		{Number: 212, Head: "acme-a1-x", Base: "acme", State: "merged", Additions: 356, Deletions: 4, ChangedFiles: 5},
		{Number: 214, Head: "acme-a2-x", Base: "acme", State: "open", Decision: "changes_requested", URL: "https://github.com/acme/demo-api/pull/214"},
		{Number: 150, Head: "acme-a2-x", Base: "acme", State: "closed", UpdatedAt: "2026-10-01T00:00:00Z"},
	}}}
	s := &Service{Git: g, GH: gh, Account: func(gitx.Remote) string { return "alpha" }}
	p := &Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", File: f, Issues: []workspace.Issue{}}
	d := s.Detail(context.Background(), demoEnv(), p, false)

	prs := byID(d.PRs)
	if prs["a1"].State != StateMerged || prs["a1"].GitHub.Number != 212 || prs["a1"].Local != nil {
		t.Errorf("a1 = %+v (merged, branch already deleted)", prs["a1"])
	}
	a2 := prs["a2"]
	if a2.State != StateChanges || a2.GitHub.Number != 214 || a2.Base != "acme" {
		t.Errorf("a2 = state %q, github %+v, base %q: the open pull request wins over the closed one, and its base moved to the feature branch because a1 merged", a2.State, a2.GitHub, a2.Base)
	}
	if a2.Size == nil || a2.Size.Added != 300 || len(a2.Local.Commits) != 1 || !a2.Local.Pushed {
		t.Errorf("a2 size/local = %+v / %+v", a2.Size, a2.Local)
	}
	if !slices.Equal(a2.Over, []string{"lines"}) {
		t.Errorf("a2 over = %v (320 lines against a budget of 100; 6 files is within 10)", a2.Over)
	}
	if a3 := prs["a3"]; a3.State != StateCoding || a3.Size == nil || a3.Size.Added != 40 || a3.Local.Pushed {
		t.Errorf("a3 = %+v, size %+v", a3, a3.Size)
	}
	if prs["a1"].Size == nil || prs["a1"].Size.Added != 356 {
		t.Errorf("a1's size comes from GitHub when git has no branch: %+v", prs["a1"].Size)
	}
	if prs["w1"].State != StateWaiting {
		t.Errorf("w1 = %q", prs["w1"].State)
	}
	if d.Counts[StateMerged] != 1 || d.Counts[StatePlanned] != 2 || d.Pick != "a4" {
		t.Errorf("counts = %v, pick = %q", d.Counts, d.Pick)
	}
	if d.Budget.Lines != 100 || d.Budget.Files != workspace.DefaultBudgetFiles {
		t.Errorf("budget = %+v (the file's lines, the default files)", d.Budget)
	}
	slices.Sort(gh.calls)
	if !slices.Equal(gh.calls, []string{"alpha|acme/demo-api", "alpha|acme/demo-worker"}) {
		t.Errorf("one call per repository, as the account the rule picks: %v", gh.calls)
	}
	// a3 is compared with a2's branch, not with the feature branch
	if !slices.Contains(g.asked, "acme-a2-x...acme-a3-x") {
		t.Errorf("a3 must be compared with the PR below: %v", g.asked)
	}
}

func TestDetailKeepsGoingWhenOneThingFails(t *testing.T) {
	g := &fakeGit{failAll: true}
	gh := &fakeGH{err: gitx.ErrNoGH}
	s := &Service{Git: g, GH: gh}
	p := &Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", File: demoPlan(t), Issues: []workspace.Issue{}}
	d := s.Detail(context.Background(), demoEnv(), p, false)
	if len(d.PRs) != 6 || d.PRs[0].State != StatePlanned {
		t.Fatalf("every PR is still listed: %+v", d.PRs)
	}
	joined := strings.Join(d.Problems, "\n")
	if !strings.Contains(joined, "GitHub CLI") || !strings.Contains(joined, "demo-api: git couldn't") {
		t.Errorf("problems = %v", d.Problems)
	}
}

func TestPullRequestListsAreCached(t *testing.T) {
	now := time.Date(2026, 11, 3, 12, 0, 0, 0, time.UTC)
	gh := &fakeGH{pulls: map[string][]gitx.PullRequest{}}
	s := &Service{Git: &fakeGit{set: gitx.BranchSet{Local: map[string]bool{}, Remote: map[string]bool{}}}, GH: gh, Now: func() time.Time { return now }}
	p := &Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", File: demoPlan(t), Issues: []workspace.Issue{}}
	read := func(refresh bool) { s.Detail(context.Background(), demoEnv(), p, refresh) }

	read(false)
	if len(gh.calls) != 2 {
		t.Fatalf("one call per repository: %v", gh.calls)
	}
	now = now.Add(30 * time.Second)
	read(false)
	if len(gh.calls) != 2 {
		t.Errorf("a recent answer is reused: %v", gh.calls)
	}
	read(true)
	if len(gh.calls) != 4 {
		t.Errorf("refresh asks again: %v", gh.calls)
	}
	now = now.Add(2 * time.Minute)
	read(false)
	if len(gh.calls) != 6 {
		t.Errorf("an old answer is asked for again: %v", gh.calls)
	}
}

func TestRemoteOf(t *testing.T) {
	for raw, want := range map[string]string{
		"github.com/acme/demo-api":             "github.com/acme/demo-api",
		"https://github.com/acme/demo-api.git": "github.com/acme/demo-api",
		"git@github.com:acme/demo-api.git":     "github.com/acme/demo-api",
		"gitlab.com/acme/demo-api":             "",
		"acme/demo-api":                        "",
		"":                                     "",
	} {
		rm, ok := remoteOf(raw)
		if want == "" && ok || want != "" && (!ok || rm.String() != want) {
			t.Errorf("remoteOf(%q) = %v, %v, want %q", raw, rm, ok, want)
		}
	}
}

func TestSummaryOf(t *testing.T) {
	s := SummaryOf(&Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", File: demoPlan(t), Issues: []workspace.Issue{}})
	if s.PRs != 6 || s.Steps != 9 || s.StepsDone != 4 || s.Kind != "feature" || s.Base != "dev" || s.Feature != "acme" || len(s.Repos) != 2 {
		t.Errorf("summary = %+v", s)
	}
	broken := SummaryOf(&Plan{Name: "bad", Branch: "plan/bad", Issues: []workspace.Issue{{Severity: workspace.SeverityError}, {Severity: workspace.SeverityWarning}}})
	if broken.Errors != 1 || broken.Warnings != 1 || broken.PRs != 0 || broken.Repos == nil {
		t.Errorf("a plan with a broken file still has a summary: %+v", broken)
	}
}

func TestRender(t *testing.T) {
	f := demoPlan(t)
	g := &fakeGit{
		set:   gitx.BranchSet{Local: map[string]bool{"acme": true, "acme-a2-x": true, "acme-a3-x": true}, Remote: map[string]bool{}},
		stats: map[string]gitx.DiffStat{"acme...acme-a2-x": {Files: 6, Added: 300, Deleted: 20}},
	}
	gh := &fakeGH{pulls: map[string][]gitx.PullRequest{"acme/demo-api": {
		{Number: 212, Head: "acme-a1-x", State: "merged"},
		{Number: 214, Head: "acme-a2-x", State: "open", Decision: "changes_requested"},
	}}}
	s := &Service{Git: g, GH: gh}
	p := &Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", ReadOnly: true, File: f, Issues: []workspace.Issue{}}
	d := s.Detail(context.Background(), demoEnv(), p, false)
	d.Problems = append(d.Problems, "demo-worker: the folder isn't on this machine")
	out := Render(d)

	// The table is aligned with spaces, so the text is compared with runs of spaces squeezed to one.
	squeezed := strings.Join(strings.Fields(out), " ")
	for _, want := range []string{
		"Demo acme -> dev",
		"plan/demo (read-only: no worktree)",
		"6 PRs: 1 merged, 1 changes requested, 1 coding, 1 waiting, 2 planned",
		"demo-api a2 handler,config changes requested #214 +300 -20 2/2 lines",
		"demo-api a1 config merged #212",
		"demo-worker w1 db waiting - - 0/1",
		"next a2 Fix the requested changes, then ask for review again (claude) a3 Claude is on step 2: Wire the thing (claude)",
		"hand to Claude next: a4",
		"problems demo-worker: the folder isn't on this machine",
	} {
		if !strings.Contains(squeezed, want) {
			t.Errorf("the text has no %q:\n%s", want, out)
		}
	}
	if StateWord("unknown") != "unknown" || StateWord(StateChanges) != "changes requested" {
		t.Errorf("StateWord")
	}
}
