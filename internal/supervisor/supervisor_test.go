package supervisor

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/events"
)

// fakeExe is the stand-in service from testdata/fakesvc, built once for all tests.
var fakeExe string

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "supervisor-test")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fakeExe = filepath.Join(dir, "fakesvc")
	if runtime.GOOS == "windows" {
		fakeExe += ".exe"
	}
	if out, err := exec.Command("go", "build", "-o", fakeExe, "./testdata/fakesvc").CombinedOutput(); err != nil { //nolint:gosec // fixed arguments
		fmt.Fprintf(os.Stderr, "build fakesvc: %v\n%s", err, out)
		os.Exit(1)
	}
	code := m.Run()
	_ = os.RemoveAll(dir)
	os.Exit(code)
}

func freePort(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().(*net.TCPAddr).Port
}

// fakeService describes a stand-in service made with fakesvc's flags.
func fakeService(t *testing.T, id string, args ...string) ServiceSpec {
	t.Helper()
	return ServiceSpec{
		ID: id, Kind: "command", Dir: t.TempDir(),
		Argv:         append([]string{fakeExe}, args...),
		Restart:      "on-failure",
		ReadyTimeout: 10 * time.Second,
	}
}

func stackOf(services ...ServiceSpec) StackSpec {
	return StackSpec{Workspace: "demo", Name: "full", Services: services}
}

func passes(context.Context, StackSpec) (doctor.Report, error) { return doctor.Report{}, nil }

// recorder is a fake Compose that remembers what it was asked and when.
type recorder struct {
	mu    sync.Mutex
	calls []string
	times map[string]time.Time
	fail  bool
}

func (c *recorder) run(_ context.Context, _ ComposeSpec, action string, out func(string)) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, action)
	if c.times == nil {
		c.times = map[string]time.Time{}
	}
	c.times[action] = time.Now()
	out("compose " + action)
	if c.fail && action == "up" {
		return errors.New("exit 1")
	}
	return nil
}

func newSup(t *testing.T, mutate ...func(*Options)) (*Supervisor, *events.Bus) {
	t.Helper()
	bus := events.NewBus()
	o := Options{
		Bus: bus, BinDir: t.TempDir(), Preflight: passes,
		Backoff:   func(int) time.Duration { return 20 * time.Millisecond },
		PollEvery: 20 * time.Millisecond, Settle: 100 * time.Millisecond, StopTimeout: 5 * time.Second,
		MaxRestarts: 2, StableAfter: time.Hour,
	}
	for _, m := range mutate {
		m(&o)
	}
	s := New(o)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		s.StopAll(ctx)
	})
	return s, bus
}

func start(t *testing.T, s *Supervisor, spec StackSpec) {
	t.Helper()
	if _, err := s.Start(t.Context(), spec); err != nil {
		t.Fatalf("start: %v", err)
	}
}

