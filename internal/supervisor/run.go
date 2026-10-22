package supervisor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/sdk/proc"
)

const (
	composeID   = "compose"
	maxErrLine  = 200
	depPollTime = 25 * time.Millisecond
)

// end says why a service's life cycle returned.
type end int

const (
	endStopped end = iota // devdeck is stopping it
	endFailed             // it failed; wait for a manual retry
	endDone               // its state is final (ready Compose, or a clean exit); wait for a retry
)

// outcome says how one start of a process ended.
type outcome int

const (
	outStopped  outcome = iota // devdeck is stopping it
	outRestart                 // someone asked for a restart
	outNotReady                // it didn't become ready in time
	outExited                  // it ended by itself
)

type exitInfo struct {
	code     int
	err      error
	ranFor   time.Duration
	wasReady bool
}

type svc struct {
	id      string
	spec    ServiceSpec
	compose *ComposeSpec

	// guarded by run.mu
	status    ServiceStatus
	everReady bool
	// red masks secrets in the one-line summaries shown in error messages.
	red      *logs.Redactor
	lastLine string
	// optional: when it fails, what waits for it carries on (a compose file's flag).
	optional bool

	ctx        context.Context
	cancel     context.CancelFunc
	done       chan struct{}
	restartReq chan struct{}
	exe        string // built Go program; only the service's own goroutine uses it
	// startedOnce is true after the first start, so later starts count as restarts.
	startedOnce bool
	// followCancel and followWG belong to a compose file's goroutine: the followers
	// of its containers' Docker logs.
	followCancel context.CancelFunc
	followWG     sync.WaitGroup
}

type run struct {
	sup  *Supervisor
	o    Options
	spec StackSpec

	mu        sync.Mutex
	svcs      map[string]*svc
	order     []*svc // Compose first, then the stack's services in file order
	startedAt time.Time
	phase     RunState // "", RunStopping or RunStopped

	stopOnce sync.Once
}

func newRun(s *Supervisor, spec StackSpec) *run {
	r := &run{sup: s, o: s.o, spec: spec, svcs: map[string]*svc{}, startedAt: time.Now()}
	add := func(sv *svc, kind string, port int) {
		sv.ctx, sv.cancel = context.WithCancel(context.Background())
		sv.done = make(chan struct{})
		sv.restartReq = make(chan struct{}, 1)
		sv.red = &logs.Redactor{}
		sv.status = ServiceStatus{ID: sv.id, Kind: kind, State: StateWaiting, Port: port, Optional: sv.optional}
		r.svcs[sv.id] = sv
		r.order = append(r.order, sv)
	}
	for _, c := range spec.Compose {
		add(&svc{id: c.ID, compose: &c, optional: c.Optional}, "compose", 0)
	}
	for _, sp := range spec.Services {
		add(&svc{id: sp.ID, spec: sp}, sp.Kind, sp.Port)
	}
	return r
}

func (r *run) begin() {
	for _, s := range r.order {
		go r.runService(s)
	}
	r.publish(r.status())
}

// ---- status ---------------------------------------------------------------

func (r *run) status() RunStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked()
}

func (r *run) snapshotLocked() RunStatus {
	st := RunStatus{Workspace: r.spec.Workspace, Stack: r.spec.Name, StartedAt: r.startedAt, State: r.stateLocked()}
	for _, s := range r.order {
		c := s.status
		st.Services = append(st.Services, c)
	}
	return st
}

func (r *run) stateLocked() RunState {
	if r.phase != "" {
		return r.phase
	}
	allOK := true
	for _, s := range r.order {
		if s.optional && (s.status.State == StateFailed || s.status.State == StateBlocked) {
			continue // said so in its own row and in the logs; the rest carries on
		}
		switch s.status.State {
		case StateFailed, StateBlocked, StateRestarting:
			return RunDegraded
		case StateReady, StateStopped:
		default:
			allOK = false
		}
	}
	if allOK {
		return RunRunning
	}
	return RunStarting
}

func (r *run) publish(st RunStatus) {
	if r.o.Bus != nil {
		r.o.Bus.Publish("stacks."+r.spec.Workspace+"."+r.spec.Name, st)
	}
}

// update changes one service's status and tells subscribers.
func (r *run) update(s *svc, f func(*ServiceStatus)) {
	r.mu.Lock()
	f(&s.status)
	snap := r.snapshotLocked()
	r.mu.Unlock()
	r.publish(snap)
}

