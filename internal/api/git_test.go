package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

const fakeStatus = `{"hosts":{"github.com":[
 {"state":"success","active":true,"host":"github.com","login":"me-personal","tokenSource":"keyring","scopes":"repo, read:org"},
 {"state":"success","active":false,"host":"github.com","login":"office-dev","tokenSource":"keyring","scopes":"repo"}]}}`

// fakeGH answers gh by its arguments. A key in errs makes that call fail.
func fakeGH(errs map[string]error) *gitx.GH {
	answers := map[string]string{
		"auth status --json hosts":                           fakeStatus,
		"auth token --hostname github.com --user office-dev": "tok-office\n",
		"api -i user":                  "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, read:org\n\n{\"login\":\"office-dev\"}",
		"api user/orgs --jq .[].login": "acme\n",
	}
	return gitx.NewGHWith("gh", func(_ context.Context, _ []string, args ...string) (string, error) {
		key := strings.Join(args, " ")
		if err, ok := errs[key]; ok {
			return "", err
		}
		return answers[key], nil
	})
}

type gitFixture struct {
	h    http.Handler
	svc  *gitx.Service
	root string
	env  []string
}

// gitServer is a server with a local workspace "demo" (repos api and other, both real git
// repositories), the sample workspace, and a git service that never touches the real git
// config or the real gh.
func gitServer(t *testing.T, gh *gitx.GH) gitFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git isn't installed")
	}
	cfgFile := filepath.Join(t.TempDir(), "gitconfig")
	env := []string{"GIT_CONFIG_GLOBAL=" + cfgFile, "GIT_CONFIG_NOSYSTEM=1", "HOME=" + filepath.Dir(cfgFile), "USERPROFILE=" + filepath.Dir(cfgFile)}

	root := t.TempDir()
	for name, remote := range map[string]string{"api": "https://github.com/acme/api.git", "other": "https://github.com/stranger/thing.git"} {
		dir := filepath.Join(root, name)
		must(t, os.MkdirAll(dir, 0o755))
		for _, args := range [][]string{{"init", "-q"}, {"remote", "add", "origin", remote}} {
			cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
			cmd.Env = append(os.Environ(), env...)
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("git %v: %v %s", args, err, out)
			}
		}
	}
	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "demo", "stacks"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "workspace.yaml"),
		[]byte(fmt.Sprintf("version: 1\nname: demo\nroot: '%s'\nrepos:\n  - id: api\n    path: api\n  - id: other\n    path: other\n  - id: gone\n    path: gone\n", filepath.ToSlash(root))), 0o600))

	data := t.TempDir()
	svc := &gitx.Service{
		Store: &gitx.Store{Dir: data}, GH: gh,
		Setup: &gitx.Setup{Exe: "C:/devdeck/devdeck.exe", DataDir: data, Env: env},
		Git:   gitx.Git{Env: env},
	}
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(), GitX: svc,
		Workspaces: &workspace.Manager{Dir: dir, ExamplesDir: filepath.Join("..", "..", "examples", "workspaces")},
	})
	return gitFixture{h: e, svc: svc, root: root, env: env}
}

var goodConfig = gitx.Config{
	Connections: []gitx.Connection{
		{ID: "personal", User: "me-personal", Name: "Me Personal", Email: "me@example.com"},
		{ID: "office", User: "office-dev", Name: "Me Office", Email: "me@office.example"},
		{ID: "ghost", User: "not-signed-in"},
	},
	Rules: []gitx.Rule{{Match: "github.com/acme/*", Connection: "office"}, {Match: "github.com/me-personal/*", Connection: "personal"}},
}

func TestGitRoutesAreOptional(t *testing.T) {
	e := workspaceServer(t)
	if rec := do(e, http.MethodGet, "/api/v1/git"); rec.Code != http.StatusNotFound {
		t.Errorf("without a git service = %d, want 404", rec.Code)
	}
}

