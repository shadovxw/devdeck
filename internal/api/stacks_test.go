package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// TestHelperSleep is not a test: it is the long-running program a stack starts
// in these tests (the test binary running itself). It does nothing unless asked.
func TestHelperSleep(t *testing.T) {
	if os.Getenv("DEVDECK_API_HELPER") != "1" {
		t.Skip("only used as a child process")
	}
	time.Sleep(time.Hour)
}

// stackFixture writes a local workspace "demo" with one stack "full" whose only
// service is the helper above, and returns a server wired to a real supervisor.
func stackFixture(t *testing.T, preflight func(context.Context, supervisor.StackSpec) (doctor.Report, error)) (http.Handler, *supervisor.Supervisor) {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	must(t, os.MkdirAll(filepath.Join(root, "api"), 0o755))

	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "demo", "stacks"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "workspace.yaml"),
		[]byte(fmt.Sprintf("version: 1\nname: demo\nroot: '%s'\nrepos:\n  - id: api\n    path: api\n", root)), 0o600))
	must(t, os.WriteFile(filepath.Join(dir, "demo", "stacks", "full.yaml"), []byte(fmt.Sprintf(`version: 1
name: full
services:
  - id: sleeper
    repo: api
    kind: command
    cmd: '"%s" -test.run=^TestHelperSleep$'
    env:
      DEVDECK_API_HELPER: "1"
`, exe)), 0o600))

	sup := supervisor.New(supervisor.Options{
		BinDir: t.TempDir(), Preflight: preflight, Settle: 100 * time.Millisecond, PollEvery: 20 * time.Millisecond,
	})
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		sup.StopAll(ctx)
	})
	return serverWith(t, &workspace.Manager{Dir: dir, ExamplesDir: "../../examples/workspaces"}, sup), sup
}

func ready(context.Context, supervisor.StackSpec) (doctor.Report, error) { return doctor.Report{}, nil }

func runs(t *testing.T, e http.Handler) []supervisor.RunStatus {
	t.Helper()
	rec := do(e, http.MethodGet, "/api/v1/runs")
	var out []supervisor.RunStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || rec.Code != http.StatusOK || out == nil {
		t.Fatalf("runs: %d %s (%v)", rec.Code, rec.Body, err)
	}
	return out
}

func TestStackRoutesNeedASupervisor(t *testing.T) {
	e := workspaceServer(t) // has workspaces but no supervisor
	if rec := do(e, http.MethodGet, "/api/v1/runs"); rec.Code != http.StatusNotFound {
		t.Errorf("runs = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/acme-shop/stacks/full/start", nil); rec.Code != http.StatusNotFound {
		t.Errorf("start = %d, want 404", rec.Code)
	}
}

func TestStartRefusals(t *testing.T) {
	e, _ := stackFixture(t, ready)
	base := "/api/v1/workspaces/"

	cases := map[string]int{
		base + "acme-shop/stacks/full/start": http.StatusForbidden, // a sample can't run programs
		base + "nope/stacks/full/start":      http.StatusNotFound,
		base + "demo/stacks/ghost/start":     http.StatusNotFound,
		base + "..%2F/stacks/full/start":     http.StatusNotFound,
	}
	for url, want := range cases {
		if rec := postJSON(e, http.MethodPost, url, nil); rec.Code != want {
			t.Errorf("POST %s = %d, want %d (%s)", url, rec.Code, want, rec.Body)
		}
	}
	if got := runs(t, e); len(got) != 0 {
		t.Errorf("nothing should be running: %+v", got)
	}
}

func TestStartRefusesAWorkspaceWithErrors(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "workspaces")
	must(t, os.MkdirAll(filepath.Join(dir, "broken"), 0o755))
	must(t, os.WriteFile(filepath.Join(dir, "broken", "workspace.yaml"), []byte("version: 1\n"), 0o600))
	e := serverWith(t, &workspace.Manager{Dir: dir}, supervisor.New(supervisor.Options{Preflight: ready}))

	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/broken/stacks/full/start", nil); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("status = %d, want 422 (%s)", rec.Code, rec.Body)
	}
}