// waitFor polls until cond is true for the stack's status, or fails the test.
func waitFor(t *testing.T, s *Supervisor, what string, cond func(RunStatus) bool) RunStatus {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	var last RunStatus
	for time.Now().Before(deadline) {
		if st, ok := s.Status("demo", "full"); ok {
			last = st
			if cond(st) {
				return st
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s; last status: %+v", what, last)
	return last
}

func service(st RunStatus, id string) ServiceStatus {
	for _, sv := range st.Services {
		if sv.ID == id {
			return sv
		}
	}
	return ServiceStatus{}
}

func inState(id string, states ...State) func(RunStatus) bool {
	return func(st RunStatus) bool { return slices.Contains(states, service(st, id).State) }
}

func TestStartsInOrderAndWaitsForReady(t *testing.T) {
	s, _ := newSup(t)
	port := freePort(t)
	api := fakeService(t, "api", "-http", fmt.Sprintf("127.0.0.1:%d", port), "-ready-after", "400ms")
	api.Ready.HTTP = fmt.Sprintf("http://127.0.0.1:%d/health", port)
	web := fakeService(t, "web")
	web.After = []string{"api"}

	start(t, s, stackOf(web, api)) // listed in the "wrong" order on purpose

	st := waitFor(t, s, "everything running", func(st RunStatus) bool { return st.State == RunRunning })
	a, w := service(st, "api"), service(st, "web")
	if a.State != StateReady || w.State != StateReady || a.ReadyAt == nil || w.StartedAt == nil {
		t.Fatalf("status = %+v", st)
	}
	if w.StartedAt.Before(*a.ReadyAt) {
		t.Errorf("web started at %v, before api was ready at %v", w.StartedAt, a.ReadyAt)
	}
	if a.ReadyAt.Sub(*a.StartedAt) < 300*time.Millisecond {
		t.Errorf("api was called ready after %v, but it answers only after 400ms", a.ReadyAt.Sub(*a.StartedAt))
	}
}

func TestEveryKindOfReadinessCheck(t *testing.T) {
	s, _ := newSup(t)
	tcpPort, httpPort := freePort(t), freePort(t)

	tcp := fakeService(t, "tcp", "-tcp", fmt.Sprintf("127.0.0.1:%d", tcpPort), "-ready-after", "200ms")
	tcp.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", tcpPort)
	httpSvc := fakeService(t, "http", "-http", fmt.Sprintf("127.0.0.1:%d", httpPort), "-ready-after", "200ms")
	httpSvc.Ready.HTTP = fmt.Sprintf("http://127.0.0.1:%d/health", httpPort)
	logSvc := fakeService(t, "log", "-ready-after", "200ms", "-ready-line", "all set now")
	logSvc.Ready.Log = "all set"
	plain := fakeService(t, "plain")

	start(t, s, stackOf(tcp, httpSvc, logSvc, plain))
	waitFor(t, s, "all ready", func(st RunStatus) bool { return st.State == RunRunning })

	lines, ok := s.Lines("demo", "full", "log")
	if !ok || len(lines) != 1 || lines[0].Text != "all set now" || lines[0].Stream != "stdout" {
		t.Errorf("lines = %+v, %v", lines, ok)
	}
}

func TestNeverReadyFailsAndBlocksTheServicesAfterIt(t *testing.T) {
	s, _ := newSup(t)
	api := fakeService(t, "api", "-say", "starting up")
	api.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", freePort(t)) // nothing listens there
	api.ReadyTimeout = 1500 * time.Millisecond
	web := fakeService(t, "web")
	web.After = []string{"api"}
	other := fakeService(t, "other")

	start(t, s, stackOf(api, web, other))
	waitFor(t, s, "api failed", inState("api", StateFailed))
	waitFor(t, s, "web blocked", inState("web", StateBlocked))
	st, _ := s.Status("demo", "full")
	if got := service(st, "api").LastError; !strings.Contains(got, "wasn't ready after 1.5s") || !strings.Contains(got, "starting up") {
		t.Errorf("api error = %q", got)
	}
	if got := service(st, "web").LastError; !strings.Contains(got, "api failed") {
		t.Errorf("web error = %q", got)
	}
	if service(st, "other").State != StateReady || st.State != RunDegraded {
		t.Errorf("an unrelated service should keep running and the stack be degraded: %+v", st)
	}
}

func TestCrashShowsQuicklyThenRestartsThenGivesUp(t *testing.T) {
	s, _ := newSup(t)
	flaky := fakeService(t, "flaky", "-crash-after", "250ms")

	began := time.Now()
	start(t, s, stackOf(flaky))

	waitFor(t, s, "the crash to show", inState("flaky", StateRestarting))
	// 250ms until the crash, plus starting the program; the plan's target is under 2s after the crash.
	if took := time.Since(began); took > 4*time.Second {
		t.Errorf("the crash took %v to show", took)
	}

	st := waitFor(t, s, "giving up", inState("flaky", StateFailed))
	f := service(st, "flaky")
	if f.Restarts != 2 {
		t.Errorf("restarts = %d, want 2 (MaxRestarts)", f.Restarts)
	}
	if f.ExitCode == nil || *f.ExitCode != 3 {
		t.Errorf("exit code = %v, want 3", f.ExitCode)
	}
	if !strings.Contains(f.LastError, "crashed 3 times in a row") || !strings.Contains(f.LastError, "boom") {
		t.Errorf("error = %q", f.LastError)
	}
}

func TestRestartPolicies(t *testing.T) {
	s, _ := newSup(t)
	never := fakeService(t, "never", "-crash-after", "200ms")
	never.Restart = "never"
	clean := fakeService(t, "clean", "-exit-after", "300ms")   // exits 0 after it was ready
	early := fakeService(t, "early", "-exit-after", "10ms")    // exits 0 before it was ready
	always := fakeService(t, "always", "-exit-after", "250ms") // exits 0, but should come back
	always.Restart = "always"

	start(t, s, stackOf(never, clean, early, always))

	st := waitFor(t, s, "outcomes", func(st RunStatus) bool {
		return service(st, "never").State == StateFailed && service(st, "clean").State == StateStopped &&
			service(st, "early").State == StateFailed && service(st, "always").Restarts >= 1
	})
	if got := service(st, "never").LastError; !strings.Contains(got, "exited with code 3") {
		t.Errorf("never: %q", got)
	}
	if got := service(st, "early").LastError; !strings.Contains(got, "stopped before it was ready") {
		t.Errorf("early: %q", got)
	}
	if service(st, "clean").Restarts != 0 {
		t.Errorf("a clean exit must not be restarted: %+v", service(st, "clean"))
	}
}

func TestStopEndsEverythingDependentsFirst(t *testing.T) {
	s, bus := newSup(t)
	apiPort, webPort := freePort(t), freePort(t)
	api := fakeService(t, "api", "-tcp", fmt.Sprintf("127.0.0.1:%d", apiPort))
	api.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", apiPort)
	web := fakeService(t, "web", "-tcp", fmt.Sprintf("127.0.0.1:%d", webPort))
	web.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", webPort)
	web.After = []string{"api"}

	ch, cancel := bus.Subscribe("stacks.*", 1024)
	defer cancel()
	var mu sync.Mutex
	var seen []RunStatus
	go func() {
		for ev := range ch {
			mu.Lock()
			seen = append(seen, ev.Data.(RunStatus))
			mu.Unlock()
		}
	}()

	start(t, s, stackOf(api, web))
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })
	if !probeTCP(t.Context(), fmt.Sprintf("127.0.0.1:%d", webPort)) {
		t.Fatal("web should be listening")
	}

	if err := s.Stop(t.Context(), "demo", "full"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []int{apiPort, webPort} {
		if probeTCP(t.Context(), fmt.Sprintf("127.0.0.1:%d", p)) {
			t.Errorf("port %d is still open after stop: a process was left behind", p)
		}
	}
	if _, ok := s.Status("demo", "full"); ok {
		t.Error("a stopped stack should no longer be listed")
	}
	if err := s.Stop(t.Context(), "demo", "full"); !errors.Is(err, ErrNotRunning) {
		t.Errorf("second stop: %v", err)
	}

	time.Sleep(50 * time.Millisecond) // let the collector drain
	mu.Lock()
	defer mu.Unlock()
	firstStopped := func(id string) int {
		for i, st := range seen {
			if st.State == RunStopping && service(st, id).State == StateStopped {
				return i
			}
		}
		return -1
	}
	w, a := firstStopped("web"), firstStopped("api")
	if w < 0 || a < 0 || w >= a {
		t.Errorf("web must stop before api (web at event %d, api at event %d of %d)", w, a, len(seen))
	}
	if last := seen[len(seen)-1]; last.State != RunStopped {
		t.Errorf("last event = %s, want stopped", last.State)
	}
	if !slices.ContainsFunc(seen, func(st RunStatus) bool { return st.State == RunStarting }) ||
		!slices.ContainsFunc(seen, func(st RunStatus) bool { return st.State == RunRunning }) {
		t.Error("the bus should have seen starting and running")
	}
}

func TestStartTwiceAndPreflight(t *testing.T) {
	s, _ := newSup(t)
	spec := stackOf(fakeService(t, "a"))
	start(t, s, spec)
	if _, err := s.Start(t.Context(), spec); !errors.Is(err, ErrAlreadyRunning) {
		t.Errorf("second start: %v", err)
	}

	refusing, _ := newSup(t, func(o *Options) {
		o.Preflight = func(context.Context, StackSpec) (doctor.Report, error) {
			return doctor.Report{Failures: 2, Checks: []doctor.Check{{ID: "tool:go", Status: doctor.Fail}}}, nil
		}
	})
	_, err := refusing.Start(t.Context(), spec)
	var pre *PreflightError
	if !errors.As(err, &pre) || pre.Report.Failures != 2 || !strings.Contains(err.Error(), "2 problems") {
		t.Fatalf("err = %v", err)
	}
	if len(refusing.List()) != 0 {
		t.Error("nothing should have started")
	}

	broken, _ := newSup(t, func(o *Options) {
		o.Preflight = func(context.Context, StackSpec) (doctor.Report, error) { return doctor.Report{}, errors.New("boom") }
	})
	if _, err := broken.Start(t.Context(), spec); err == nil || errors.As(err, &pre) {
		t.Errorf("a failing check should be reported as itself: %v", err)
	}
}

func TestRestartOneService(t *testing.T) {
	s, _ := newSup(t)
	a := fakeService(t, "a", "-say", "hello")
	broken := fakeService(t, "broken", "-crash-after", "150ms")
	broken.Restart = "never"
	start(t, s, stackOf(a, broken))

	waitFor(t, s, "a ready and broken failed", func(st RunStatus) bool {
		return service(st, "a").State == StateReady && service(st, "broken").State == StateFailed
	})

	if err := s.RestartService("demo", "full", "a"); err != nil {
		t.Fatal(err)
	}
	st := waitFor(t, s, "a restarted", func(st RunStatus) bool {
		return service(st, "a").Restarts == 1 && service(st, "a").State == StateReady
	})
	if lines, _ := s.Lines("demo", "full", "a"); len(lines) != 2 {
		t.Errorf("a should have said hello twice: %+v", lines)
	}

	// a failed service can be retried by hand
	if err := s.RestartService("demo", "full", "broken"); err != nil {
		t.Fatal(err)
	}
	waitFor(t, s, "broken retried and failed again", func(st RunStatus) bool {
		b := service(st, "broken")
		return b.Restarts == 1 && b.State == StateFailed
	})
	_ = st

	if err := s.RestartService("demo", "full", "ghost"); !errors.Is(err, ErrNoSuchService) {
		t.Errorf("unknown service: %v", err)
	}
	if err := s.RestartService("demo", "nope", "a"); !errors.Is(err, ErrNotRunning) {
		t.Errorf("unknown stack: %v", err)
	}
}

func TestEnvFileAndEnvBlockReachTheProcess(t *testing.T) {
	s, _ := newSup(t)
	dir := t.TempDir()
	must(t, os.WriteFile(filepath.Join(dir, ".env"), []byte("TOKEN=abc123\nMODE=from-file\n"), 0o600))

	token := fakeService(t, "token", "-print-env", "TOKEN")
	token.Dir, token.EnvFile = dir, filepath.Join(dir, ".env")
	mode := fakeService(t, "mode", "-print-env", "MODE")
	mode.Dir, mode.EnvFile, mode.Env = dir, filepath.Join(dir, ".env"), map[string]string{"MODE": "from-block"}
	missing := fakeService(t, "missing")
	missing.EnvFile = filepath.Join(dir, "nope.env")

	start(t, s, stackOf(token, mode, missing))
	st := waitFor(t, s, "outcomes", func(st RunStatus) bool {
		return service(st, "token").State == StateReady && service(st, "mode").State == StateReady && service(st, "missing").State == StateFailed
	})

	got := func(id string) string {
		lines, _ := s.Lines("demo", "full", id)
		if len(lines) == 0 {
			return ""
		}
		return lines[0].Text
	}
	if got("token") != "ENV TOKEN=abc123" {
		t.Errorf("token = %q", got("token"))
	}
	if got("mode") != "ENV MODE=from-block" {
		t.Errorf("the env block should win over the env file: %q", got("mode"))
	}
	if e := service(st, "missing").LastError; !strings.Contains(e, "env file couldn't be read") {
		t.Errorf("error = %q", e)
	}
}

func TestComposeComesFirstAndGoesLast(t *testing.T) {
	rec := &recorder{}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })
	api := fakeService(t, "api")
	spec := stackOf(api)
	spec.Compose = &ComposeSpec{Dir: t.TempDir(), File: "docker-compose.yml", Services: []string{"db"}}

	start(t, s, spec)
	st := waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })
	if c := service(st, composeID); c.Kind != "compose" || c.State != StateReady {
		t.Errorf("compose = %+v", c)
	}
	rec.mu.Lock()
	upAt := rec.times["up"]
	rec.mu.Unlock()
	if started := service(st, "api").StartedAt; started == nil || started.Before(upAt) {
		t.Errorf("api started at %v, before compose up at %v", started, upAt)
	}

	if err := s.Stop(t.Context(), "demo", "full"); err != nil {
		t.Fatal(err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if !slices.Equal(rec.calls, []string{"up", "stop"}) {
		t.Errorf("compose calls = %v", rec.calls)
	}
}

func TestComposeFailureBlocksEverything(t *testing.T) {
	rec := &recorder{fail: true}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })
	spec := stackOf(fakeService(t, "api"))
	spec.Compose = &ComposeSpec{Dir: t.TempDir(), File: "x.yml"}

	start(t, s, spec)
	st := waitFor(t, s, "api blocked", inState("api", StateBlocked))
	if c := service(st, composeID); c.State != StateFailed || !strings.Contains(c.LastError, "Docker Compose couldn't start") {
		t.Errorf("compose = %+v", c)
	}
	if st.State != RunDegraded {
		t.Errorf("run = %s", st.State)
	}
}

