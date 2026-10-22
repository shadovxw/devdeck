package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// fake is a stand-in for the devdeck server. runs is the list of answers to
// GET /runs, one per call; the last one repeats.
type fake struct {
	mu         sync.Mutex
	workspaces []workspace.Summary
	runs       [][]supervisor.RunStatus
	calls      int
	startCode  int
	startBody  any
	stopCode   int
	started    []string
	stopped    []string
}

func (f *fake) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/workspaces", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, f.workspaces)
	})
	mux.HandleFunc("GET /api/v1/runs", func(w http.ResponseWriter, _ *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		i := min(f.calls, len(f.runs)-1)
		f.calls++
		if len(f.runs) == 0 {
			writeJSON(w, http.StatusOK, []supervisor.RunStatus{})
			return
		}
		writeJSON(w, http.StatusOK, f.runs[i])
	})
	mux.HandleFunc("POST /api/v1/workspaces/{id}/stacks/{stack}/start", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.started = append(f.started, r.PathValue("id")+"/"+r.PathValue("stack"))
		f.mu.Unlock()
		code := f.startCode
		if code == 0 {
			code = http.StatusAccepted
		}
		writeJSON(w, code, f.startBody)
	})
	mux.HandleFunc("POST /api/v1/workspaces/{id}/stacks/{stack}/stop", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.stopped = append(f.stopped, r.PathValue("id")+"/"+r.PathValue("stack"))
		f.mu.Unlock()
		if f.stopCode == http.StatusNotFound {
			writeJSON(w, http.StatusNotFound, map[string]string{"message": "that stack is not running"})
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// run starts the fake server, runs one command against it and returns what it
// printed.
func run(t *testing.T, f *fake, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	srv := httptest.NewServer(f.handler())
	t.Cleanup(srv.Close)
	return runAt(t, strings.TrimPrefix(srv.URL, "http://"), args...)
}

func runAt(t *testing.T, addr string, args ...string) (code int, stdout, stderr string) {
	t.Helper()
	var out, errOut bytes.Buffer
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	code = Run(ctx, args, Env{
		Getenv: func(k string) string {
			if k == "DEVDECK_ADDR" {
				return addr
			}
			return ""
		},
		Stdout: &out,
		Stderr: &errOut,
		Poll:   time.Millisecond,
		Now:    func() time.Time { return time.Date(2026, 10, 19, 12, 5, 0, 0, time.UTC) },
	})
	return code, out.String(), errOut.String()
}

func svc(id string, state supervisor.State) supervisor.ServiceStatus {
	return supervisor.ServiceStatus{ID: id, Kind: "go", State: state}
}

func stack(state supervisor.RunState, services ...supervisor.ServiceStatus) []supervisor.RunStatus {
	return []supervisor.RunStatus{{
		Workspace: "demo", Stack: "full", State: state,
		StartedAt: time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC),
		Services:  services,
	}}
}

var oneWorkspace = []workspace.Summary{
	{ID: "acme", Source: workspace.SourceExample},
	{ID: "demo", Source: workspace.SourceLocal},
}

func TestUp(t *testing.T) {
	failed := svc("web", supervisor.StateFailed)
	failed.LastError = "npm is not installed"
	ready := svc("api", supervisor.StateReady)
	ready.Port = 8080

	tests := []struct {
		name      string
		args      []string
		fake      *fake
		wantCode  int
		wantOut   []string
		wantErr   []string
		wantStart []string
	}{
		{
			name: "reaches running",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
				stack(supervisor.RunStarting, svc("api", supervisor.StateStarting), svc("web", supervisor.StateWaiting)),
				stack(supervisor.RunRunning, ready, svc("web", supervisor.StateReady)),
			}},
			wantCode:  exitOK,
			wantOut:   []string{"starting demo/full", "api            starting", "api            ready  :8080", "web            waiting", "demo/full is running"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "flags may come after the stack",
			args: []string{"up", "full", "-w", "other"},
			fake: &fake{runs: [][]supervisor.RunStatus{{{Workspace: "other", Stack: "full", State: supervisor.RunRunning,
				Services: []supervisor.ServiceStatus{svc("api", supervisor.StateReady)}}}}},
			wantCode:  exitOK,
			wantOut:   []string{"other/full is running"},
			wantStart: []string{"other/full"},
		},
		{
			name: "a failed service fails the command",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
				stack(supervisor.RunDegraded, ready, failed, svc("proxy", supervisor.StateBlocked)),
			}},
			wantCode:  exitFail,
			wantOut:   []string{"web            failed  npm is not installed"},
			wantErr:   []string{"demo/full didn't start: web, proxy"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "a restarting service is waited for",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
				stack(supervisor.RunDegraded, svc("api", supervisor.StateRestarting)),
				stack(supervisor.RunRunning, svc("api", supervisor.StateReady)),
			}},
			wantCode:  exitOK,
			wantOut:   []string{"api            restarting", "demo/full is running"},
			wantStart: []string{"demo/full"},
		},
		{
			name:      "detach returns at once",
			args:      []string{"up", "full", "--detach"},
			fake:      &fake{workspaces: oneWorkspace},
			wantCode:  exitOK,
			wantOut:   []string{"starting demo/full"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "already running is followed, not an error",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, startCode: http.StatusConflict,
				startBody: map[string]string{"message": "already running"},
				runs:      [][]supervisor.RunStatus{stack(supervisor.RunRunning, svc("api", supervisor.StateReady))}},
			wantCode:  exitOK,
			wantOut:   []string{"demo/full is already running", "demo/full is running"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "machine not ready prints the failed checks",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, startCode: http.StatusUnprocessableEntity,
				startBody: map[string]any{"message": "the machine isn't ready for this stack", "report": doctor.Report{
					Checks: []doctor.Check{
						{Title: "Go", Status: doctor.OK},
						{Title: "Docker", Status: doctor.Fail, Detail: "the engine isn't answering", Fix: []string{"start Docker Desktop"}},
					},
					Failures: 1,
				}}},
			wantCode:  exitFail,
			wantErr:   []string{"the machine isn't ready for this stack", "x Docker: the engine isn't answering", "start Docker Desktop"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "the server's refusal is shown in its own words",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, startCode: http.StatusForbidden,
				startBody: map[string]string{"message": "sample workspaces can't be started"}},
			wantCode:  exitFail,
			wantErr:   []string{"sample workspaces can't be started"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "the stack stopping meanwhile ends the wait",
			args: []string{"up", "full"},
			fake: &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
				stack(supervisor.RunStopped, svc("api", supervisor.StateStopped)),
			}},
			wantCode:  exitFail,
			wantErr:   []string{"was stopped before it was ready"},
			wantStart: []string{"demo/full"},
		},
		{
			name: "several workspaces need -w",
			args: []string{"up", "full"},
			fake: &fake{workspaces: []workspace.Summary{
				{ID: "demo", Source: workspace.SourceLocal}, {ID: "second", Source: workspace.SourceLocal},
			}},
			wantCode: exitUsage,
			wantErr:  []string{"pick one with -w: demo, second"},
		},
		{
			name:     "no workspace",
			args:     []string{"up", "full"},
			fake:     &fake{workspaces: []workspace.Summary{{ID: "acme", Source: workspace.SourceExample}}},
			wantCode: exitFail,
			wantErr:  []string{"no workspace yet"},
		},
		{
			name:     "missing stack name",
			args:     []string{"up"},
			wantCode: exitUsage,
			wantErr:  []string{"needs exactly one stack name"},
		},
		{
			name:     "two stack names",
			args:     []string{"up", "a", "b"},
			wantCode: exitUsage,
			wantErr:  []string{"needs exactly one stack name"},
		},
		{
			name:     "unknown flag",
			args:     []string{"up", "full", "--nope"},
			wantCode: exitUsage,
			wantErr:  []string{"flag provided but not defined"},
		},
	}
	for _, tc := range tests {
		if tc.fake == nil {
			tc.fake = &fake{}
		}
		t.Run(tc.name, func(t *testing.T) {
			code, out, errOut := run(t, tc.fake, tc.args...)
			if code != tc.wantCode {
				t.Errorf("exit code = %d, want %d\nstdout:\n%s\nstderr:\n%s", code, tc.wantCode, out, errOut)
			}
			for _, w := range tc.wantOut {
				if !strings.Contains(out, w) {
					t.Errorf("stdout lacks %q:\n%s", w, out)
				}
			}
			for _, w := range tc.wantErr {
				if !strings.Contains(errOut, w) {
					t.Errorf("stderr lacks %q:\n%s", w, errOut)
				}
			}
			if strings.Join(tc.fake.started, ",") != strings.Join(tc.wantStart, ",") {
				t.Errorf("started %v, want %v", tc.fake.started, tc.wantStart)
			}
		})
	}
}

