package supervisor

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// failing is a fake Compose that fails "up" for the named files and records every call.
type failing struct {
	byFile
	fail map[string]bool
}

func (c *failing) run(ctx context.Context, spec ComposeSpec, action string, out func(string)) error {
	_ = c.byFile.run(ctx, spec, action, out)
	if action == "up" && c.fail[spec.File] {
		return errors.New("exit 1")
	}
	return nil
}

// namedSteps is: vault (compose, optional), then nats, then gateway (compose), then auth.
func namedSteps(t *testing.T) StackSpec {
	t.Helper()
	natsPort, authPort := freePort(t), freePort(t)
	nats := fakeService(t, "nats", "-tcp", fmt.Sprintf("127.0.0.1:%d", natsPort))
	nats.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", natsPort)
	nats.After = []string{"vault"}
	auth := fakeService(t, "auth", "-tcp", fmt.Sprintf("127.0.0.1:%d", authPort))
	auth.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", authPort)
	auth.After = []string{"gateway"}

	spec := stackOf(nats, auth)
	spec.Compose = []ComposeSpec{
		{ID: "vault", Dir: t.TempDir(), File: "vault.yml", Named: true, Optional: true},
		{ID: "gateway", Dir: t.TempDir(), File: "gateway.yml", Named: true, After: []string{"nats"}},
	}
	return spec
}

func TestNamedComposeFilesStartAndStopInTheOrderGiven(t *testing.T) {
	rec := &failing{}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })

	start(t, s, namedSteps(t))
	st := waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	// vault, then nats, then the gateway, then auth: each starts after the one before is ready
	rec.mu.Lock()
	vaultUp, gatewayUp := rec.times["up:vault.yml"], rec.times["up:gateway.yml"]
	rec.mu.Unlock()
	nats, auth := service(st, "nats"), service(st, "auth")
	if nats.StartedAt == nil || nats.StartedAt.Before(vaultUp) {
		t.Errorf("nats started at %v, before vault came up at %v", nats.StartedAt, vaultUp)
	}
	if gatewayUp.Before(*nats.ReadyAt) {
		t.Errorf("the gateway came up at %v, before nats was ready at %v", gatewayUp, nats.ReadyAt)
	}
	if auth.StartedAt == nil || auth.StartedAt.Before(gatewayUp) {
		t.Errorf("auth started at %v, before the gateway came up at %v", auth.StartedAt, gatewayUp)
	}

	if err := s.Stop(t.Context(), "demo", "full"); err != nil {
		t.Fatal(err)
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	var stops []string
	for _, c := range rec.calls {
		if strings.HasPrefix(c, "stop:") {
			stops = append(stops, c)
		}
	}
	if !slices.Equal(stops, []string{"stop:gateway.yml", "stop:vault.yml"}) {
		t.Errorf("stops = %v, want the gateway (which came later) first and vault last", stops)
	}
}

func TestAnOptionalComposeFileThatFailsDoesNotHoldAnythingBack(t *testing.T) {
	rec := &failing{fail: map[string]bool{"vault.yml": true}}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })

	start(t, s, namedSteps(t))
	st := waitFor(t, s, "everything else running", func(st RunStatus) bool {
		return service(st, "nats").State == StateReady && service(st, "auth").State == StateReady
	})

	if v := service(st, "vault"); v.State != StateFailed || !strings.Contains(v.LastError, "couldn't start") {
		t.Errorf("vault = %+v: its own row should say what happened", v)
	}
	if st.State != RunRunning {
		t.Errorf("run = %s: an optional failure must not turn the stack into \"needs attention\"", st.State)
	}
	said := false
	for _, l := range sinkOf(s).of("vault") {
		if strings.Contains(l.Text, "carrying on without it") {
			said = true
		}
	}
	if !said {
		t.Error("the logs should say that vault failed and the rest carried on")
	}
}

func TestAComposeFileThatIsNotOptionalBlocksWhatWaitsForIt(t *testing.T) {
	rec := &failing{fail: map[string]bool{"gateway.yml": true}}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })

	start(t, s, namedSteps(t))
	st := waitFor(t, s, "auth blocked", inState("auth", StateBlocked))
	if g := service(st, "gateway"); g.State != StateFailed {
		t.Errorf("gateway = %+v", g)
	}
	if service(st, "nats").State != StateReady {
		t.Errorf("nats comes before the gateway and should be fine: %+v", service(st, "nats"))
	}
	if st.State != RunDegraded {
		t.Errorf("run = %s", st.State)
	}
}

