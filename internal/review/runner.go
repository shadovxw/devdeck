package review

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// Git is what a run needs from git. gitx.Git is one.
type Git interface {
	Rev(ctx context.Context, dir, ref string) (string, error)
	WorktreeAdd(ctx context.Context, dir, path, ref string) error
	WorktreeRemove(ctx context.Context, dir, path string) error
}

// Request is one tool to run on one PR's branch.
type Request struct {
	Workspace string
	Feature   string
	PR        string
	Repo      string
	Tool      string
	// RepoDir is the repository's folder. Branch and Base are the names; Ref and BaseRef are what git is
	// given for them (the local branch, or origin's). BaseRef is empty when the base doesn't exist.
	RepoDir string
	Branch  string
	Base    string
	Ref     string
	BaseRef string
	// PlanDir is the plan's folder, where the result is saved under reviews/.
	PlanDir string
}

// State is where a run is.
type State string

// The states of a run. A finished run is done (with a Status) or cancelled (nothing is saved).
const (
	StateQueued    State = "queued"
	StateRunning   State = "running"
	StateDone      State = "done"
	StateCancelled State = "cancelled"
)

// Run is one run, as the page sees it. It lives in memory; the result file is the durable record.
type Run struct {
	ID        string    `json:"id"`
	Workspace string    `json:"workspace"`
	Feature   string    `json:"feature"`
	PR        string    `json:"pr"`
	Repo      string    `json:"repo"`
	Tool      string    `json:"tool"`
	State     State     `json:"state"`
	Status    Status    `json:"status,omitempty"`
	Summary   string    `json:"summary,omitempty"`
	Commit    string    `json:"commit,omitempty"`
	File      string    `json:"file,omitempty"`
	Queued    time.Time `json:"queued"`
	Started   time.Time `json:"started,omitzero"`
	Finished  time.Time `json:"finished,omitzero"`
}

// Active reports whether the run is waiting or running.
func (r Run) Active() bool { return r.State == StateQueued || r.State == StateRunning }

// ErrBusy means the same tool is already waiting or running on that PR.
var ErrBusy = errors.New("that tool is already running, or waiting its turn, on this PR")

// ErrUnknownTool means the tool id isn't one devdeck has.
var ErrUnknownTool = errors.New("devdeck has no such review tool")

// Runner runs review tools. Only a few run at once, so a feature with many PRs doesn't swamp the machine
// the dev stack runs on; the rest wait their turn.
type Runner struct {
	Git Git
	// WorkDir is where the temporary checkouts go.
	WorkDir string
	// Workers is how many tools run at once (two when zero).
	Workers int
	// Timeout is how long one command may take (ten minutes when zero).
	Timeout time.Duration

	// Exec runs a command; Locate finds a program; Now is the clock. Tests replace them.
	Exec   func(ctx context.Context, c proc.Cmd) (proc.Result, error)
	Locate func(string) (string, bool)
	Now    func() time.Time

	once    sync.Once
	slots   chan struct{}
	mu      sync.Mutex
	entries []*entry
	counter int
	active  sync.WaitGroup
}

type entry struct {
	run    Run
	cancel context.CancelFunc
}

const maxRemembered = 200

func (r *Runner) init() {
	r.once.Do(func() {
		n := r.Workers
		if n <= 0 {
			n = 2
		}
		r.slots = make(chan struct{}, n)
	})
}

func (r *Runner) now() time.Time {
	if r.Now != nil {
		return r.Now()
	}
	return time.Now()
}

func (r *Runner) locate(p string) (string, bool) {
	if r.Locate != nil {
		return r.Locate(p)
	}
	return Locate(p)
}

func (r *Runner) exec(ctx context.Context, c proc.Cmd) (proc.Result, error) {
	if r.Exec != nil {
		return r.Exec(ctx, c)
	}
	return proc.Run(ctx, c)
}

// Start queues one tool on one PR's branch and returns at once; the run goes on in the background.
func (r *Runner) Start(req Request) (Run, error) {
	r.init()
	tool, ok := ToolByID(req.Tool)
	if !ok {
		return Run{}, ErrUnknownTool
	}
	if _, ok := FileName(req.PR, req.Tool); !ok || req.RepoDir == "" || req.Ref == "" || req.PlanDir == "" {
		return Run{}, errors.New("the review request is incomplete")
	}

	r.mu.Lock()
	for _, e := range r.entries {
		x := e.run
		if x.Active() && x.Workspace == req.Workspace && x.Feature == req.Feature && x.PR == req.PR && x.Tool == req.Tool {
			r.mu.Unlock()
			return Run{}, ErrBusy
		}
	}
	r.counter++
	ctx, cancel := context.WithCancel(context.Background())
	e := &entry{cancel: cancel, run: Run{
		ID: strconv.FormatInt(r.now().UnixNano(), 36) + "-" + strconv.Itoa(r.counter), Workspace: req.Workspace, Feature: req.Feature,
		PR: req.PR, Repo: req.Repo, Tool: req.Tool, State: StateQueued, Queued: r.now(),
	}}
	r.entries = append(r.entries, e)
	r.forget()
	started := e.run
	r.mu.Unlock()

	r.active.Add(1)
	go func() {
		defer r.active.Done()
		r.execute(ctx, e, req, tool)
	}()
	return started, nil
}

