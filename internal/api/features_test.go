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
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/feature"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

const apiFeature = `version: 1
feature: acme
title: Demo feature
repos: [api]
prs:
  - { id: a1, repo: api, slug: first, title: First, steps: [ { title: One, status: done } ] }
  - { id: a2, repo: api, slug: second, title: Second, steps: [ { title: Two } ] }
`

const prListKey = "pr list --repo acme/api --state all --limit 200 --json number,title,headRefName,baseRefName,state,isDraft,reviewDecision,url,additions,deletions,changedFiles,mergedAt,updatedAt,statusCheckRollup"

const prListAnswer = `[{"number":7,"title":"First","headRefName":"acme-a1-first","baseRefName":"acme","state":"MERGED","isDraft":false,"reviewDecision":"APPROVED","url":"https://github.com/acme/api/pull/7","additions":30,"deletions":2,"changedFiles":3,"statusCheckRollup":[]}]`

// featuresServer is a server with the user's workspace "demo" (a plans repository holding plan/blob, and a repo
// "api" whose folder isn't on this machine), a workspace "bare" with no plans_repo, and a fake gh.
func featuresServer(t *testing.T, plansRepo string) (http.Handler, *int) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git isn't installed")
	}
	env := []string{"GIT_CONFIG_GLOBAL=" + os.DevNull, "GIT_CONFIG_SYSTEM=" + os.DevNull, "GIT_CONFIG_NOSYSTEM=1",
		"GIT_AUTHOR_NAME=T", "GIT_AUTHOR_EMAIL=t@example.com", "GIT_COMMITTER_NAME=T", "GIT_COMMITTER_EMAIL=t@example.com"}
	if plansRepo == "" {
		plansRepo = t.TempDir()
		for _, args := range [][]string{{"init", "-q", "-b", "main"}, {"commit", "-q", "--allow-empty", "-m", "start"}, {"switch", "-q", "-c", "plan/blob"}} {
			git(t, env, plansRepo, args...)
		}
		must(t, os.WriteFile(filepath.Join(plansRepo, "feature.yaml"), []byte(apiFeature), 0o600))
		must(t, os.WriteFile(filepath.Join(plansRepo, "plan.md"), []byte("# plan\n"), 0o600))
		git(t, env, plansRepo, "add", ".")
		git(t, env, plansRepo, "commit", "-q", "-m", "plan")
		git(t, env, plansRepo, "switch", "-q", "main")
	}

	dir := filepath.Join(t.TempDir(), "workspaces")
	code := t.TempDir()
	for name, yaml := range map[string]string{
		"demo": fmt.Sprintf("version: 1\nname: demo\nroot: '%s'\nplans_repo:\n  path: '%s'\nrepos:\n  - id: api\n    path: api\n    remote: github.com/acme/api\n", filepath.ToSlash(code), filepath.ToSlash(plansRepo)),
		"bare": fmt.Sprintf("version: 1\nname: bare\nroot: '%s'\n", filepath.ToSlash(code)),
	} {
		must(t, os.MkdirAll(filepath.Join(dir, name), 0o755))
		must(t, os.WriteFile(filepath.Join(dir, name, "workspace.yaml"), []byte(yaml), 0o600))
	}

	asked := 0
	gh := gitx.NewGHWith("gh", func(_ context.Context, _ []string, args ...string) (string, error) {
		if key := strings.Join(args, " "); key == prListKey {
			asked++
			return prListAnswer, nil
		}
		return "", fmt.Errorf("unexpected gh call: %v", args)
	})
	svc := &gitx.Service{Store: &gitx.Store{Dir: t.TempDir()}, GH: gh, Git: gitx.Git{Env: env}}
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
	return e, &asked
}

func git(t *testing.T, env []string, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(), env...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
}

func TestFeatureRoutesAreOptional(t *testing.T) {
	e := workspaceServer(t)
	if rec := do(e, http.MethodGet, "/api/v1/features"); rec.Code != http.StatusNotFound {
		t.Errorf("without a git service = %d, want 404", rec.Code)
	}
}

