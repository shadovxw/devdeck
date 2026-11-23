package supervisor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// Errors the caller can tell apart.
var (
	ErrAlreadyRunning = errors.New("that stack is already running")
	ErrNotRunning     = errors.New("that stack isn't running")
	ErrNoSuchService  = errors.New("that service isn't in the stack")
)

// LogSink takes the output of the services a supervisor runs (internal/logs.Sink
// is the real one). Line must not block: a service's pipe waits for it.
type LogSink interface {
	// Line is one raw output line. stream is stdout, stderr, build or compose.
	Line(workspace, stack, service, stream, text string, at time.Time)
	// Env is the extra environment a service was (re)started with, so values of its
	// secret-named variables can be masked in its output.
	Env(workspace, stack, service string, env []string)
	// Defaults are the capture rules a stack's file gives its services.
	Defaults(workspace, stack string, rules map[string]logs.Rule)
	// Announce names services that exist but may not have printed yet (a compose
	// file's containers, as "<compose id>/<container>").
	Announce(workspace, stack string, services []string)
	// Wanted says whether any of a service's lines are stored, that is whether its
	// capture rule is anything but "off". A container's Docker logs are followed only
	// while this is true.
	Wanted(workspace, stack, service string) bool
}

// noLogs is the sink used when none is given.
type noLogs struct{}

func (noLogs) Line(_, _, _, _, _ string, _ time.Time)       {}
func (noLogs) Env(_, _, _ string, _ []string)               {}
func (noLogs) Defaults(_, _ string, _ map[string]logs.Rule) {}
func (noLogs) Announce(_, _ string, _ []string)             {}
func (noLogs) Wanted(_, _, _ string) bool                   { return true }

// PreflightError means the pre-start check found problems, so nothing was started.
type PreflightError struct{ Report doctor.Report }