// forget drops the oldest finished runs once there are too many. The caller holds the lock.
func (r *Runner) forget() {
	for len(r.entries) > maxRemembered {
		i := slices.IndexFunc(r.entries, func(e *entry) bool { return !e.run.Active() })
		if i < 0 {
			return
		}
		r.entries = slices.Delete(r.entries, i, i+1)
	}
}

// Runs lists the runs of one feature, oldest first.
func (r *Runner) Runs(workspace, feature string) []Run {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := []Run{}
	for _, e := range r.entries {
		if e.run.Workspace == workspace && e.run.Feature == feature {
			out = append(out, e.run)
		}
	}
	return out
}

// Cancel stops a run that is waiting or running. It reports false for an id that isn't an active run.
func (r *Runner) Cancel(workspace, feature, id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.entries {
		if e.run.ID == id && e.run.Workspace == workspace && e.run.Feature == feature && e.run.Active() {
			e.cancel()
			return true
		}
	}
	return false
}

// Wait blocks until nothing is waiting or running. For tests and for shutting down.
func (r *Runner) Wait() { r.active.Wait() }

func (r *Runner) update(e *entry, f func(*Run)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(&e.run)
}

func (r *Runner) execute(ctx context.Context, e *entry, req Request, tool Tool) {
	defer e.cancel()
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-ctx.Done():
		r.update(e, func(x *Run) { x.State, x.Finished = StateCancelled, r.now() })
		return
	}
	r.update(e, func(x *Run) { x.State, x.Started = StateRunning, r.now() })

	res := r.check(ctx, e.run.ID, req, tool)
	if ctx.Err() != nil {
		r.update(e, func(x *Run) { x.State, x.Finished, x.Commit = StateCancelled, r.now(), res.Commit })
		return
	}
	file, err := WriteResult(req.PlanDir, res, tool.Name)
	if err != nil {
		res.Status, res.Summary = StatusError, "The result couldn't be saved: "+err.Error()
	}
	r.update(e, func(x *Run) {
		x.State, x.Finished = StateDone, r.now()
		x.Status, x.Summary, x.Commit, x.File = res.Status, res.Summary, res.Commit, file
	})
}

