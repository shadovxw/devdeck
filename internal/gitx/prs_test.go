package gitx

import (
	"context"
	"strings"
	"testing"
)

const prListAnswer = `[
 {"number":212,"title":"Transfer bucket","headRefName":"acme-a1-blob-put","baseRefName":"acme","state":"MERGED","isDraft":false,"reviewDecision":"APPROVED",
  "url":"https://github.com/acme/demo-api/pull/212","additions":356,"deletions":4,"changedFiles":5,"mergedAt":"2026-11-01T10:00:00Z","updatedAt":"2026-11-01T10:00:00Z",
  "statusCheckRollup":[
   {"__typename":"CheckRun","name":"CI passed","status":"COMPLETED","conclusion":"SUCCESS"},
   {"__typename":"CheckRun","name":"CodeQL passed","status":"IN_PROGRESS","conclusion":""},
   {"__typename":"CheckRun","name":"Security passed","status":"COMPLETED","conclusion":"FAILURE"},
   {"__typename":"StatusContext","context":"ci/legacy","state":"PENDING"},
   {"__typename":"StatusContext","context":"ci/ok","state":"SUCCESS"}]},
 {"number":214,"title":"blob.get","headRefName":"acme-a2-blob-get","baseRefName":"acme-a1-blob-put","state":"OPEN","isDraft":true,"reviewDecision":"","url":"u","additions":1,"deletions":2,"changedFiles":1,"statusCheckRollup":[]}
]`

func TestParsePullRequests(t *testing.T) {
	got, err := ParsePullRequests(prListAnswer)
	if err != nil || len(got) != 2 {
		t.Fatalf("got %+v, %v", got, err)
	}
	a := got[0]
	if a.Number != 212 || a.State != "merged" || a.Decision != "approved" || a.Head != "acme-a1-blob-put" || a.Base != "acme" || a.Additions != 356 || a.ChangedFiles != 5 {
		t.Errorf("first = %+v", a)
	}
	states := map[string]string{}
	for _, c := range a.Checks {
		states[c.Name] = c.State
	}
	want := map[string]string{"CI passed": "pass", "CodeQL passed": "pending", "Security passed": "fail", "ci/legacy": "pending", "ci/ok": "pass"}
	for name, st := range want {
		if states[name] != st {
			t.Errorf("check %q = %q, want %q", name, states[name], st)
		}
	}
	if b := got[1]; !b.Draft || b.State != "open" || b.Decision != "" {
		t.Errorf("second = %+v", b)
	}
	if _, err := ParsePullRequests("not json"); err == nil {
		t.Errorf("unreadable answer must fail")
	}
}

func TestPullRequestsAsOneAccount(t *testing.T) {
	list := "pr list --repo acme/demo-api --state all --limit 200 --json number,title,headRefName,baseRefName,state,isDraft,reviewDecision,url,additions,deletions,changedFiles,mergedAt,updatedAt,statusCheckRollup"
	c := &canned{answers: map[string]string{"auth token --hostname github.com --user alpha": "tok-1\n", list: prListAnswer}}
	got, err := NewGHWith("gh", c.run).PullRequests(context.Background(), "alpha", "acme/demo-api")
	if err != nil || len(got) != 2 {
		t.Fatalf("got %+v, %v", got, err)
	}
	last := len(c.envs) - 1
	if c.calls[last] != list || len(c.envs[last]) != 1 || c.envs[last][0] != "GH_TOKEN=tok-1" {
		t.Errorf("the list must run as that account: calls = %v, env = %v", c.calls, c.envs[last])
	}

	// no account named: gh's own active one, so no token is fetched
	c2 := &canned{answers: map[string]string{list: "[]"}}
	if got, err := NewGHWith("gh", c2.run).PullRequests(context.Background(), "", "acme/demo-api"); err != nil || len(got) != 0 || len(c2.calls) != 1 {
		t.Errorf("active account: %+v, %v, calls %v", got, err, c2.calls)
	}
}

func TestPullRequestsRefuseBadRepoNames(t *testing.T) {
	g := NewGHWith("gh", (&canned{}).run)
	for _, repo := range []string{"", "acme", "acme/demo/api", "-x/y", "a b/c", "acme/demo;rm"} {
		if _, err := g.PullRequests(context.Background(), "", repo); err == nil || !strings.Contains(err.Error(), "owner/name") {
			t.Errorf("repo %q: err = %v, want a refusal", repo, err)
		}
	}
}