// set moves a service to a state. msg replaces the last error (empty clears it).
func (r *run) set(s *svc, state State, msg string) {
	r.update(s, func(st *ServiceStatus) {
		st.State = state
		st.LastError = msg
	})
}

func (r *run) fail(s *svc, msg string) { r.set(s, StateFailed, msg) }

func (r *run) markReady(s *svc) {
	now := time.Now()
	r.mu.Lock()
	s.everReady = true
	r.mu.Unlock()
	r.update(s, func(st *ServiceStatus) {
		st.State, st.LastError, st.ReadyAt = StateReady, "", &now
	})
}

// ---- output ---------------------------------------------------------------

// record hands one output line to the log sink, and remembers the last line of the
// service (cleaned and with secrets masked) for its error messages. The supervisor
// keeps nothing else: storing and showing output is the log store's job.
func (r *run) record(s *svc, stream, text string) {
	if t := strings.TrimSpace(logs.Clean(text)); t != "" {
		t = s.red.Mask(t)
		r.mu.Lock()
		s.lastLine = t
		r.mu.Unlock()
	}
	r.o.Logs.Line(r.spec.Workspace, r.spec.Name, s.id, stream, text, time.Now())
}

func (r *run) last(s *svc) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	t := s.lastLine
	if len(t) > maxErrLine {
		t = t[:maxErrLine] + "…"
	}
	return t
}

// withLast adds the last output line to a message, when there is one.
func (r *run) withLast(s *svc, msg string) string {
	if l := r.last(s); l != "" {
		return msg + ": " + l
	}
	return msg
}

// ---- one service ----------------------------------------------------------

func (r *run) runService(s *svc) {
	defer close(s.done)
	defer r.stopFollowing(s)
	for {
		var e end
		if s.compose != nil {
			e = r.lifecycleCompose(s)
		} else {
			e = r.lifecycle(s)
		}
		if e == endStopped {
			r.set(s, StateStopped, "")
			return
		}
		// Failed, or finished for good: stay put until someone asks to retry or devdeck stops.
		select {
		case <-s.restartReq:
		case <-s.ctx.Done():
			r.set(s, StateStopped, "")
			return
		}
	}
}

func (r *run) lifecycleCompose(s *svc) end {
	switch r.waitDeps(s) {
	case endStopped:
		return endStopped
	case endFailed:
		return endFailed
	}
	r.stopFollowing(s) // a retry must not leave the earlier followers running
	now := time.Now()
	r.update(s, func(st *ServiceStatus) {
		st.State, st.LastError, st.StartedAt, st.ReadyAt, st.ExitCode = StateStarting, "", &now, nil, nil
	})
	err := r.o.Compose(s.ctx, *s.compose, "up", func(line string) { r.record(s, "stdout", line) })
	switch {
	case s.ctx.Err() != nil:
		return endStopped
	case err != nil:
		msg := r.withLast(s, "Docker Compose couldn't start the dependencies")
		r.fail(s, msg)
		if s.optional {
			r.record(s, "stderr", "[devdeck] "+s.id+" failed to start, carrying on without it: "+msg)
		}
		return endFailed
	}
	// Show the ports the containers publish: devdeck doesn't read them from the file.
	if r.o.ComposePorts != nil {
		if ports := r.o.ComposePorts(s.ctx, *s.compose); len(ports) > 0 {
			r.update(s, func(st *ServiceStatus) { st.Ports = ports })
		}
	}
	r.markReady(s)
	// The containers' own output, from when this start began.
	r.startFollowing(s, now)
	return endDone
}

// svc returns the current record of a service. (Starting a stopped service by hand
// replaces its record, so the map is read under the lock.)
func (r *run) svc(id string) *svc {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.svcs[id]
}

// depsOf lists the steps s waits for. A compose file with an id waits for its own
// after list. A service waits for its after list and, when the compose files have no
// ids, for all of them.
func (r *run) depsOf(s *svc) []string {
	if s.compose != nil {
		return slices.Clone(s.compose.After)
	}
	deps := slices.Clone(s.spec.After)
	if !r.spec.Ordered() {
		for _, c := range r.spec.Compose {
			deps = append(deps, c.ID)
		}
	}
	return deps
}

