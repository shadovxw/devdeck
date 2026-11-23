package api

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/feature"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/review"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

const reviewsBase = "/api/v1/features/demo/blob/reviews"

type reviewFixture struct {
	h      http.Handler
	runner *review.Runner
	plan   string // the plan's worktree
	mu     sync.Mutex
	calls  []proc.Cmd
	// gate, when set, holds every tool until it is closed.
	gate    chan struct{}
	missing map[string]bool
	// prompts is what each Claude run was given on standard input.
	prompts []string
}

func (f *reviewFixture) exec(ctx context.Context, c proc.Cmd) (proc.Result, error) {
	f.mu.Lock()
	f.calls = append(f.calls, c)
	gate := f.gate
	f.mu.Unlock()
	if gate != nil {
		select {
		case <-gate:
		case <-ctx.Done():
			return proc.Result{}, ctx.Err()
		}
	}
	if filepath.Base(c.Name) == "claude" {
		f.mu.Lock()
		f.prompts = append(f.prompts, c.Stdin)
		f.mu.Unlock()
		c.OnLine(proc.Stdout, "VERDICT: warn")
		c.OnLine(proc.Stdout, "SUMMARY: go.mod has no tests.")
		c.OnLine(proc.Stdout, "- go.mod:1 nothing tests this module yet")
		return proc.Result{ExitCode: 0}, nil
	}
	c.OnLine(proc.Stdout, "ok  \tdemo\t0.1s")
	return proc.Result{ExitCode: 0}, nil
}

func (f *reviewFixture) programs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, c := range f.calls {
		out = append(out, filepath.Base(c.Name))
	}
	return out
}

// reviewServer is a server with the user's workspace "demo": a code repo "api" (a base branch acme and a branch
// acme-a1-first with a go.mod, but none for PR a2), and a plan plan/blob checked out as a worktree, so results can
// be saved. The tools are fakes.
func reviewServer(t *testing.T, checkedOut bool) *reviewFixture {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git isn't installed")
	}
	env := []string{"GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_CONFIG_SYSTEM=" + os.DevNull, "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=T", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=T", "GIT_COMMITTER_EMAIL=t@example.com"}

	code := t.TempDir()
	api := filepath.Join(code, "api")
	must(t, os.MkdirAll(api, 0o755))
	for _, args := range [][]string{{"init", "-q", "-b", "acme"}, {"commit", "-q", "--allow-empty", "-m", "base"}, {"switch", "-q", "-c", "acme-a1-first"}} {
		git(t, env, api, args...)
	}
	must(t, os.WriteFile(filepath.Join(api, "go.mod"), []byte("module demo\n"), 0o600))
	git(t, env, api, "add", ".")
	git(t, env, api, "commit", "-q", "-m", "the PR")
	git(t, env, api, "switch", "-q", "acme")

	plans := t.TempDir()
	for _, args := range [][]string{{"init", "-q", "-b", "main"}, {"commit", "-q", "--allow-empty", "-m", "start"}, {"switch", "-q", "-c", "plan/blob"}} {
		git(t, env, plans, args...)
	}
	must(t, os.WriteFile(filepath.Join(plans, "feature.yaml"), []byte(apiFeature), 0o600))
	git(t, env, plans, "add", ".")
	git(t, env, plans, "commit", "-q", "-m", "plan")
	git(t, env, plans, "switch", "-q", "main")
	planDir := ""
	if checkedOut {
		planDir = filepath.Join(t.TempDir(), "blob")
		git(t, env, plans, "worktree", "add", "-q", planDir, "plan/blob")
	}

	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "demo"), 0o755))
	yaml := fmt.Sprintf("version: 1\nname: demo\nroot: '%s'\nplans_repo:\n  path: '%s'\nrepos:\n  - id: api\n    path: api\n    remote: github.com/acme/api\n", filepath.ToSlash(code), filepath.ToSlash(plans))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "workspace.yaml"), []byte(yaml), 0o600))

	gh := gitx.NewGHWith("gh", func(_ context.Context, _ []string, args ...string) (string, error) {
		if strings.Join(args, " ") == prListKey {
			return "[]", nil
		}
		return "", fmt.Errorf("unexpected gh call: %v", args)
	})
	svc := &gitx.Service{Store: &gitx.Store{Dir: t.TempDir()}, GH: gh, Git: gitx.Git{Env: env}}
	f := &reviewFixture{plan: planDir, missing: map[string]bool{}}
	f.runner = &review.Runner{
		Git: svc.Git, WorkDir: filepath.Join(t.TempDir(), "work"), Workers: 2, Exec: f.exec,
		Locate: func(p string) (string, bool) { return "/bin/" + p, !f.missing[p] },
	}

	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(), GitX: svc, Reviews: f.runner,
		Workspaces: &workspace.Manager{Dir: dir, ExamplesDir: filepath.Join("..", "..", "examples", "workspaces")},
	})
	f.h = e
	return f
}

