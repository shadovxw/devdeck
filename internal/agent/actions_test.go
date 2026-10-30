package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

const appsCompose = "compose -f compose.apps.yml --env-file .env --env-file versions.env "

// actionLines reads the stream a write answered with, without the heartbeats.
func actionLines(t *testing.T, body string) []ActionLine {
	t.Helper()
	var out []ActionLine
	sc := bufio.NewScanner(strings.NewReader(body))
	for sc.Scan() {
		var l ActionLine
		if err := json.Unmarshal(sc.Bytes(), &l); err != nil {
			t.Fatalf("not a JSON line: %q", sc.Text())
		}
		if !l.Heartbeat {
			out = append(out, l)
		}
	}
	return out
}

func post(h http.Handler, target string) *httptest.ResponseRecorder {
	return request(h, http.MethodPost, target, testToken)
}

func newWriteFake() *fakeRunner {
	return &fakeRunner{outputs: map[string]string{"config --services": "api\nworker\n"}}
}

func TestServiceActions(t *testing.T) {
	for _, action := range serviceActions {
		f := newWriteFake()
		f.execLines = []string{"Container acme-api  Working"}
		_, h := newTestAgent(f)

		rec := post(h, "/v1/stacks/apps/services/api/"+action)
		if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/x-ndjson" {
			t.Fatalf("%s = %d %s", action, rec.Code, rec.Body)
		}
		got := actionLines(t, rec.Body.String())
		if len(got) != 2 || got[0].Line != "Container acme-api  Working" || !got[1].Done || !got[1].OK || got[1].Error != "" {
			t.Errorf("%s: lines = %+v (the output, then how it ended)", action, got)
		}
		calls := f.execCalls()
		if len(calls) != 1 || calls[0].dir != "/srv/acme" || calls[0].program != "" || strings.Join(calls[0].args, " ") != appsCompose+action+" api" {
			t.Errorf("%s: ran %+v", action, calls)
		}
	}
}

func TestStackActions(t *testing.T) {
	for target, tc := range map[string]struct {
		args    string
		program string
	}{
		"/v1/stacks/apps/up":             {args: appsCompose + "up -d"},
		"/v1/stacks/apps/pull":           {args: appsCompose + "pull"},
		"/v1/stacks/apps/down":           {args: appsCompose + "stop"},
		"/v1/stacks/apps/down?mode=stop": {args: appsCompose + "stop"},
		"/v1/stacks/apps/down?mode=down": {args: appsCompose + "down"},
		"/v1/stacks/apps/script":         {program: filepath.Join("/srv/acme", "./dev-up.sh")},
	} {
		f := newWriteFake()
		_, h := newTestAgent(f)
		rec := post(h, target)
		got := actionLines(t, rec.Body.String())
		if rec.Code != http.StatusOK || len(got) != 1 || !got[0].Done || !got[0].OK {
			t.Errorf("%s = %d %s", target, rec.Code, rec.Body)
			continue
		}
		calls := f.execCalls()
		if len(calls) != 1 || strings.Join(calls[0].args, " ") != tc.args || calls[0].program != tc.program || calls[0].dir != "/srv/acme" {
			t.Errorf("%s: ran %+v, want %q (program %q)", target, calls, tc.args, tc.program)
		}
		if slices.Contains(calls[0].args, "-v") || slices.Contains(calls[0].args, "--volumes") {
			t.Errorf("%s: volumes must never be removed: %v", target, calls[0].args)
		}
	}
}