// waitDeps waits until every step s comes after has been ready once.
// It returns endDone to go on, endFailed if one of them failed, endStopped on stop.
func (r *run) waitDeps(s *svc) end {
	deps := r.depsOf(s)
	r.set(s, StateWaiting, "")
	tick := time.NewTicker(depPollTime)
	defer tick.Stop()
	for {
		pending := false
		for _, id := range deps {
			d := r.svc(id)
			r.mu.Lock()
			ever, st := d.everReady, d.status.State
			r.mu.Unlock()
			switch {
			case ever:
			case (st == StateFailed || st == StateBlocked) && d.optional:
				// optional: its failure is shown, and nothing waits for it any more
			case st == StateFailed || st == StateBlocked:
				r.set(s, StateBlocked, fmt.Sprintf("%s failed, so this wasn't started", id))
				return endFailed
			default:
				pending = true
			}
		}
		if !pending {
			return endDone
		}
		select {
		case <-s.ctx.Done():
			return endStopped
		case <-s.restartReq: // nothing to retry yet
		case <-tick.C:
		}
	}
}

func (r *run) lifecycle(s *svc) end {
	switch r.waitDeps(s) {
	case endStopped:
		return endStopped
	case endFailed:
		return endFailed
	}

	attempt := 0
	for {
		if s.ctx.Err() != nil {
			return endStopped
		}
		if s.spec.Kind == "go" {
			if err := r.build(s); err != nil {
				if s.ctx.Err() != nil {
					return endStopped
				}
				r.fail(s, err.Error())
				return endFailed
			}
		}
		if s.startedOnce {
			r.update(s, func(st *ServiceStatus) { st.Restarts++ })
		}
		s.startedOnce = true

		out, ex := r.once(s)
		switch out {
		case outStopped:
			return endStopped
		case outRestart:
			attempt = 0
			continue
		case outNotReady:
			return endFailed
		}

		// outExited
		code := normalizeExit(ex.code)
		r.update(s, func(st *ServiceStatus) { st.ExitCode = &code })
		if ex.err != nil {
			r.fail(s, startError(s, ex.err))
			return endFailed
		}
		if code == 0 && s.spec.Restart != "always" {
			if !ex.wasReady {
				r.fail(s, r.withLast(s, "It stopped before it was ready"))
				return endFailed
			}
			r.set(s, StateStopped, "")
			return endDone
		}
		if s.spec.Restart == "never" {
			r.fail(s, r.withLast(s, fmt.Sprintf("It exited with code %d", code)))
			return endFailed
		}
		if ex.ranFor >= r.o.StableAfter {
			attempt = 0
		}
		attempt++
		if attempt > r.o.MaxRestarts {
			r.fail(s, r.withLast(s, fmt.Sprintf("It crashed %d times in a row, so devdeck gave up", attempt)))
			return endFailed
		}
		r.set(s, StateRestarting, r.withLast(s, fmt.Sprintf("It exited with code %d", code)))
		select {
		case <-time.After(r.o.Backoff(attempt)):
		case <-s.restartReq:
			attempt = 0
		case <-s.ctx.Done():
			return endStopped
		}
	}
}

func startError(s *svc, err error) string {
	if errors.Is(err, exec.ErrNotFound) {
		name := ""
		if len(s.spec.Argv) > 0 {
			name = s.spec.Argv[0]
		}
		return fmt.Sprintf("%s isn't installed or isn't on the PATH", name)
	}
	return "It couldn't be started: " + err.Error()
}

// build compiles a Go service into the bin folder.
func (r *run) build(s *svc) error {
	r.set(s, StateBuilding, "")
	if err := os.MkdirAll(r.o.BinDir, 0o750); err != nil {
		return fmt.Errorf("the build folder couldn't be made: %w", err)
	}
	name := r.spec.Workspace + "-" + r.spec.Name + "-" + s.id
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	exe := filepath.Join(r.o.BinDir, name)
	res, err := proc.Run(s.ctx, proc.Cmd{
		Name: "go", Args: []string{"build", "-buildvcs=false", "-o", exe, s.spec.Package}, Dir: s.spec.Dir, Timeout: r.o.BuildTimeout,
		OnLine: func(_ proc.Stream, line string) { r.record(s, "build", line) },
	})
	switch {
	case errors.Is(err, exec.ErrNotFound):
		return errors.New("the go command isn't installed or isn't on the PATH")
	case errors.Is(err, proc.ErrTimeout):
		return fmt.Errorf("the build took longer than %s", r.o.BuildTimeout)
	case err != nil:
		return err
	case !res.OK():
		return errors.New(r.withLast(s, "The build failed"))
	}
	s.exe = exe
	return nil
}