func TestListFeatures(t *testing.T) {
	h, _ := featuresServer(t, "")
	rec := do(h, http.MethodGet, "/api/v1/features")
	if rec.Code != http.StatusOK {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	got := decode[featuresResponse](t, rec.Body.Bytes())
	if len(got.Features) != 1 || got.Features[0].Workspace != "demo" || got.Features[0].Name != "blob" || got.Features[0].PRs != 2 || got.Features[0].Title != "Demo feature" {
		t.Errorf("features = %+v", got.Features)
	}
	if got.Features[0].Steps != 2 || got.Features[0].StepsDone != 1 || !got.Features[0].ReadOnly {
		t.Errorf("summary = %+v (no worktree, so read-only)", got.Features[0])
	}
	if len(got.NoPlansRepo) != 1 || got.NoPlansRepo[0] != "bare" {
		t.Errorf("no_plans_repo = %v (sample workspaces are left out, and demo has one)", got.NoPlansRepo)
	}
	if len(got.Problems) != 0 {
		t.Errorf("problems = %+v", got.Problems)
	}
}

func TestFeatureDetailAddsTheLiveState(t *testing.T) {
	h, asked := featuresServer(t, "")
	rec := do(h, http.MethodGet, "/api/v1/features/demo/blob")
	if rec.Code != http.StatusOK {
		t.Fatalf("detail = %d %s", rec.Code, rec.Body)
	}
	d := decode[feature.Detail](t, rec.Body.Bytes())
	if len(d.PRs) != 2 || d.PRs[0].Branch != "acme-a1-first" || d.PRs[0].State != feature.StateMerged || d.PRs[0].GitHub == nil || d.PRs[0].GitHub.Number != 7 {
		t.Fatalf("PRs = %+v", d.PRs)
	}
	if d.PRs[1].State != feature.StatePlanned || d.PRs[1].Base != "acme" || d.PRs[1].Below != "a1" {
		t.Errorf("a2 = %+v (planned; a1 is merged, so it now targets the feature branch)", d.PRs[1])
	}
	if d.PRs[0].Size == nil || d.PRs[0].Size.Added != 30 {
		t.Errorf("a1 size = %+v (from GitHub: the repo's folder isn't on this machine)", d.PRs[0].Size)
	}
	if len(d.Problems) != 0 && !strings.Contains(strings.Join(d.Problems, " "), "git couldn't") {
		t.Errorf("problems = %v", d.Problems)
	}
	if len(d.Files) != 2 || d.Files[0] != "feature.yaml" || d.Files[1] != "plan.md" {
		t.Errorf("files = %v", d.Files)
	}
	if d.Pick != "a2" || len(d.NextUp) != 0 {
		t.Errorf("pick = %q, next up = %v", d.Pick, d.NextUp)
	}

	// A second read within the minute reuses GitHub's answer, ?refresh=1 asks again.
	before := *asked
	do(h, http.MethodGet, "/api/v1/features/demo/blob")
	if *asked != before {
		t.Errorf("the pull request list should be cached: %d calls then %d", before, *asked)
	}
	do(h, http.MethodGet, "/api/v1/features/demo/blob?refresh=1")
	if *asked != before+1 {
		t.Errorf("refresh should ask again: %d calls", *asked)
	}
}

func TestFeatureFilesAndRefusals(t *testing.T) {
	h, _ := featuresServer(t, "")
	rec := do(h, http.MethodGet, "/api/v1/features/demo/blob/files/plan.md")
	if rec.Code != http.StatusOK {
		t.Fatalf("file = %d %s", rec.Code, rec.Body)
	}
	if f := decode[featureFileResponse](t, rec.Body.Bytes()); f.Path != "plan.md" || f.Text != "# plan\n" {
		t.Errorf("file = %+v", f)
	}
	for path, want := range map[string]int{
		"/api/v1/features/demo/blob/files/nope.md":     http.StatusNotFound,
		"/api/v1/features/demo/blob/files/..%2F..%2Fx": http.StatusNotFound,
		"/api/v1/features/demo/blob/files/.git/config": http.StatusNotFound,
		"/api/v1/features/demo/nothing":                http.StatusNotFound,
		"/api/v1/features/nope/blob":                   http.StatusNotFound,
		"/api/v1/features/bare/blob":                   http.StatusNotFound, // no plans_repo
		"/api/v1/features/acme-shop/blob":              http.StatusNotFound, // a sample workspace
	} {
		if rec := do(h, http.MethodGet, path); rec.Code != want {
			t.Errorf("GET %s = %d, want %d", path, rec.Code, want)
		}
	}
}

func TestMissingPlansRepository(t *testing.T) {
	h, _ := featuresServer(t, filepath.Join(t.TempDir(), "not-there"))
	list := decode[featuresResponse](t, do(h, http.MethodGet, "/api/v1/features").Body.Bytes())
	if len(list.Problems) != 1 || list.Problems[0].Workspace != "demo" || !strings.Contains(list.Problems[0].Message, "plans repository") {
		t.Errorf("problems = %+v", list.Problems)
	}
	if rec := do(h, http.MethodGet, "/api/v1/features/demo/blob"); rec.Code != http.StatusFailedDependency {
		t.Errorf("detail = %d, want 424", rec.Code)
	}
}

func TestClaudesConnectorCannotReadFeaturesYet(t *testing.T) {
	h, _ := featuresServer(t, "")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/features", nil)
	req.Host = "127.0.0.1:7070"
	req.Header.Set(ConnectorHeader, ConnectorClient)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Errorf("the connector's allow-list has no feature route yet: got %d", rec.Code)
	}
}

func TestFeatureSchemaIsServed(t *testing.T) {
	h, _ := featuresServer(t, "")
	rec := do(h, http.MethodGet, "/api/v1/schema/feature")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "devdeck feature") {
		t.Errorf("schema = %d %s", rec.Code, rec.Body.String()[:min(80, rec.Body.Len())])
	}
}

func TestFeatureStatusAsText(t *testing.T) {
	h, _ := featuresServer(t, "")
	rec := do(h, http.MethodGet, "/api/v1/features/demo/blob/status")
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("status = %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	squeezed := strings.Join(strings.Fields(rec.Body.String()), " ")
	for _, want := range []string{"Demo feature acme -> dev", "plan/blob (read-only: no worktree)", "api a1 - merged #7", "hand to Claude next: a2"} {
		if !strings.Contains(squeezed, want) {
			t.Errorf("no %q in:\n%s", want, rec.Body)
		}
	}
	if rec := do(h, http.MethodGet, "/api/v1/features/demo/nothing/status"); rec.Code != http.StatusNotFound {
		t.Errorf("an unknown feature = %d", rec.Code)
	}
}