func TestUpPrintsEachChangeOnce(t *testing.T) {
	f := &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
		stack(supervisor.RunStarting, svc("api", supervisor.StateStarting)),
		stack(supervisor.RunStarting, svc("api", supervisor.StateStarting)),
		stack(supervisor.RunStarting, svc("api", supervisor.StateStarting)),
		stack(supervisor.RunRunning, svc("api", supervisor.StateReady)),
	}}
	_, out, _ := run(t, f, "up", "full")
	if n := strings.Count(out, "api            starting\n"); n != 1 {
		t.Errorf("the starting line was printed %d times, want 1:\n%s", n, out)
	}
}

func TestUpInterrupted(t *testing.T) {
	f := &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
		stack(supervisor.RunStarting, svc("api", supervisor.StateStarting)),
	}}
	srv := httptest.NewServer(f.handler())
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	var out, errOut bytes.Buffer
	go func() {
		time.Sleep(20 * time.Millisecond)
		cancel()
	}()
	code := Run(ctx, []string{"up", "full"}, Env{
		Getenv: func(string) string { return strings.TrimPrefix(srv.URL, "http://") },
		Stdout: &out, Stderr: &errOut, Poll: time.Millisecond,
	})
	if code != exitStop {
		t.Errorf("exit code = %d, want %d\nstderr: %s", code, exitStop, errOut.String())
	}
	if !strings.Contains(out.String(), "devdeck down full") {
		t.Errorf("interrupt didn't say how to stop the stack:\n%s", out.String())
	}
}