func TestPlanOrdersNamedComposeFiles(t *testing.T) {
	root := t.TempDir()
	w, stacks := planFixture()
	w.Repos = append(w.Repos, workspace.Repo{ID: "vault", Path: "vault"})
	stacks[0].Compose = workspace.Composes{
		{ID: "vault", Repo: "vault", File: "docker-compose.yml", Optional: true},
		{ID: "infra", Repo: "infra", File: "docker-compose.yml", After: []string{"vault"}},
	}
	stacks[0].Services[1].After = []string{"infra"} // api waits for the infra compose file

	spec, err := Plan("demo", root, w, stacks, "full")
	if err != nil {
		t.Fatal(err)
	}
	if !spec.Ordered() || spec.Compose[0].ID != "vault" || !spec.Compose[0].Optional || !spec.Compose[1].Named || spec.Compose[1].After[0] != "vault" {
		t.Errorf("compose = %+v", spec.Compose)
	}
	levels, err := spec.Levels()
	if err != nil || len(levels) != 4 || levels[0][0] != "vault" || levels[1][0] != "infra" {
		t.Errorf("levels = %v, %v", levels, err)
	}

	// a service that waits for something that isn't there, and a loop through a compose file
	stacks[0].Services[1].After = []string{"nowhere"}
	if _, err := Plan("demo", root, w, stacks, "full"); err == nil {
		t.Error("an unknown step must be refused")
	}
	stacks[0].Services[1].After = nil
	stacks[0].Compose[0].After = []string{"infra"}
	if _, err := Plan("demo", root, w, stacks, "full"); err == nil {
		t.Error("compose files waiting for each other must be refused")
	}
}

func TestStopAndStartOneService(t *testing.T) {
	s, _ := newSup(t)
	apiPort, webPort := freePort(t), freePort(t)
	api := fakeService(t, "api", "-tcp", fmt.Sprintf("127.0.0.1:%d", apiPort))
	api.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", apiPort)
	web := fakeService(t, "web", "-tcp", fmt.Sprintf("127.0.0.1:%d", webPort))
	web.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", webPort)
	start(t, s, stackOf(api, web))
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	if err := s.StopService(t.Context(), "demo", "full", "api"); err != nil {
		t.Fatal(err)
	}
	st, _ := s.Status("demo", "full")
	if service(st, "api").State != StateStopped || service(st, "web").State != StateReady {
		t.Errorf("only api should be stopped: %+v", st.Services)
	}
	if probeTCP(t.Context(), fmt.Sprintf("127.0.0.1:%d", apiPort)) {
		t.Error("the process of a stopped service must be gone")
	}
	time.Sleep(300 * time.Millisecond)
	if st, _ := s.Status("demo", "full"); service(st, "api").State != StateStopped {
		t.Errorf("a service stopped by hand must not come back by itself: %+v", service(st, "api"))
	}
	if err := s.StopService(t.Context(), "demo", "full", "api"); err != nil {
		t.Errorf("second stop: %v", err)
	}

	if err := s.StartService("demo", "full", "api"); err != nil {
		t.Fatal(err)
	}
	st = waitFor(t, s, "api back", inState("api", StateReady))
	if service(st, "api").Restarts != 1 {
		t.Errorf("starting it again counts as a restart: %+v", service(st, "api"))
	}
	if !probeTCP(t.Context(), fmt.Sprintf("127.0.0.1:%d", apiPort)) {
		t.Error("api should be listening again")
	}
	if err := s.StartService("demo", "full", "api"); err != nil {
		t.Errorf("start of a running service: %v", err)
	}

	for _, err := range []error{
		s.StopService(t.Context(), "demo", "full", "ghost"),
		s.StartService("demo", "full", "ghost"),
		s.StopService(t.Context(), "demo", "other", "api"),
		s.StartService("demo", "other", "api"),
	} {
		if !errors.Is(err, ErrNoSuchService) && !errors.Is(err, ErrNotRunning) {
			t.Errorf("unexpected error %v", err)
		}
	}

	// the whole stack can still be stopped, including the service that was started again by hand
	if err := s.Stop(t.Context(), "demo", "full"); err != nil {
		t.Fatal(err)
	}
	for _, p := range []int{apiPort, webPort} {
		if probeTCP(t.Context(), fmt.Sprintf("127.0.0.1:%d", p)) {
			t.Errorf("port %d is still open: a process was left behind", p)
		}
	}
}