func TestGoServicesAreBuiltThenRun(t *testing.T) {
	s, _ := newSup(t)
	ok := ServiceSpec{ID: "built", Kind: "go", Dir: "testdata", Package: "./fakesvc", Restart: "on-failure", ReadyTimeout: 20 * time.Second}
	broken := ServiceSpec{ID: "broken", Kind: "go", Dir: "testdata", Package: "./does-not-exist", Restart: "on-failure", ReadyTimeout: 20 * time.Second}
	dependent := fakeService(t, "dependent")
	dependent.After = []string{"broken"}

	start(t, s, stackOf(ok, broken, dependent))
	st := waitFor(t, s, "outcomes", func(st RunStatus) bool {
		return service(st, "built").State == StateReady && service(st, "broken").State == StateFailed
	})
	if e := service(st, "broken").LastError; !strings.Contains(e, "The build failed") {
		t.Errorf("broken: %q", e)
	}
	waitFor(t, s, "dependent blocked", inState("dependent", StateBlocked))

	entries, _ := os.ReadDir(s.o.BinDir)
	if len(entries) != 1 || !strings.HasPrefix(entries[0].Name(), "demo-full-built") {
		t.Errorf("bin folder = %v", entries)
	}
}

func TestListOwnPortsAndStopAll(t *testing.T) {
	s, _ := newSup(t)
	a := fakeService(t, "a")
	a.Port = 4321
	start(t, s, stackOf(a))
	other := stackOf(fakeService(t, "b"))
	other.Name = "other"
	start(t, s, other)

	list := s.List()
	if len(list) != 2 || list[0].Stack != "full" || list[1].Stack != "other" {
		t.Fatalf("list = %+v", list)
	}
	if p := s.OwnPorts("demo", "full"); !p[4321] || len(p) != 1 {
		t.Errorf("own ports = %v", p)
	}
	if p := s.OwnPorts("demo", "ghost"); p != nil {
		t.Errorf("own ports of an unknown stack = %v", p)
	}

	s.StopAll(t.Context())
	if len(s.List()) != 0 {
		t.Error("StopAll should leave nothing running")
	}
}