func startReviews(f *reviewFixture, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, reviewsBase, strings.NewReader(body))
	req.Host = "127.0.0.1:7070"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	return rec
}

func TestAReviewRunsAndItsResultShowsInTheFeature(t *testing.T) {
	f := reviewServer(t, true)
	rec := startReviews(f, `{"pr":"a1","tool":"tests"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d %s", rec.Code, rec.Body)
	}
	got := decode[reviewStarted](t, rec.Body.Bytes())
	if len(got.Started) != 1 || got.Started[0].Tool != "tests" || got.Started[0].PR != "a1" || got.Started[0].Repo != "api" || len(got.Skipped) != 0 {
		t.Fatalf("started = %+v", got)
	}
	f.runner.Wait()

	runs := decode[struct{ Runs []review.Run }](t, do(f.h, http.MethodGet, reviewsBase).Body.Bytes()).Runs
	if len(runs) != 1 || runs[0].State != review.StateDone || runs[0].Status != review.StatusPass || runs[0].File != "reviews/a1-tests.md" {
		t.Fatalf("runs = %+v", runs)
	}
	if _, err := os.Stat(filepath.Join(f.plan, "reviews", "a1-tests.md")); err != nil {
		t.Errorf("the result is saved in the plan's folder: %v", err)
	}

	d := decode[feature.Detail](t, do(f.h, http.MethodGet, "/api/v1/features/demo/blob").Body.Bytes())
	var a1 feature.PR
	for _, p := range d.PRs {
		if p.ID == "a1" {
			a1 = p
		}
	}
	r := a1.Reviews["tests"]
	if r.Status != "pass" || r.Stale || r.File != "reviews/a1-tests.md" || a1.Local == nil || r.Commit != a1.Local.Head {
		t.Errorf("a1's saved review = %+v, local %+v", r, a1.Local)
	}
	if d.ReadOnly || len(d.Tools) != len(review.Tools) {
		t.Errorf("read-only %v, %d tools", d.ReadOnly, len(d.Tools))
	}
	if got := f.programs(); len(got) != 1 || got[0] != "go" {
		t.Errorf("commands = %v", got)
	}
}

func TestReviewEverythingRunsEveryInstalledToolOnEveryBranch(t *testing.T) {
	f := reviewServer(t, true)
	f.missing["semgrep"] = true
	rec := startReviews(f, `{}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d %s", rec.Code, rec.Body)
	}
	got := decode[reviewStarted](t, rec.Body.Bytes())
	tools := map[string]bool{}
	for _, r := range got.Started {
		if r.PR != "a1" {
			t.Errorf("only a1 has a branch, but %s was started", r.PR)
		}
		tools[r.Tool] = true
	}
	if len(got.Started) != len(review.Tools)-2 || tools["semgrep"] || tools["claude"] || !tools["tests"] || !tools["gitleaks"] {
		t.Errorf("started %v: every tool but the one that isn't installed and the Claude review, which runs only on its own button", tools)
	}
	f.runner.Wait()
	d := decode[feature.Detail](t, do(f.h, http.MethodGet, "/api/v1/features/demo/blob").Body.Bytes())
	for _, p := range d.PRs {
		if p.ID == "a1" && len(p.Reviews) != len(review.Tools)-2 {
			t.Errorf("a1 has %d saved reviews: %v", len(p.Reviews), p.Reviews)
		}
		if p.ID == "a2" && len(p.Reviews) != 0 {
			t.Errorf("a2 has no branch and no reviews: %v", p.Reviews)
		}
	}
}

func TestTheClaudeReviewGetsThePlanTheStepsAndTheDiff(t *testing.T) {
	f := reviewServer(t, true)
	must(t, os.WriteFile(filepath.Join(f.plan, "plan.md"), []byte("# Blob plan\nMove the data.\n"), 0o600))

	rec := startReviews(f, `{"pr":"a1","tool":"claude"}`)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d %s", rec.Code, rec.Body)
	}
	f.runner.Wait()

	if len(f.prompts) != 1 {
		t.Fatalf("Claude was run %d times, want once", len(f.prompts))
	}
	for _, want := range []string{"# Blob plan", "THIS PR: a1", "+module demo", "diff --git a/go.mod"} {
		if !strings.Contains(f.prompts[0], want) {
			t.Errorf("the prompt should hold %q:\n%s", want, f.prompts[0])
		}
	}
	d := decode[feature.Detail](t, do(f.h, http.MethodGet, "/api/v1/features/demo/blob").Body.Bytes())
	for _, p := range d.PRs {
		if r := p.Reviews["claude"]; p.ID == "a1" && (r.Status != "warn" || r.File != "reviews/a1-claude.md" || !strings.Contains(r.Summary, "no tests")) {
			t.Errorf("a1's Claude review = %+v", r)
		}
	}
	raw, err := os.ReadFile(filepath.Join(f.plan, "reviews", "a1-claude.md"))
	if err != nil || !strings.Contains(string(raw), "- go.mod:1 nothing tests this module yet") {
		t.Errorf("the saved result should list the finding: %v\n%s", err, raw)
	}
}