func TestStopAndStartAComposeFile(t *testing.T) {
	rec := &byFile{}
	s, _ := newSup(t, func(o *Options) { o.Compose = rec.run })
	spec := stackOf(fakeService(t, "api"))
	spec.Compose = []ComposeSpec{{ID: composeID, Dir: t.TempDir(), File: "c.yml"}}
	start(t, s, spec)
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })

	if err := s.StopService(t.Context(), "demo", "full", composeID); err != nil {
		t.Fatal(err)
	}
	if st, _ := s.Status("demo", "full"); service(st, composeID).State != StateStopped {
		t.Errorf("compose = %+v", service(st, composeID))
	}
	if err := s.StartService("demo", "full", composeID); err != nil {
		t.Fatal(err)
	}
	waitFor(t, s, "compose up again", inState(composeID, StateReady))

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if !slices.Equal(rec.calls, []string{"up:c.yml", "stop:c.yml", "up:c.yml"}) {
		t.Errorf("compose calls = %v", rec.calls)
	}
}

func TestStopAndStartRefuseWhileTheStackIsStopping(t *testing.T) {
	s, _ := newSup(t)
	start(t, s, stackOf(fakeService(t, "api")))
	waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })
	r, _ := s.get("demo", "full")
	r.mu.Lock()
	r.phase = RunStopping
	r.mu.Unlock()
	if err := s.StopService(t.Context(), "demo", "full", "api"); !errors.Is(err, ErrNotRunning) {
		t.Errorf("stop while stopping: %v", err)
	}
	if err := s.StartService("demo", "full", "api"); !errors.Is(err, ErrNotRunning) {
		t.Errorf("start while stopping: %v", err)
	}
	r.mu.Lock()
	r.phase = ""
	r.mu.Unlock()
}

func TestComposeStepsShowTheirPublishedPorts(t *testing.T) {
	rec := &byFile{}
	s, _ := newSup(t, func(o *Options) {
		o.Compose = rec.run
		o.ComposePorts = func(_ context.Context, c ComposeSpec) []int {
			if c.ID == "vault" {
				return []int{8200}
			}
			return nil
		}
	})
	spec := stackOf(fakeService(t, "api"))
	spec.Compose = []ComposeSpec{
		{ID: "vault", Dir: t.TempDir(), File: "v.yml", Named: true},
		{ID: "quiet", Dir: t.TempDir(), File: "q.yml", Named: true},
	}
	start(t, s, spec)
	st := waitFor(t, s, "running", func(st RunStatus) bool { return st.State == RunRunning })
	if got := service(st, "vault").Ports; !slices.Equal(got, []int{8200}) {
		t.Errorf("vault ports = %v", got)
	}
	if got := service(st, "quiet").Ports; len(got) != 0 {
		t.Errorf("a file that publishes nothing shows no ports, got %v", got)
	}
}

func TestReadyLogIsMatchedWithoutColourCodes(t *testing.T) {
	s, _ := newSup(t)
	// Vite prints "Local" and the colon with a colour code between them.
	vite := fakeService(t, "vite", "-ready-after", "200ms", "-ready-line", "\x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   http://localhost:5173/")
	vite.Ready.Log = "Local:"
	start(t, s, stackOf(vite))
	waitFor(t, s, "ready from the log line", inState("vite", StateReady))
}

func TestLogParserReachesTheLogRules(t *testing.T) {
	spec := stackOf(fakeService(t, "api"), fakeService(t, "web"), fakeService(t, "plain"))
	spec.Services[0].Logs.Parser = "zerolog"
	spec.Services[1].Logs = logs.Rule{Store: "matching", Match: "ERROR", Parser: "vite-log"}
	spec.Compose = []ComposeSpec{{ID: "kc", File: "k.yml", Logs: map[string]logs.Rule{"keycloak": {Store: "off"}}}}
	got := spec.LogRules()
	if got["api"].Parser != "zerolog" || got["web"].Parser != "vite-log" || got["web"].Store != "matching" || got["kc/keycloak"].Store != "off" {
		t.Errorf("rules = %+v", got)
	}
	if _, ok := got["plain"]; ok {
		t.Error("a service with no rule and no parser needs no entry")
	}
}

func TestPlanTakesLogParserFromTheStackFile(t *testing.T) {
	w, stacks := planFixture()
	stacks[0].Services[0].LogParser = "zerolog"
	stacks[0].Services[1].LogParser = "plain"
	stacks[0].Services[1].Logs = &logs.Rule{Store: "all", Parser: "vite-log"} // the rule's own parser wins
	spec, err := Plan("demo", t.TempDir(), w, stacks, "full")
	if err != nil {
		t.Fatal(err)
	}
	if got := spec.LogRules(); got[spec.Services[0].ID].Parser != "zerolog" || got[spec.Services[1].ID].Parser != "vite-log" {
		t.Errorf("rules = %+v", got)
	}
}