func TestDown(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		fake     *fake
		wantCode int
		wantOut  string
		wantErr  string
		want     []string
	}{
		{name: "stops", args: []string{"down", "full"}, fake: &fake{workspaces: oneWorkspace},
			wantCode: exitOK, wantOut: "demo/full is stopped", want: []string{"demo/full"}},
		{name: "explicit workspace", args: []string{"down", "-w", "x", "full"}, fake: &fake{},
			wantCode: exitOK, wantOut: "x/full is stopped", want: []string{"x/full"}},
		{name: "not running", args: []string{"down", "full"}, fake: &fake{workspaces: oneWorkspace, stopCode: http.StatusNotFound},
			wantCode: exitFail, wantErr: "demo/full isn't running", want: []string{"demo/full"}},
		{name: "needs a stack", args: []string{"down"}, wantCode: exitUsage, wantErr: "needs exactly one stack name"},
	}
	for _, tc := range tests {
		if tc.fake == nil {
			tc.fake = &fake{}
		}
		t.Run(tc.name, func(t *testing.T) {
			code, out, errOut := run(t, tc.fake, tc.args...)
			if code != tc.wantCode {
				t.Errorf("exit code = %d, want %d\n%s\n%s", code, tc.wantCode, out, errOut)
			}
			if !strings.Contains(out, tc.wantOut) || !strings.Contains(errOut, tc.wantErr) {
				t.Errorf("stdout %q, stderr %q: want %q and %q", out, errOut, tc.wantOut, tc.wantErr)
			}
			if strings.Join(tc.fake.stopped, ",") != strings.Join(tc.want, ",") {
				t.Errorf("stopped %v, want %v", tc.fake.stopped, tc.want)
			}
		})
	}
}

func TestStatus(t *testing.T) {
	api := svc("api", supervisor.StateReady)
	api.Port = 8080
	web := svc("web", supervisor.StateRestarting)
	web.Restarts = 2
	web.LastError = "exited with code 1\nsecond line"

	tests := []struct {
		name     string
		args     []string
		fake     *fake
		wantCode int
		wantOut  []string
		wantErr  string
	}{
		{name: "nothing running", args: []string{"status"}, fake: &fake{}, wantCode: exitOK, wantOut: []string{"no stacks are running"}},
		{
			name: "one stack", args: []string{"status"},
			fake:     &fake{runs: [][]supervisor.RunStatus{stack(supervisor.RunDegraded, api, web)}},
			wantCode: exitOK,
			wantOut: []string{
				"demo/full  degraded  up 5m00s",
				"  api            ready  :8080",
				"  web            restarting  restarts 2  exited with code 1 second line",
			},
		},
		{name: "takes no arguments", args: []string{"status", "full"}, wantCode: exitUsage, wantErr: "takes no arguments"},
	}
	for _, tc := range tests {
		if tc.fake == nil {
			tc.fake = &fake{}
		}
		t.Run(tc.name, func(t *testing.T) {
			code, out, errOut := run(t, tc.fake, tc.args...)
			if code != tc.wantCode {
				t.Errorf("exit code = %d, want %d\n%s\n%s", code, tc.wantCode, out, errOut)
			}
			for _, w := range tc.wantOut {
				if !strings.Contains(out, w) {
					t.Errorf("stdout lacks %q:\n%s", w, out)
				}
			}
			if !strings.Contains(errOut, tc.wantErr) {
				t.Errorf("stderr lacks %q:\n%s", tc.wantErr, errOut)
			}
		})
	}
}

