package gitx

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
)

// canned answers gh by its arguments, and records which environment each call got.
type canned struct {
	answers map[string]string
	errs    map[string]error
	calls   []string
	envs    [][]string
}

func (c *canned) run(_ context.Context, env []string, args ...string) (string, error) {
	key := strings.Join(args, " ")
	c.calls = append(c.calls, key)
	c.envs = append(c.envs, env)
	if err, ok := c.errs[key]; ok {
		return "", err
	}
	return c.answers[key], nil
}

const statusAnswer = `{"hosts":{"github.com":[
 {"state":"success","active":true,"host":"github.com","login":"alpha","tokenSource":"keyring","scopes":"gist, read:org, repo, workflow"},
 {"state":"success","active":false,"host":"github.com","login":"beta","tokenSource":"keyring","scopes":"repo"},
 {"state":"error","active":false,"host":"github.com","login":"broken","tokenSource":"keyring","scopes":""}
],"example.org":[{"state":"success","active":true,"login":"elsewhere"}]}}`

func TestAccounts(t *testing.T) {
	c := &canned{answers: map[string]string{"auth status --json hosts": statusAnswer}}
	got, err := NewGHWith("gh", c.run).Accounts(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Login != "alpha" || !got[0].Active || got[1].Login != "beta" || got[1].Active {
		t.Fatalf("accounts = %+v (github.com only, signed in only)", got)
	}
	if !slices.Equal(got[0].Scopes, []string{"gist", "read:org", "repo", "workflow"}) || got[0].TokenSource != "keyring" {
		t.Errorf("alpha = %+v", got[0])
	}

	// not signed in anywhere is an empty list, not a failure
	none := &canned{errs: map[string]error{"auth status --json hosts": errors.New("gh auth: You are not logged into any GitHub hosts")}}
	if got, err := NewGHWith("gh", none.run).Accounts(context.Background()); err != nil || len(got) != 0 {
		t.Errorf("not signed in: %v %v", got, err)
	}
	// another failure is reported
	bad := &canned{errs: map[string]error{"auth status --json hosts": errors.New("gh auth: boom")}}
	if _, err := NewGHWith("gh", bad.run).Accounts(context.Background()); err == nil {
		t.Error("an unexplained failure must be reported")
	}
	junk := &canned{answers: map[string]string{"auth status --json hosts": "not json"}}
	if _, err := NewGHWith("gh", junk.run).Accounts(context.Background()); err == nil {
		t.Error("an unreadable answer must be reported")
	}
}

func TestToken(t *testing.T) {
	c := &canned{answers: map[string]string{"auth token --hostname github.com --user beta": "gho_fake_token_value\n"}}
	gh := NewGHWith("gh", c.run)
	tok, err := gh.Token(context.Background(), "beta")
	if err != nil || tok != "gho_fake_token_value" {
		t.Fatalf("token = %q, %v", tok, err)
	}
	if _, err := gh.Token(context.Background(), "ghost"); err == nil {
		t.Error("an empty answer is no token")
	}
	failing := NewGHWith("gh", (&canned{errs: map[string]error{"auth token --hostname github.com --user x": errors.New("gh auth token: no account")}}).run)
	if _, err := failing.Token(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "no token for x") {
		t.Errorf("err = %v", err)
	}
}

func TestCheckReadsTheAccountItsScopesAndOrgs(t *testing.T) {
	c := &canned{answers: map[string]string{
		"auth token --hostname github.com --user beta": "tok123\n",
		"api -i user":                  "HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nX-Oauth-Scopes: gist, read:org, repo\r\n\r\n{\"login\":\"beta\"}",
		"api user/orgs --jq .[].login": "acme\nother-org\n",
	}}
	res, err := NewGHWith("gh", c.run).Check(context.Background(), "beta")
	if err != nil {
		t.Fatal(err)
	}
	if res.Login != "beta" || !slices.Equal(res.Scopes, []string{"gist", "read:org", "repo"}) || !slices.Equal(res.Orgs, []string{"acme", "other-org"}) || res.OrgsNote != "" {
		t.Errorf("result = %+v", res)
	}
	// the token goes in the environment of the calls, never in their arguments
	for i, call := range c.calls {
		if strings.Contains(call, "tok123") {
			t.Errorf("the token is in the arguments of %q", call)
		}
		if strings.HasPrefix(call, "api") && !slices.Contains(c.envs[i], "GH_TOKEN=tok123") {
			t.Errorf("%q didn't get the token in its environment", call)
		}
	}
}

func TestCheckProblems(t *testing.T) {
	ok := map[string]string{
		"auth token --hostname github.com --user beta": "tok123",
		"api -i user": "HTTP/2.0 200 OK\n\n{\"login\":\"beta\"}",
	}
	// orgs can't be listed: still a result, with a note
	c := &canned{answers: ok, errs: map[string]error{"api user/orgs --jq .[].login": errors.New("gh api: 403")}}
	res, err := NewGHWith("gh", c.run).Check(context.Background(), "beta")
	if err != nil || res.Login != "beta" || res.OrgsNote == "" || len(res.Orgs) != 0 {
		t.Errorf("orgs note: %+v %v", res, err)
	}
	// no token
	if _, err := NewGHWith("gh", (&canned{}).run).Check(context.Background(), "beta"); err == nil {
		t.Error("no token must fail")
	}
	// GitHub refuses the token
	refused := &canned{answers: map[string]string{"auth token --hostname github.com --user beta": "tok"}, errs: map[string]error{"api -i user": errors.New("gh api: 401")}}
	if _, err := NewGHWith("gh", refused.run).Check(context.Background(), "beta"); err == nil || !strings.Contains(err.Error(), "didn't accept") {
		t.Errorf("err = %v", err)
	}
	// an answer with no login
	odd := &canned{answers: map[string]string{"auth token --hostname github.com --user beta": "tok", "api -i user": "HTTP/2.0 200 OK\n\n{}"}}
	if _, err := NewGHWith("gh", odd.run).Check(context.Background(), "beta"); err == nil {
		t.Error("an answer without a login must fail")
	}
}

func TestNoGHInstalled(t *testing.T) {
	gh := &GH{}
	gh.run = gh.exec
	if gh.Installed() || gh.Path() != "" {
		t.Error("a GH with no path isn't installed")
	}
	if _, err := gh.Accounts(context.Background()); !errors.Is(err, ErrNoGH) {
		t.Errorf("Accounts = %v", err)
	}
	if _, err := gh.Token(context.Background(), "x"); !errors.Is(err, ErrNoGH) {
		t.Errorf("Token = %v", err)
	}
	if !NewGHWith("/some/gh", nil).Installed() {
		t.Error("a GH with a path is installed")
	}
}