func TestOverviewAndSavingTheConfiguration(t *testing.T) {
	f := gitServer(t, fakeGH(nil))
	empty := decode[gitx.Overview](t, do(f.h, http.MethodGet, "/api/v1/git").Body.Bytes())
	if !empty.GHInstalled || len(empty.Accounts) != 2 || empty.Accounts[0].Login != "me-personal" || !empty.Accounts[0].Active || len(empty.Connections) != 0 || empty.Rules == nil {
		t.Fatalf("empty overview = %+v", empty)
	}

	rec := postJSON(f.h, http.MethodPut, "/api/v1/git/config", goodConfig)
	if rec.Code != http.StatusOK {
		t.Fatalf("save = %d %s", rec.Code, rec.Body)
	}
	o := decode[gitx.Overview](t, rec.Body.Bytes())
	if len(o.Connections) != 3 || len(o.Rules) != 2 {
		t.Fatalf("overview after save = %+v", o)
	}
	signed := map[string]bool{}
	for _, c := range o.Connections {
		signed[c.ID] = c.SignedIn
	}
	if !signed["personal"] || !signed["office"] || signed["ghost"] {
		t.Errorf("signed in = %v (a connection is signed in when gh has its account)", signed)
	}
	if saved, err := f.svc.Store.Load(); err != nil || len(saved.Rules) != 2 {
		t.Errorf("not on disk: %+v %v", saved, err)
	}

	bad := goodConfig
	bad.Rules = []gitx.Rule{{Match: "github.com/acme/*", Connection: "nobody"}}
	if rec := postJSON(f.h, http.MethodPut, "/api/v1/git/config", bad); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "no connection") {
		t.Errorf("an invalid configuration = %d %s", rec.Code, rec.Body)
	}
	if saved, _ := f.svc.Store.Load(); len(saved.Rules) != 2 {
		t.Error("an invalid configuration must not replace the saved one")
	}
}

func TestOverviewWhenGHIsMissingOrFailing(t *testing.T) {
	f := gitServer(t, gitx.NewGHWith("", nil))
	o := decode[gitx.Overview](t, do(f.h, http.MethodGet, "/api/v1/git").Body.Bytes())
	if o.GHInstalled || len(o.Accounts) != 0 {
		t.Errorf("no gh: %+v", o)
	}
	f = gitServer(t, fakeGH(map[string]error{"auth status --json hosts": errors.New("gh auth: boom")}))
	o = decode[gitx.Overview](t, do(f.h, http.MethodGet, "/api/v1/git").Body.Bytes())
	if !o.GHInstalled || o.AccountsError == "" || o.Accounts == nil {
		t.Errorf("a failing gh: %+v", o)
	}
}

func TestCheckAConnection(t *testing.T) {
	f := gitServer(t, fakeGH(nil))
	if err := f.svc.Store.Save(goodConfig); err != nil {
		t.Fatal(err)
	}
	rec := do(f.h, http.MethodPost, "/api/v1/git/connections/office/check")
	if rec.Code != http.StatusOK {
		t.Fatalf("check = %d %s", rec.Code, rec.Body)
	}
	res := decode[gitx.CheckResult](t, rec.Body.Bytes())
	if res.Login != "office-dev" || len(res.Orgs) != 1 || res.Orgs[0] != "acme" || len(res.Scopes) != 2 {
		t.Errorf("result = %+v", res)
	}
	if strings.Contains(rec.Body.String(), "tok-office") {
		t.Error("a token must never be in an answer")
	}
	if rec := do(f.h, http.MethodPost, "/api/v1/git/connections/nope/check"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown connection = %d", rec.Code)
	}
	// the account isn't signed in
	if rec := do(f.h, http.MethodPost, "/api/v1/git/connections/ghost/check"); rec.Code != http.StatusBadGateway {
		t.Errorf("a connection whose account isn't signed in = %d, want 502", rec.Code)
	}
	// no gh at all
	none := gitServer(t, gitx.NewGHWith("", func(context.Context, []string, ...string) (string, error) { return "", gitx.ErrNoGH }))
	if err := none.svc.Store.Save(goodConfig); err != nil {
		t.Fatal(err)
	}
	if rec := do(none.h, http.MethodPost, "/api/v1/git/connections/office/check"); rec.Code != http.StatusFailedDependency {
		t.Errorf("no gh = %d, want 424", rec.Code)
	}
}

func TestMatchARemote(t *testing.T) {
	f := gitServer(t, fakeGH(nil))
	if err := f.svc.Store.Save(goodConfig); err != nil {
		t.Fatal(err)
	}
	get := func(remote string) (int, map[string]any) {
		rec := do(f.h, http.MethodGet, "/api/v1/git/match?remote="+url.QueryEscape(remote))
		var out map[string]any
		if rec.Code == http.StatusOK {
			out = decode[map[string]any](t, rec.Body.Bytes())
		}
		return rec.Code, out
	}
	if code, out := get("https://github.com/acme/api.git"); code != 200 || out["matched"] != true || out["connection"] != "office" {
		t.Errorf("acme: %d %v", code, out)
	}
	if code, out := get("git@github.com:stranger/x.git"); code != 200 || out["matched"] != false {
		t.Errorf("stranger: %d %v", code, out)
	}
	if code, _ := get("not a remote"); code != http.StatusBadRequest {
		t.Errorf("garbage = %d", code)
	}
}