func TestServerNotRunning(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	addr := strings.TrimPrefix(srv.URL, "http://")
	srv.Close() // nothing listens there any more

	for _, args := range [][]string{{"status"}, {"up", "full", "-w", "demo"}, {"down", "full", "-w", "demo"}} {
		code, _, errOut := runAt(t, addr, args...)
		if code != exitFail || !strings.Contains(errOut, "devdeck isn't running at http://"+addr) || !strings.Contains(errOut, "start it first") {
			t.Errorf("%v: exit %d, stderr %q", args, code, errOut)
		}
	}
}

func TestOddAnswers(t *testing.T) {
	tests := []struct {
		name    string
		handler http.HandlerFunc
		wantErr string
	}{
		{"not json", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("<html>")) }, "can't be read"},
		{"error without a message", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }, "devdeck answered 502 Bad Gateway"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			code, _, errOut := runAt(t, strings.TrimPrefix(srv.URL, "http://"), "status")
			if code != exitFail || !strings.Contains(errOut, tc.wantErr) {
				t.Errorf("exit %d, stderr %q, want %q", code, errOut, tc.wantErr)
			}
		})
	}
}

func TestRunBasics(t *testing.T) {
	tests := []struct {
		name     string
		args     []string
		addr     string
		wantCode int
		wantOut  string
		wantErr  string
	}{
		{"no arguments prints help", nil, "", exitOK, "devdeck up <stack>", ""},
		{"help", []string{"help"}, "", exitOK, "devdeck status", ""},
		{"--help", []string{"--help"}, "", exitOK, "devdeck down", ""},
		{"unknown command", []string{"explode"}, "", exitUsage, "", `unknown command "explode"`},
		{"address must be loopback", []string{"status"}, "0.0.0.0:7070", exitUsage, "", "loopback"},
		{"-h on a command", []string{"up", "-h"}, "", exitOK, "", "Usage:"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			code, out, errOut := runAt(t, tc.addr, tc.args...)
			if code != tc.wantCode || !strings.Contains(out, tc.wantOut) || !strings.Contains(errOut, tc.wantErr) {
				t.Errorf("exit %d, stdout %q, stderr %q", code, out, errOut)
			}
		})
	}
}

func TestFormatUptime(t *testing.T) {
	tests := []struct {
		d    time.Duration
		want string
	}{
		{-time.Second, "0s"},
		{0, "0s"},
		{42 * time.Second, "42s"},
		{5 * time.Minute, "5m00s"},
		{61*time.Minute + 5*time.Second, "1h01m"},
	}
	for _, tc := range tests {
		if got := formatUptime(tc.d); got != tc.want {
			t.Errorf("formatUptime(%v) = %q, want %q", tc.d, got, tc.want)
		}
	}
}

func TestOneLine(t *testing.T) {
	long := strings.Repeat("é", 300)
	if got := oneLine(long); len([]rune(got)) != 161 || !strings.HasSuffix(got, "…") {
		t.Errorf("long text came out as %d runes", len([]rune(got)))
	}
	if got := oneLine(" a\n\tb  c "); got != "a b c" {
		t.Errorf("oneLine = %q", got)
	}
	if got := oneLine("\x1b[2m\x1b[32m➜\x1b[39m  Local: ready"); got != "➜ Local: ready" {
		t.Errorf("colour codes left in: %q", got)
	}
}

func TestUpTreatsAnOptionalFailureAsNotFatal(t *testing.T) {
	vault := svc("vault", supervisor.StateFailed)
	vault.Optional = true
	vault.LastError = "docker couldn't start it"
	f := &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{
		stack(supervisor.RunRunning, vault, svc("api", supervisor.StateReady)),
	}}
	code, out, errOut := run(t, f, "up", "full")
	if code != exitOK || !strings.Contains(out, "demo/full is running") {
		t.Fatalf("exit %d\nstdout:\n%s\nstderr:\n%s", code, out, errOut)
	}
	if !strings.Contains(errOut, "optional and didn't start: vault") {
		t.Errorf("an optional failure should still be mentioned: %q", errOut)
	}
	if !strings.Contains(out, "docker couldn't start it") {
		t.Errorf("its reason is shown with its row: %q", out)
	}

	// a required one failing next to it still fails the command
	api := svc("api", supervisor.StateFailed)
	f = &fake{workspaces: oneWorkspace, runs: [][]supervisor.RunStatus{stack(supervisor.RunDegraded, vault, api)}}
	if code, _, errOut := run(t, f, "up", "full"); code != exitFail || !strings.Contains(errOut, "didn't start: api") {
		t.Errorf("exit %d, stderr %q", code, errOut)
	}
}