func TestWritesAreRefused(t *testing.T) {
	f := newWriteFake()
	_, h := newTestAgent(f)
	for target, want := range map[string]int{
		"/v1/stacks/infra/up":                   http.StatusForbidden, // allow_write is off
		"/v1/stacks/infra/services/api/restart": http.StatusForbidden,
		"/v1/stacks/nope/up":                    http.StatusNotFound,
		"/v1/stacks/nope/services/api/restart":  http.StatusNotFound,
		"/v1/stacks/apps/nuke":                  http.StatusNotFound, // not in the list of actions
		"/v1/stacks/apps/services/api/exec":     http.StatusNotFound,
		"/v1/stacks/apps/services/db/restart":   http.StatusNotFound, // compose has no such service
		"/v1/stacks/apps/down?mode=wipe":        http.StatusBadRequest,
	} {
		if rec := post(h, target); rec.Code != want {
			t.Errorf("%s = %d, want %d (%s)", target, rec.Code, want, rec.Body)
		}
	}
	if rec := request(h, http.MethodPost, "/v1/stacks/apps/up", ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no token = %d", rec.Code)
	}
	if rec := request(h, http.MethodGet, "/v1/stacks/apps/up", testToken); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET on a write = %d", rec.Code)
	}
	if len(f.execCalls()) != 0 {
		t.Errorf("a refused write must not run anything: %+v", f.execCalls())
	}
}

func TestScriptNeedsAConfiguredScript(t *testing.T) {
	cfg := sampleConfig()
	cfg.Stacks[0].AllowWrite = true // infra can be written, but has no up script
	f := newWriteFake()
	h := New(cfg, []byte(testToken), f, zerolog.Nop(), "1").Handler()
	if rec := post(h, "/v1/stacks/infra/script"); rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "no up script") {
		t.Errorf("script without up_script = %d %s", rec.Code, rec.Body)
	}
	if len(f.execCalls()) != 0 {
		t.Error("nothing may run")
	}
}

func TestAFailedWriteIsReportedAtTheEnd(t *testing.T) {
	f := newWriteFake()
	f.execLines = []string{"pulling"}
	f.execErr = errors.New("docker ended with code 1: no such image")
	_, h := newTestAgent(f)
	rec := post(h, "/v1/stacks/apps/pull")
	got := actionLines(t, rec.Body.String())
	if rec.Code != http.StatusOK || len(got) != 2 || got[1].OK || !got[1].Done || got[1].Error != "docker ended with code 1: no such image" {
		t.Errorf("failure = %d %+v (the stream began, so the end says it failed)", rec.Code, got)
	}

	f.execErr = context.DeadlineExceeded
	rec = post(h, "/v1/stacks/apps/up")
	got = actionLines(t, rec.Body.String())
	if len(got) == 0 || !strings.Contains(got[len(got)-1].Error, "stopped after 15m0s") {
		t.Errorf("a write that ran too long: %+v", got)
	}
}

func TestOneWriteAtATimePerStack(t *testing.T) {
	f := newWriteFake()
	f.execGate = make(chan struct{})
	f.execBegan = make(chan struct{}, 4)
	_, h := newTestAgent(f)

	first := make(chan *httptest.ResponseRecorder, 1)
	go func() { first <- post(h, "/v1/stacks/apps/services/api/restart") }()
	<-f.execBegan

	rec := post(h, "/v1/stacks/apps/services/worker/stop")
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "busy: restart api") {
		t.Errorf("a second write = %d %s", rec.Code, rec.Body)
	}
	close(f.execGate)
	if r := <-first; r.Code != http.StatusOK {
		t.Errorf("the first write = %d", r.Code)
	}
	if rec := post(h, "/v1/stacks/apps/services/worker/stop"); rec.Code != http.StatusOK {
		t.Errorf("once the stack is free = %d %s", rec.Code, rec.Body)
	}
	if n := len(f.execCalls()); n != 2 {
		t.Errorf("%d commands ran, want 2 (the refused one never started)", n)
	}
}