func (e *PreflightError) Error() string {
	return fmt.Sprintf("this machine isn't ready for the stack: %d problem%s found", e.Report.Failures, plural(e.Report.Failures))
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// ComposeFunc runs one Docker Compose action ("up" or "stop") for a stack's
// dependencies, sending output lines to out. Tests replace it.
type ComposeFunc func(ctx context.Context, c ComposeSpec, action string, out func(line string)) error

// Options configures a Supervisor. Zero values get sensible defaults.
type Options struct {
	// Bus receives a status event for the stack on every change, on topic
	// "stacks.<workspace>.<stack>".
	Bus *events.Bus
	// Plugins gives the pre-start check install hints.
	Plugins *sdk.Registry
	// BinDir is where built Go services are written.
	BinDir string
	// Probes are the machine questions the pre-start check asks. Tests replace them.
	Probes doctor.Probes
	// Preflight replaces the pre-start check. By default it runs Doctor for the stack.
	Preflight func(ctx context.Context, spec StackSpec) (doctor.Report, error)
	// Compose replaces how Docker Compose is run.
	Compose ComposeFunc
	// ComposePorts says which host ports a compose file's containers publish, once it
	// is up. By default it asks Docker, but only when Compose is the real one.
	ComposePorts func(ctx context.Context, c ComposeSpec) []int
	// Logs receives every output line of every service. Nil discards them.
	Logs LogSink
	// ComposeNames lists the services (containers) of a compose file. By default it
	// asks Docker, but only when Compose is the real one.
	ComposeNames func(ctx context.Context, c ComposeSpec) []string
	// ComposeFollow follows the logs of one container from a time on, calling line
	// for each, until ctx ends or it fails. By default it runs "docker compose logs
	// -f", but only when Compose is the real one.
	ComposeFollow func(ctx context.Context, c ComposeSpec, service string, since time.Time, line func(at time.Time, text string)) error
	// FollowPoll is how often the containers' capture rules are looked at. Default 1s.
	FollowPoll time.Duration

	// Backoff is the wait before restart number n (1 for the first). Default 1s doubling up to 30s.
	Backoff func(n int) time.Duration
	// MaxRestarts is how many crashes in a row are retried before giving up. Default 5.
	MaxRestarts int
	// StableAfter is how long a service must run before earlier crashes are forgotten. Default 30s.
	StableAfter time.Duration
	// PollEvery is how often readiness is checked. Default 250ms.
	PollEvery time.Duration
	// Settle is how long a service without a readiness check must stay up to count as ready. Default 500ms.
	Settle time.Duration
	// StopTimeout is how long to wait for one service to end when stopping. Default 10s.
	StopTimeout time.Duration
	// BuildTimeout and ComposeTimeout limit those steps. Defaults 5m.
	BuildTimeout   time.Duration
	ComposeTimeout time.Duration
}

func (o Options) withDefaults() Options {
	if o.BinDir == "" {
		o.BinDir = filepath.Join(os.TempDir(), "devdeck-bin")
	}
	if o.Backoff == nil {
		o.Backoff = func(n int) time.Duration {
			d := time.Second << min(max(n-1, 0), 5)
			return min(d, 30*time.Second)
		}
	}
	if o.FollowPoll == 0 {
		o.FollowPoll = followPoll
	}
	if o.MaxRestarts == 0 {
		o.MaxRestarts = 5
	}
	if o.StableAfter == 0 {
		o.StableAfter = 30 * time.Second
	}
	if o.PollEvery == 0 {
		o.PollEvery = 250 * time.Millisecond
	}
	if o.Settle == 0 {
		o.Settle = 500 * time.Millisecond
	}
	if o.StopTimeout == 0 {
		o.StopTimeout = 10 * time.Second
	}
	if o.BuildTimeout == 0 {
		o.BuildTimeout = 5 * time.Minute
	}
	if o.ComposeTimeout == 0 {
		o.ComposeTimeout = 5 * time.Minute
	}
	return o
}

// Supervisor runs stacks. It is safe for concurrent use.
type Supervisor struct {
	o    Options
	mu   sync.Mutex
	runs map[string]*run
}

// New returns a Supervisor.
func New(o Options) *Supervisor {
	s := &Supervisor{o: o.withDefaults(), runs: map[string]*run{}}
	if s.o.Logs == nil {
		s.o.Logs = noLogs{}
	}
	if s.o.Preflight == nil {
		s.o.Preflight = s.doctorPreflight
	}
	if s.o.Compose == nil {
		s.o.Compose = s.dockerCompose
		if s.o.ComposePorts == nil {
			s.o.ComposePorts = s.dockerComposePorts
		}
		if s.o.ComposeNames == nil {
			s.o.ComposeNames = composeWanted
		}
		if s.o.ComposeFollow == nil {
			s.o.ComposeFollow = s.dockerComposeFollow
		}
	}
	return s
}

func key(workspace, stack string) string { return workspace + "/" + stack }

func (s *Supervisor) doctorPreflight(ctx context.Context, spec StackSpec) (doctor.Report, error) {
	return doctor.Run(ctx, doctor.Input{
		Name:      spec.Workspace,
		Workspace: spec.WorkspaceFile,
		Stacks:    spec.Stacks,
		Stack:     spec.Name,
		Root:      spec.Root,
		Plugins:   s.o.Plugins,
		Probes:    s.o.Probes,
	})
}

// dockerCompose runs the docker CLI for a stack's dependencies.
func (s *Supervisor) dockerCompose(ctx context.Context, c ComposeSpec, action string, out func(string)) error {
	args := []string{"compose", "-f", c.File}
	switch action {
	case "up":
		args = append(args, "up", "-d", "--wait")
	case "stop":
		args = append(args, "stop")
	default:
		return fmt.Errorf("unknown compose action %q", action)
	}
	args = append(args, c.Services...)
	res, err := proc.Run(ctx, proc.Cmd{
		Name: "docker", Args: args, Dir: c.Dir, Timeout: s.o.ComposeTimeout,
		OnLine: func(_ proc.Stream, line string) { out(line) },
	})
	if err != nil {
		return err
	}
	if res.OK() {
		return nil
	}
	if action == "up" && s.composeSettled(ctx, c) {
		out("devdeck: up --wait reported a finished one-shot container; everything else is up, so this counts as started")
		return nil
	}
	return fmt.Errorf("docker compose %s exited with code %d", action, res.ExitCode)
}

// composeSettled asks Compose what state the stack's containers are in, after an
// `up --wait` that failed, and says whether they are all where they should be.
func (s *Supervisor) composeSettled(ctx context.Context, c ComposeSpec) bool {
	want := composeWanted(ctx, c)
	out, ok := composePS(ctx, c)
	return ok && composeSettled(out, want)
}

// dockerComposePorts asks Docker which host ports a compose file's containers publish.
func (s *Supervisor) dockerComposePorts(ctx context.Context, c ComposeSpec) []int {
	out, ok := composePS(ctx, c)
	if !ok {
		return nil
	}
	return composePorts(out, composeWanted(ctx, c))
}

// composeWanted lists the services a compose file is meant to bring up: the ones
// asked for, or every one it defines. Nil when Docker can't say.
func composeWanted(ctx context.Context, c ComposeSpec) []string {
	if len(c.Services) > 0 {
		return slices.Clone(c.Services)
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: "docker", Args: []string{"compose", "-f", c.File, "config", "--services"}, Dir: c.Dir, Timeout: 30 * time.Second})
	if err != nil || !res.OK() {
		return nil
	}
	return strings.Fields(res.Stdout)
}

// composePS is the output of docker compose ps for a file's project, all containers.
func composePS(ctx context.Context, c ComposeSpec) (string, bool) {
	args := append([]string{"compose", "-f", c.File, "ps", "--all", "--format", "json"}, c.Services...)
	res, err := proc.Run(ctx, proc.Cmd{Name: "docker", Args: args, Dir: c.Dir, Timeout: 30 * time.Second})
	if err != nil || !res.OK() {
		return "", false
	}
	return res.Stdout, true
}