// envFor is the extra environment for a service: its env file, then its env block.
func (r *run) envFor(s *svc) ([]string, error) {
	var env []string
	if s.spec.EnvFile != "" {
		entries, err := LoadEnvFile(s.spec.EnvFile)
		if err != nil {
			return nil, fmt.Errorf("the env file couldn't be read: %w", errors.Unwrap(err))
		}
		env = append(env, entries...)
	}
	keys := make([]string, 0, len(s.spec.Env))
	for k := range s.spec.Env {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	for _, k := range keys {
		env = append(env, k+"="+s.spec.Env[k])
	}
	return env, nil
}

// once starts the process and watches it until it ends or is stopped.
func (r *run) once(s *svc) (outcome, exitInfo) {
	env, err := r.envFor(s)
	if err != nil {
		r.fail(s, err.Error())
		return outNotReady, exitInfo{}
	}
	s.red.SetEnv(env)
	r.o.Logs.Env(r.spec.Workspace, r.spec.Name, s.id, env)
	name, args := "", []string(nil)
	if s.spec.Kind == "go" {
		name = s.exe
	} else {
		name, args = s.spec.Argv[0], s.spec.Argv[1:]
	}

	procCtx, cancel := context.WithCancel(s.ctx)
	defer cancel()
	logHit := make(chan struct{}, 1)
	exit := make(chan exitInfo, 1)
	want := s.spec.Ready.Log

	started := time.Now()
	r.update(s, func(st *ServiceStatus) {
		st.State, st.LastError, st.StartedAt, st.ReadyAt, st.ExitCode = StateStarting, "", &started, nil, nil
	})
	go func() {
		res, err := proc.Run(procCtx, proc.Cmd{
			Name: name, Args: args, Dir: s.spec.Dir, Env: env,
			OnLine: func(stream proc.Stream, line string) {
				r.record(s, string(stream), line)
				// Tools such as Vite colour parts of a line ("Local" then ":"), so look at it clean.
				if want != "" && strings.Contains(logs.Clean(line), want) {
					select {
					case logHit <- struct{}{}:
					default:
					}
				}
			},
		})
		exit <- exitInfo{code: res.ExitCode, err: err, ranFor: time.Since(started)}
	}()

	hasProbe := s.spec.Ready.HTTP != "" || s.spec.Ready.TCP != "" || s.spec.Ready.Log != ""
	poll := time.NewTicker(r.o.PollEvery)
	defer poll.Stop()
	timeout := time.NewTimer(s.spec.ReadyTimeout)
	defer timeout.Stop()
	var settle <-chan time.Time
	if !hasProbe {
		settle = time.After(r.o.Settle)
	}
	timeoutC := timeout.C
	ready := false
	becomeReady := func() {
		ready, settle, timeoutC = true, nil, nil
		r.markReady(s)
	}
	stopProc := func() {
		cancel()
		<-exit
	}

	for {
		select {
		case ex := <-exit:
			if s.ctx.Err() != nil {
				return outStopped, ex
			}
			if errors.Is(ex.err, context.Canceled) {
				return outStopped, ex
			}
			ex.wasReady = ready
			return outExited, ex
		case <-s.ctx.Done():
			stopProc()
			return outStopped, exitInfo{}
		case <-s.restartReq:
			stopProc()
			return outRestart, exitInfo{}
		case <-logHit:
			if !ready {
				becomeReady()
			}
		case <-settle:
			becomeReady()
		case <-poll.C:
			if !ready && r.probe(procCtx, s) {
				becomeReady()
			}
		case <-timeoutC:
			stopProc()
			r.fail(s, r.withLast(s, fmt.Sprintf("It wasn't ready after %s", s.spec.ReadyTimeout)))
			return outNotReady, exitInfo{}
		}
	}
}

// probe runs the HTTP or TCP readiness check, if the service has one.
func (r *run) probe(ctx context.Context, s *svc) bool {
	switch {
	case s.spec.Ready.HTTP != "":
		return probeHTTP(ctx, s.spec.Ready.HTTP)
	case s.spec.Ready.TCP != "":
		return probeTCP(ctx, s.spec.Ready.TCP)
	}
	return false
}

// ---- stopping -------------------------------------------------------------

// stop ends the services dependents first, then the Compose dependencies.
func (r *run) stop(ctx context.Context) {
	r.stopOnce.Do(func() { r.doStop(ctx) })
}

func (r *run) doStop(ctx context.Context) {
	r.mu.Lock()
	r.phase = RunStopping
	snap := r.snapshotLocked()
	r.mu.Unlock()
	r.publish(snap)

	wait := func(s *svc) {
		select {
		case <-s.done:
		case <-time.After(r.o.StopTimeout):
		case <-ctx.Done():
		}
	}

	if r.spec.Ordered() {
		// Compose files are steps in the order: stop in reverse, each at its own turn.
		levels, _ := r.spec.Levels() // checked when the stack was planned
		for _, level := range slices.Backward(levels) {
			for _, id := range level {
				r.svc(id).cancel()
			}
			for _, id := range level {
				s := r.svc(id)
				wait(s)
				if s.compose != nil {
					r.stopCompose(ctx, s)
				}
			}
		}
	} else {
		levels, _ := Levels(r.spec.Services) // checked when the stack was planned
		for _, level := range slices.Backward(levels) {
			for _, id := range level {
				r.svc(id).cancel()
			}
			for _, id := range level {
				wait(r.svc(id))
			}
		}
		for _, spec := range r.spec.Compose {
			c := r.svc(spec.ID)
			c.cancel()
			wait(c)
			r.stopCompose(ctx, c)
		}
	}

	r.mu.Lock()
	for _, s := range r.order {
		s.status.State = StateStopped
	}
	r.phase = RunStopped
	snap = r.snapshotLocked()
	r.mu.Unlock()
	r.publish(snap)
}

// stopOne stops one service (or compose file) by hand and leaves it stopped: it is
// not restarted. What waits for it is left alone; stopping a service others need is
// the person's choice. It returns when the process is gone.
func (r *run) stopOne(ctx context.Context, id string) error {
	r.mu.Lock()
	s := r.svcs[id]
	switch {
	case r.phase != "":
		r.mu.Unlock()
		return ErrNotRunning
	case s == nil:
		r.mu.Unlock()
		return ErrNoSuchService
	case s.status.State == StateStopped || s.status.State == StateStopping:
		r.mu.Unlock()
		return nil
	}
	r.mu.Unlock()

	r.set(s, StateStopping, "")
	s.cancel()
	select {
	case <-s.done:
	case <-time.After(r.o.StopTimeout):
	case <-ctx.Done():
	}
	if s.compose != nil {
		r.stopCompose(ctx, s)
	}
	r.set(s, StateStopped, "")
	return nil
}

// startOne starts a service (or compose file) that was stopped. If it only
// finished by itself, or failed, its own goroutine is still waiting and is asked to
// go again. If it was stopped by hand, its goroutine is gone: a fresh record
// replaces it and a new goroutine runs it, starting from its own start-up steps.
func (r *run) startOne(id string) error {
	r.mu.Lock()
	old := r.svcs[id]
	switch {
	case r.phase != "":
		r.mu.Unlock()
		return ErrNotRunning
	case old == nil:
		r.mu.Unlock()
		return ErrNoSuchService
	}
	select {
	case <-old.done: // the goroutine ended: it was stopped by hand
	default:
		r.mu.Unlock()
		if st := old.status.State; st == StateStopped || st == StateFailed || st == StateBlocked {
			select {
			case old.restartReq <- struct{}{}:
			default:
			}
		}
		return nil // anything else is already running or on its way
	}

	ns := &svc{
		id: old.id, spec: old.spec, compose: old.compose, optional: old.optional,
		everReady: old.everReady, red: old.red, lastLine: old.lastLine, startedOnce: old.startedOnce, status: old.status,
	}
	ns.ctx, ns.cancel = context.WithCancel(context.Background())
	ns.done = make(chan struct{})
	ns.restartReq = make(chan struct{}, 1)
	r.svcs[id] = ns
	for i, o := range r.order {
		if o == old {
			r.order[i] = ns
		}
	}
	r.mu.Unlock()

	r.set(ns, StateWaiting, "")
	go r.runService(ns)
	return nil
}

// stopCompose runs docker compose stop for a compose file's containers.
func (r *run) stopCompose(ctx context.Context, c *svc) {
	stopCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), r.o.ComposeTimeout)
	defer cancel()
	if err := r.o.Compose(stopCtx, *c.compose, "stop", func(line string) { r.record(c, "stdout", line) }); err != nil {
		r.record(c, "stderr", "the dependencies couldn't be stopped: "+err.Error())
	}
}

// normalizeExit turns the unsigned exit codes Windows reports for a killed
// program (4294967295) into the negative numbers people expect (-1).
func normalizeExit(code int) int {
	if code >= 1<<31 && code < 1<<32 {
		return code - 1<<32
	}
	return code
}