func TestAWriteOutlivesItsRequest(t *testing.T) {
	f := newWriteFake()
	_, h := newTestAgent(f)
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // the tunnel dropped
	req := httptest.NewRequestWithContext(ctx, http.MethodPost, "http://127.0.0.1:7071/v1/stacks/apps/up", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	h.ServeHTTP(httptest.NewRecorder(), req)
	calls := f.execCalls()
	if len(calls) != 1 || calls[0].ctxErr != nil {
		t.Errorf("calls = %+v: a dropped client must not stop an up half way", calls)
	}
}

func TestALongWriteKeepsTheTunnelBusy(t *testing.T) {
	f := newWriteFake()
	f.execGate = make(chan struct{})
	a, h := newTestAgent(f)
	a.heartbeat = 10 * time.Millisecond
	srv := httptest.NewServer(h)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/v1/stacks/apps/pull", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	sc := bufio.NewScanner(res.Body)
	for range 2 { // one as it begins, one while it waits
		var l ActionLine
		if !sc.Scan() || json.Unmarshal(sc.Bytes(), &l) != nil || !l.Heartbeat {
			t.Fatalf("expected a heartbeat, got %q", sc.Text())
		}
	}
	close(f.execGate)
	var last ActionLine
	for sc.Scan() {
		_ = json.Unmarshal(sc.Bytes(), &last)
	}
	if !last.Done || !last.OK {
		t.Errorf("last line = %+v", last)
	}
}

func TestEveryWriteIsAudited(t *testing.T) {
	var buf bytes.Buffer
	f := newWriteFake()
	a := New(sampleConfig(), []byte(testToken), f, zerolog.New(&buf), "1")
	h := a.Handler()
	post(h, "/v1/stacks/apps/services/api/restart")
	f.execErr = errors.New("docker ended with code 1: boom")
	post(h, "/v1/stacks/apps/up")

	var writes []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("log line %q: %v", line, err)
		}
		if m["message"] == "write" {
			writes = append(writes, m)
		}
	}
	if len(writes) != 2 || writes[0]["stack"] != "apps" || writes[0]["action"] != "restart" || writes[0]["service"] != "api" || writes[0]["level"] != "info" ||
		writes[1]["action"] != "up" || writes[1]["level"] != "warn" || writes[1]["error"] != "docker ended with code 1: boom" {
		t.Errorf("audit lines = %v", writes)
	}
	if strings.Contains(buf.String(), testToken) || strings.Contains(buf.String(), "versions.env") {
		t.Errorf("the log gives away the token or the files: %s", buf.String())
	}
}

// TestHelperProcess is the program DockerRunner.Exec runs in the test below.
func TestHelperProcess(t *testing.T) {
	if os.Getenv("DEVDECK_TEST_HELPER") != "1" {
		return
	}
	_, _ = fmt.Fprintln(os.Stdout, "to stdout")
	_, _ = fmt.Fprintln(os.Stderr, "progress on stderr")
	if code, _ := strconv.Atoi(os.Getenv("DEVDECK_TEST_EXIT")); code != 0 {
		_, _ = fmt.Fprintln(os.Stderr, "boom")
		os.Exit(code)
	}
	os.Exit(0)
}

func TestDockerRunnerExec(t *testing.T) {
	t.Setenv("DEVDECK_TEST_HELPER", "1")
	helper := []string{"-test.run=^TestHelperProcess$"}
	dir := t.TempDir()

	for name, run := range map[string]func(func(string)) error{
		"docker": func(line func(string)) error {
			return DockerRunner{Docker: os.Args[0]}.Exec(context.Background(), dir, "", helper, line)
		},
		"a script": func(line func(string)) error {
			return DockerRunner{}.Exec(context.Background(), dir, os.Args[0], helper, line)
		},
	} {
		var mu sync.Mutex // stdout and stderr are read at the same time
		var lines []string
		if err := run(func(l string) { mu.Lock(); lines = append(lines, l); mu.Unlock() }); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		slices.Sort(lines)
		if !slices.Equal(lines, []string{"progress on stderr", "to stdout"}) {
			t.Errorf("%s: lines = %q (both streams)", name, lines)
		}
	}

	t.Setenv("DEVDECK_TEST_EXIT", "3")
	err := DockerRunner{Docker: os.Args[0]}.Exec(context.Background(), dir, "", helper, func(string) {})
	if err == nil || !strings.Contains(err.Error(), "ended with code 3") || !strings.Contains(err.Error(), "boom") {
		t.Errorf("a failing command: %v", err)
	}
	if err := (DockerRunner{Docker: filepath.Join(dir, "missing")}).Exec(context.Background(), dir, "", nil, func(string) {}); err == nil {
		t.Error("a program that can't start")
	}
}