// Start checks the machine, then starts the stack in the background and returns
// its first status. It does not wait for the services to be ready: watch the
// status, or the "stacks.<workspace>.<stack>" topic.
func (s *Supervisor) Start(ctx context.Context, spec StackSpec) (RunStatus, error) {
	k := key(spec.Workspace, spec.Name)
	s.mu.Lock()
	_, running := s.runs[k]
	s.mu.Unlock()
	if running {
		return RunStatus{}, ErrAlreadyRunning
	}

	rep, err := s.o.Preflight(ctx, spec)
	if err != nil {
		return RunStatus{}, err
	}
	if !rep.Ready() {
		return RunStatus{}, &PreflightError{Report: rep}
	}

	s.mu.Lock()
	if _, running := s.runs[k]; running {
		s.mu.Unlock()
		return RunStatus{}, ErrAlreadyRunning
	}
	r := newRun(s, spec)
	s.runs[k] = r
	s.mu.Unlock()
	s.o.Logs.Defaults(spec.Workspace, spec.Name, spec.LogRules())

	r.begin()
	return r.status(), nil
}

// Stop stops a stack: the services that depend on others first, then the ones
// they depend on, then the Compose dependencies. It returns when everything has ended.
func (s *Supervisor) Stop(ctx context.Context, workspace, stack string) error {
	k := key(workspace, stack)
	s.mu.Lock()
	r, ok := s.runs[k]
	s.mu.Unlock()
	if !ok {
		return ErrNotRunning
	}
	r.stop(ctx)
	s.mu.Lock()
	delete(s.runs, k)
	s.mu.Unlock()
	return nil
}

// StopAll stops every running stack, so that closing devdeck leaves nothing behind.
func (s *Supervisor) StopAll(ctx context.Context) {
	s.mu.Lock()
	runs := make([]*run, 0, len(s.runs))
	for _, r := range s.runs {
		runs = append(runs, r)
	}
	s.runs = map[string]*run{}
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, r := range runs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r.stop(ctx)
		}()
	}
	wg.Wait()
}

// RestartService starts one service again (building it first if it is a Go
// service). It also retries a service that failed or was blocked.
func (s *Supervisor) RestartService(workspace, stack, service string) error {
	r, ok := s.get(workspace, stack)
	if !ok {
		return ErrNotRunning
	}
	sv := r.svc(service)
	if sv == nil || sv.compose != nil {
		return ErrNoSuchService
	}
	select {
	case sv.restartReq <- struct{}{}:
	default: // one request is already waiting
	}
	return nil
}

// StopService stops one service of a running stack and leaves it stopped (it is not
// restarted). A compose file's containers are stopped with docker compose stop. It
// returns when the process is gone.
func (s *Supervisor) StopService(ctx context.Context, workspace, stack, service string) error {
	r, ok := s.get(workspace, stack)
	if !ok {
		return ErrNotRunning
	}
	return r.stopOne(ctx, service)
}

// StartService starts a service of a running stack that was stopped (by hand, by
// finishing or by failing). A compose file is brought up again.
func (s *Supervisor) StartService(workspace, stack, service string) error {
	r, ok := s.get(workspace, stack)
	if !ok {
		return ErrNotRunning
	}
	return r.startOne(service)
}

// Status reports a stack, or false when it isn't running.
func (s *Supervisor) Status(workspace, stack string) (RunStatus, bool) {
	r, ok := s.get(workspace, stack)
	if !ok {
		return RunStatus{}, false
	}
	return r.status(), true
}

// List reports every running stack, sorted by workspace and stack.
func (s *Supervisor) List() []RunStatus {
	s.mu.Lock()
	runs := make([]*run, 0, len(s.runs))
	for _, r := range s.runs {
		runs = append(runs, r)
	}
	s.mu.Unlock()
	out := make([]RunStatus, len(runs))
	for i, r := range runs {
		out[i] = r.status()
	}
	slices.SortFunc(out, func(a, b RunStatus) int {
		if c := compareStrings(a.Workspace, b.Workspace); c != 0 {
			return c
		}
		return compareStrings(a.Stack, b.Stack)
	})
	return out
}

func compareStrings(a, b string) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	}
	return 0
}

// OwnPorts lists the ports of the services in a running stack (or, when stack is
// empty, in every running stack of the workspace), so the machine check doesn't
// call a port "taken" when devdeck itself holds it. It is nil when nothing runs.
func (s *Supervisor) OwnPorts(workspace, stack string) map[int]bool {
	s.mu.Lock()
	var runs []*run
	for _, r := range s.runs {
		if r.spec.Workspace == workspace && (stack == "" || r.spec.Name == stack) {
			runs = append(runs, r)
		}
	}
	s.mu.Unlock()
	if len(runs) == 0 {
		return nil
	}
	ports := map[int]bool{}
	for _, r := range runs {
		for _, sv := range r.spec.Services {
			if sv.Port > 0 {
				ports[sv.Port] = true
			}
		}
	}
	return ports
}

func (s *Supervisor) get(workspace, stack string) (*run, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.runs[key(workspace, stack)]
	return r, ok
}