// check does the work of one run: a checkout of the branch, the tool's commands in it, and the checkout removed.
func (r *Runner) check(ctx context.Context, id string, req Request, tool Tool) Result {
	res := Result{Tool: req.Tool, PR: req.PR, Repo: req.Repo, Branch: req.Branch, Base: req.Base, Ran: r.now()}
	fail := func(format string, a ...any) Result {
		res.Status, res.Summary = StatusError, fmt.Sprintf(format, a...)
		res.Duration = r.now().Sub(res.Ran)
		return res
	}

	head, err := r.Git.Rev(ctx, req.RepoDir, req.Ref)
	if err != nil {
		return fail("The branch couldn't be found: %v", err)
	}
	res.Commit = head

	dir := filepath.Join(r.WorkDir, id)
	if err := os.MkdirAll(r.WorkDir, 0o755); err != nil {
		return fail("The folder for the checkout couldn't be made: %v", err)
	}
	if err := r.Git.WorktreeAdd(ctx, req.RepoDir, dir, req.Ref); err != nil {
		return fail("The branch couldn't be checked out: %v", err)
	}
	var linked string
	defer func() {
		// The link goes first, on its own: removing the checkout must never follow it into the repository's own node_modules.
		if linked != "" {
			_ = os.Remove(linked)
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		_ = r.Git.WorktreeRemove(cleanup, req.RepoDir, dir)
	}()

	c := Context{Go: exists(filepath.Join(dir, "go.mod")), Node: exists(filepath.Join(dir, "package.json")), Base: req.BaseRef, Head: req.Ref}
	steps := tool.Steps(c)
	if len(steps) == 0 {
		res.Status, res.Summary = StatusSkip, "Nothing to check here: the branch has no go.mod or package.json."
		res.Duration = r.now().Sub(res.Ran)
		return res
	}

	out := &collector{}
	status := StatusSkip
	var problems []string
	for _, s := range steps {
		if ctx.Err() != nil {
			break
		}
		st, why := r.step(ctx, s, tool, dir, req.RepoDir, &linked, out)
		status = worse(status, st)
		if why != "" {
			problems = append(problems, why)
		}
	}
	res.Duration = r.now().Sub(res.Ran)
	lines := out.tail(maxOutputLines)
	res.Output = strings.Join(lines, "\n")
	res.Status = status
	if status == StatusError {
		res.Summary = strings.Join(problems, " ")
		return res
	}
	res.Findings = Findings(lines)
	res.Summary = Summary(req.Tool, status, res.Findings, lines)
	return res
}

// step runs one command and says how it ended. why is set when it couldn't run.
func (r *Runner) step(ctx context.Context, s Step, tool Tool, dir, repoDir string, linked *string, out *collector) (status Status, why string) {
	exe, ok := r.locate(s.Program)
	if !ok {
		why = s.Program + " isn't installed."
		if h := Hint(s.Program); h != "" {
			why += " " + h
		}
		out.add("$ " + s.Program + " " + strings.Join(s.Args, " "))
		out.add(why)
		return StatusError, why
	}
	if s.Program == "npm" && tool.modules && *linked == "" && !exists(filepath.Join(dir, "node_modules")) {
		target := filepath.Join(repoDir, "node_modules")
		if !exists(target) {
			why = "The dependencies aren't installed: run npm ci in the repository first."
			out.add(why)
			return StatusError, why
		}
		link := filepath.Join(dir, "node_modules")
		if err := linkDir(link, target); err != nil {
			why = "The dependencies couldn't be linked into the checkout: " + err.Error()
			out.add(why)
			return StatusError, why
		}
		*linked = link
	}

	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	out.add("$ " + s.Program + " " + strings.Join(s.Args, " "))
	// A mise shim that has no version of the tool for this folder prints "mise ERROR ..." and exits: that is the
	// tool not being set up here, not the tool finding problems.
	var shimError bool
	res, err := r.exec(ctx, proc.Cmd{
		Name: exe, Args: s.Args, Dir: dir, Timeout: timeout,
		Env: []string{"CI=true", "NO_COLOR=1", "SEMGREP_SEND_METRICS=off", "SEMGREP_ENABLE_VERSION_CHECK=0"},
		OnLine: func(_ proc.Stream, line string) {
			if strings.HasPrefix(line, "mise ERROR") {
				shimError = true
			}
			out.add(line)
		},
	})
	switch {
	case err != nil && ctx.Err() != nil:
		return StatusError, "Stopped."
	case errors.Is(err, proc.ErrTimeout):
		why = s.Program + " took longer than " + timeout.String() + " and was stopped."
		out.add(why)
		return StatusError, why
	case err != nil:
		why = s.Program + " couldn't be started: " + err.Error()
		out.add(why)
		return StatusError, why
	case res.OK():
		return StatusPass, ""
	case shimError:
		return StatusError, s.Program + " is installed through mise, but mise can't use it in a fresh checkout (no version is set for it, or the repository's mise.toml isn't trusted). Set a global default with `mise use -g " + s.Program + "@<version>`, or put it on the PATH."
	}
	return StatusFail, ""
}

// worse is the more serious of two statuses: error, then fail, then pass, then skip.
func worse(a, b Status) Status {
	rank := map[Status]int{StatusSkip: 0, StatusPass: 1, StatusWarn: 2, StatusFail: 3, StatusError: 4}
	if rank[b] > rank[a] {
		return b
	}
	return a
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// linkDir makes link point at target: a junction on Windows (a symbolic link needs a privilege there), a
// symbolic link elsewhere. Remove it with os.Remove, which removes the link and nothing it points to.
func linkDir(link, target string) error {
	if runtime.GOOS != "windows" {
		return os.Symlink(target, link)
	}
	cmd := exec.Command(cmdExe(), "/c", "mklink", "/J", link, target) // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command -- both paths are folders devdeck made or the workspace names
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("mklink: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// cmdExe is Windows's own command interpreter by its full path, so no folder on the PATH can stand in for it.
func cmdExe() string {
	root := os.Getenv("SystemRoot")
	if root == "" {
		root = `C:\Windows`
	}
	return filepath.Join(root, "System32", "cmd.exe")
}

// maxOutputLines is how much of a tool's output a result file keeps (the end, where the failure is).
const maxOutputLines = 300

// collector gathers a run's output lines with secrets masked. Both output streams call it.
type collector struct {
	mu     sync.Mutex
	redact logs.Redactor
	lines  []string
}

const maxKeptLines = 2000

func (c *collector) add(line string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lines = append(c.lines, c.redact.Redact(line))
	if len(c.lines) > maxKeptLines {
		c.lines = c.lines[len(c.lines)-maxKeptLines:]
	}
}

func (c *collector) tail(n int) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.lines) <= n {
		return slices.Clone(c.lines)
	}
	return slices.Clone(c.lines[len(c.lines)-n:])
}

// Find locates a program the way a run does.
func (r *Runner) Find(program string) (string, bool) { return r.locate(program) }

// Usable says whether at least one program of a tool is installed, so there is something to run.
func (r *Runner) Usable(t Tool) bool { return Usable(t, r.locate) }