func TestStartIsRefusedWhenTheMachineIsNotReady(t *testing.T) {
	e, _ := stackFixture(t, func(context.Context, supervisor.StackSpec) (doctor.Report, error) {
		return doctor.Report{Failures: 1, Checks: []doctor.Check{{ID: "tool:go", Title: "Go", Status: doctor.Fail, Fix: []string{"install it"}}}}, nil
	})

	rec := postJSON(e, http.MethodPost, "/api/v1/workspaces/demo/stacks/full/start", nil)
	var body startRefusal
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusUnprocessableEntity || body.Report == nil || body.Report.Failures != 1 {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	if body.Message == "" || body.Report.Checks[0].Fix[0] != "install it" {
		t.Errorf("body = %+v", body)
	}
	if len(runs(t, e)) != 0 {
		t.Error("nothing should have started")
	}
}

func TestStartRestartAndStop(t *testing.T) {
	e, _ := stackFixture(t, ready)
	url := "/api/v1/workspaces/demo/stacks/full"

	rec := postJSON(e, http.MethodPost, url+"/start", nil)
	var st supervisor.RunStatus
	if err := json.Unmarshal(rec.Body.Bytes(), &st); err != nil || rec.Code != http.StatusAccepted || st.Stack != "full" || len(st.Services) != 1 {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPost, url+"/start", nil); rec.Code != http.StatusConflict {
		t.Errorf("second start = %d, want 409", rec.Code)
	}

	deadline := time.Now().Add(15 * time.Second)
	for {
		got := runs(t, e)
		if len(got) == 1 && got[0].State == supervisor.RunRunning {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("never became running: %+v", got)
		}
		time.Sleep(20 * time.Millisecond)
	}

	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/restart", nil); rec.Code != http.StatusAccepted {
		t.Errorf("restart = %d (%s)", rec.Code, rec.Body)
	}
	if rec := postJSON(e, http.MethodPost, url+"/services/ghost/restart", nil); rec.Code != http.StatusNotFound {
		t.Errorf("restart unknown service = %d, want 404", rec.Code)
	}

	if rec := postJSON(e, http.MethodPost, url+"/stop", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop = %d (%s)", rec.Code, rec.Body)
	}
	if got := runs(t, e); len(got) != 0 {
		t.Errorf("after stop: %+v", got)
	}
	if rec := postJSON(e, http.MethodPost, url+"/stop", nil); rec.Code != http.StatusNotFound {
		t.Errorf("second stop = %d, want 404", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, url+"/services/sleeper/restart", nil); rec.Code != http.StatusNotFound {
		t.Errorf("restart after stop = %d, want 404", rec.Code)
	}
}

func TestDeleteAWorkspace(t *testing.T) {
	e, _ := stackFixture(t, ready)
	url := "/api/v1/workspaces/demo"

	if rec := do(e, http.MethodDelete, "/api/v1/workspaces/acme-shop"); rec.Code != http.StatusForbidden {
		t.Errorf("sample = %d, want 403 (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodDelete, "/api/v1/workspaces/nope"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown = %d, want 404", rec.Code)
	}

	// a workspace with a running stack can't go until the stack is stopped
	if rec := postJSON(e, http.MethodPost, url+"/stacks/full/start", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("start = %d (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodDelete, url); rec.Code != http.StatusConflict {
		t.Errorf("while running = %d, want 409 (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, url); rec.Code != http.StatusOK {
		t.Errorf("a refused delete must leave the workspace: %d", rec.Code)
	}
	if rec := postJSON(e, http.MethodPost, url+"/stacks/full/stop", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("stop = %d", rec.Code)
	}

	if rec := do(e, http.MethodDelete, url); rec.Code != http.StatusNoContent {
		t.Fatalf("delete = %d (%s)", rec.Code, rec.Body)
	}
	if rec := do(e, http.MethodGet, url); rec.Code != http.StatusNotFound {
		t.Errorf("after delete GET = %d, want 404", rec.Code)
	}
	if rec := do(e, http.MethodDelete, url); rec.Code != http.StatusNotFound {
		t.Errorf("second delete = %d, want 404", rec.Code)
	}
}

func TestDeleteWorksWithoutASupervisor(t *testing.T) {
	e := workspaceServer(t)
	if rec := postJSON(e, http.MethodPost, "/api/v1/workspaces", createRequest{YAML: goodWorkspace}); rec.Code != http.StatusCreated {
		t.Fatalf("create = %d", rec.Code)
	}
	if rec := do(e, http.MethodDelete, "/api/v1/workspaces/demo"); rec.Code != http.StatusNoContent {
		t.Errorf("delete = %d (%s)", rec.Code, rec.Body)
	}
}