func TestSetupNeedsAConfirmationAndCanBeUndone(t *testing.T) {
	f := gitServer(t, fakeGH(nil))
	st := decode[gitx.SetupState](t, do(f.h, http.MethodGet, "/api/v1/git/setup").Body.Bytes())
	if !st.GitFound || st.Applied || len(st.Commands) == 0 || !strings.Contains(st.Helper, "git-credential") {
		t.Fatalf("preview = %+v", st)
	}
	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/setup/apply", map[string]bool{}); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "confirm") {
		t.Errorf("apply without confirmation = %d %s", rec.Code, rec.Body)
	}
	if st := decode[gitx.SetupState](t, do(f.h, http.MethodGet, "/api/v1/git/setup").Body.Bytes()); st.Applied {
		t.Fatal("nothing may change without a confirmation")
	}

	rec := postJSON(f.h, http.MethodPost, "/api/v1/git/setup/apply", map[string]bool{"confirm": true})
	if rec.Code != http.StatusOK {
		t.Fatalf("apply = %d %s", rec.Code, rec.Body)
	}
	if st := decode[gitx.SetupState](t, rec.Body.Bytes()); !st.Applied || !st.CanUndo {
		t.Errorf("after apply: %+v", st)
	}
	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/setup/undo", map[string]bool{}); rec.Code != http.StatusBadRequest {
		t.Errorf("undo without confirmation = %d", rec.Code)
	}
	rec = postJSON(f.h, http.MethodPost, "/api/v1/git/setup/undo", map[string]bool{"confirm": true})
	if st := decode[gitx.SetupState](t, rec.Body.Bytes()); rec.Code != http.StatusOK || st.Applied || st.CanUndo {
		t.Errorf("after undo: %d %+v", rec.Code, st)
	}
	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/setup/undo", map[string]bool{"confirm": true}); rec.Code != http.StatusConflict {
		t.Errorf("a second undo = %d, want 409", rec.Code)
	}
}

func TestReposShowTheirAccountAndIdentity(t *testing.T) {
	f := gitServer(t, fakeGH(nil))
	if err := f.svc.Store.Save(goodConfig); err != nil {
		t.Fatal(err)
	}
	rows := decode[[]map[string]any](t, do(f.h, http.MethodGet, "/api/v1/git/repos").Body.Bytes())
	by := map[string]map[string]any{}
	for _, r := range rows {
		by[r["repo"].(string)] = r
	}
	if len(rows) != 3 {
		t.Fatalf("rows = %v (the sample workspace has no real folders and is left out)", rows)
	}
	if r := by["api"]; r["state"] != "wrong-identity" || r["connection"] != "office" || r["workspace"] != "demo" || r["remote"] != "https://github.com/acme/api.git" {
		t.Errorf("api = %v", r)
	}
	if r := by["other"]; r["state"] != "no-rule" {
		t.Errorf("other = %v (flagged: no rule matches it)", r)
	}
	if r := by["gone"]; r["state"] != "missing" {
		t.Errorf("gone = %v", r)
	}

	// write the identity
	rec := postJSON(f.h, http.MethodPost, "/api/v1/git/repos/identity", map[string]string{"workspace": "demo", "repo": "api"})
	if rec.Code != http.StatusOK {
		t.Fatalf("identity = %d %s", rec.Code, rec.Body)
	}
	if got := decode[map[string]any](t, rec.Body.Bytes()); got["state"] != "ok" {
		t.Errorf("after: %v", got)
	}
	out, err := exec.Command("git", "-C", filepath.Join(f.root, "api"), "config", "--local", "user.email").Output()
	if err != nil || strings.TrimSpace(string(out)) != "me@office.example" {
		t.Errorf("the repo's own config: %q %v", out, err)
	}

	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/repos/identity", map[string]string{"workspace": "demo", "repo": "other"}); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), "no account") {
		t.Errorf("a repo with no rule = %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/repos/identity", map[string]string{"workspace": "demo", "repo": "nope"}); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown repo = %d", rec.Code)
	}
	if rec := postJSON(f.h, http.MethodPost, "/api/v1/git/repos/identity", map[string]string{"workspace": "acme-shop", "repo": "api"}); rec.Code != http.StatusNotFound {
		t.Errorf("a repo of a sample workspace = %d", rec.Code)
	}
}
