package feature

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/review"
	"github.com/shadovxw/devdeck/internal/workspace"
)

const headSHA = "0123456789abcdef0123456789abcdef01234567"

func writeReview(t *testing.T, dir, pr, tool, commit, status, summary string) {
	t.Helper()
	res := review.Result{Tool: tool, PR: pr, Repo: "demo-api", Branch: "b", Base: "acme", Commit: commit, Ran: time.Date(2026, 11, 4, 9, 0, 0, 0, time.UTC), Status: review.Status(status), Summary: summary}
	if _, err := review.WriteResult(dir, res, tool); err != nil {
		t.Fatal(err)
	}
}

func TestDetailReadsTheSavedReviews(t *testing.T) {
	dir := t.TempDir()
	writeReview(t, dir, "a2", "tests", headSHA, "pass", "2 packages passed")
	writeReview(t, dir, "a2", "lint", "ffffffffffffffffffffffffffffffffffffffff", "fail", "1 problem, the first at x.go:1")
	writeReview(t, dir, "a1", "trivy", "aaaa", "pass", "No problems found")
	writeReview(t, dir, "zz", "tests", headSHA, "pass", "a PR the feature doesn't have")
	if err := os.WriteFile(filepath.Join(dir, "reviews", "a2-semgrep.md"), []byte("not a result\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	g := &fakeGit{set: gitx.BranchSet{Local: map[string]bool{"acme": true, "acme-a2-x": true}, Remote: map[string]bool{}}}
	s := &Service{Git: g, GH: &fakeGH{}, Locate: func(string) (string, bool) { return "x", true }}
	p := &Plan{Workspace: "demo", Name: "demo", Branch: "plan/demo", Worktree: dir, File: demoPlan(t), Issues: []workspace.Issue{}}
	d := s.Detail(context.Background(), demoEnv(), p, false)
	prs := byID(d.PRs)

	if r := prs["a2"].Reviews["tests"]; r.Status != "pass" || r.Summary != "2 packages passed" || r.Stale || r.File != "reviews/a2-tests.md" || r.Commit != headSHA {
		t.Errorf("a2 tests = %+v: its commit is the branch's head, so it is current", r)
	}
	if r := prs["a2"].Reviews["lint"]; r.Status != "fail" || !r.Stale {
		t.Errorf("a2 lint = %+v: it ran on an older commit, so it is stale", r)
	}
	if _, ok := prs["a2"].Reviews["semgrep"]; ok {
		t.Errorf("a file with no front matter is not a result")
	}
	if r := prs["a1"].Reviews["trivy"]; r.Status != "pass" || r.Stale {
		t.Errorf("a1 has no branch here, so nothing can be stale: %+v", r)
	}
	if len(prs["a3"].Reviews) != 0 {
		t.Errorf("a3 has no results: %+v", prs["a3"].Reviews)
	}
	if prs["a2"].Local == nil || prs["a2"].Local.Head != headSHA {
		t.Errorf("a2's branch head = %+v", prs["a2"].Local)
	}
	if len(d.Tools) != len(review.Tools) || !d.Tools[0].Usable {
		t.Errorf("tools = %+v", d.Tools)
	}
}

func TestToolInfosSayWhatIsInstalled(t *testing.T) {
	infos := ToolInfos(func(p string) (string, bool) { return "x", p == "go" })
	byTool := map[string]ToolInfo{}
	for _, i := range infos {
		byTool[i.ID] = i
	}
	tests := byTool["tests"]
	if !tests.Usable || len(tests.Programs) != 2 || !tests.Programs[0].Found || tests.Programs[0].Hint != "" || tests.Programs[1].Found || tests.Programs[1].Hint == "" {
		t.Errorf("tests = %+v: go is found, npm is missing with a hint", tests)
	}
	if byTool["semgrep"].Usable || byTool["semgrep"].Programs[0].Hint == "" {
		t.Errorf("semgrep = %+v", byTool["semgrep"])
	}
	if got := ToolInfos(nil); len(got) != len(review.Tools) {
		t.Errorf("with no locator the real one is used: %d tools", len(got))
	}
}

func TestReviewableAreThePRsWithABranchThatAreNotDone(t *testing.T) {
	branch := &Local{Exists: true}
	prs := []PR{
		{ID: "a1", State: StateMerged, Local: branch},
		{ID: "a2", State: StateChanges, Local: branch},
		{ID: "a3", State: StatePlanned},
		{ID: "a4", State: StateCoding, Local: branch},
		{ID: "a5", State: StateClosed, Local: branch},
		{ID: "a6", State: StateCoding, Local: &Local{Exists: false}},
	}
	var got []string
	for _, p := range Reviewable(prs) {
		got = append(got, p.ID)
	}
	if len(got) != 2 || got[0] != "a2" || got[1] != "a4" {
		t.Errorf("Reviewable = %v", got)
	}
}