func TestReviewsAreRefusedWithAReason(t *testing.T) {
	f := reviewServer(t, true)
	f.missing["semgrep"] = true
	for body, want := range map[string]int{
		`{"pr":"a1","tool":"nope"}`:    http.StatusBadRequest,
		`{"pr":"zz","tool":"tests"}`:   http.StatusNotFound,
		`{"pr":"a2","tool":"tests"}`:   http.StatusConflict, // no branch yet
		`{"pr":"a1","tool":"semgrep"}`: http.StatusFailedDependency,
		`not json`:                     http.StatusBadRequest,
	} {
		rec := startReviews(f, body)
		if rec.Code != want {
			t.Errorf("%s = %d %s, want %d", body, rec.Code, rec.Body, want)
		}
	}
	if rec := startReviews(f, `{"pr":"a1","tool":"semgrep"}`); !strings.Contains(rec.Body.String(), "Install Semgrep") {
		t.Errorf("the refusal should say how to install it: %s", rec.Body)
	}
	if len(f.programs()) != 0 {
		t.Errorf("a refused request must not run anything: %v", f.programs())
	}
	// unknown workspace or feature
	req := httptest.NewRequest(http.MethodPost, "/api/v1/features/demo/nothing/reviews", strings.NewReader(`{}`))
	req.Host = "127.0.0.1:7070"
	rec := httptest.NewRecorder()
	f.h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("an unknown feature = %d", rec.Code)
	}
}

func TestAPlanThatIsNotCheckedOutCannotSaveResults(t *testing.T) {
	f := reviewServer(t, false)
	rec := startReviews(f, `{"pr":"a1","tool":"tests"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "worktree add") || !strings.Contains(rec.Body.String(), "plan/blob") {
		t.Errorf("a read-only plan = %d %s: say how to check it out", rec.Code, rec.Body)
	}
	if len(f.programs()) != 0 {
		t.Errorf("nothing may run when the result has nowhere to go")
	}
}

func TestOneRunOfAToolAtATimeAndCancelling(t *testing.T) {
	f := reviewServer(t, true)
	f.gate = make(chan struct{})
	first := decode[reviewStarted](t, startReviews(f, `{"pr":"a1","tool":"tests"}`).Body.Bytes())
	if len(first.Started) != 1 {
		t.Fatalf("first = %+v", first)
	}

	again := decode[reviewStarted](t, startReviews(f, `{"pr":"a1","tool":"tests"}`).Body.Bytes())
	if len(again.Started) != 0 || len(again.Skipped) != 1 || !strings.Contains(again.Skipped[0].Reason, "already running") {
		t.Errorf("the same tool on the same PR again = %+v", again)
	}

	cancel := func(id string) int {
		req := httptest.NewRequest(http.MethodPost, reviewsBase+"/"+id+"/cancel", nil)
		req.Host = "127.0.0.1:7070"
		rec := httptest.NewRecorder()
		f.h.ServeHTTP(rec, req)
		return rec.Code
	}
	if code := cancel("no-such-run"); code != http.StatusNotFound {
		t.Errorf("an unknown run = %d", code)
	}
	if code := cancel(first.Started[0].ID); code != http.StatusNoContent {
		t.Errorf("cancel = %d", code)
	}
	f.runner.Wait()
	runs := decode[struct{ Runs []review.Run }](t, do(f.h, http.MethodGet, reviewsBase).Body.Bytes()).Runs
	if len(runs) != 1 || runs[0].State != review.StateCancelled {
		t.Errorf("runs = %+v", runs)
	}
	if _, err := os.Stat(filepath.Join(f.plan, "reviews")); err == nil {
		t.Errorf("a cancelled run saves nothing")
	}
	if code := cancel(first.Started[0].ID); code != http.StatusNotFound {
		t.Errorf("a run that has ended = %d", code)
	}
}

func TestClaudesConnectorCannotRunReviews(t *testing.T) {
	f := reviewServer(t, true)
	for _, method := range []string{http.MethodPost, http.MethodGet} {
		req := httptest.NewRequest(method, reviewsBase, strings.NewReader(`{}`))
		req.Host = "127.0.0.1:7070"
		req.Header.Set(ConnectorHeader, ConnectorClient)
		rec := httptest.NewRecorder()
		f.h.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Errorf("%s as the connector = %d, want 403", method, rec.Code)
		}
	}
	if len(f.programs()) != 0 {
		t.Errorf("the connector must not be able to run a tool")
	}
}
