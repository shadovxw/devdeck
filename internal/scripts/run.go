package scripts

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// States of a run, a repo in it, and a step.
const (
	StateWaiting = "waiting"
	StateRunning = "running"
	StateOK      = "ok"
	StateSkipped = "skipped"
	StateFailed  = "failed"
)

// Repo is a repo a script runs in.
type Repo struct {
	ID  string
	Dir string
}

// Git is what a run needs from git (gitx.Git has it).
type Git interface {
	Work(ctx context.Context, dir string) (gitx.Work, error)
	Run(ctx context.Context, dir string, op gitx.Operation) (string, error)
}

// Exec runs a program in dir and returns what it printed (the end of it). A failure says why.
type Exec func(ctx context.Context, dir string, args []string) (string, error)

// StepResult is one step in one repo.
type StepResult struct {
	Label  string `json:"label"`
	State  string `json:"state"`
	Output string `json:"output,omitempty"`
}

// RepoResult is one repo of a run.
type RepoResult struct {
	Repo   string       `json:"repo"`
	State  string       `json:"state"`
	Reason string       `json:"reason,omitempty"`
	Steps  []StepResult `json:"steps"`
}

// Run is one run of a script: where it is, and each repo's steps.
type Run struct {
	ID        string       `json:"id"`
	Workspace string       `json:"workspace"`
	Script    string       `json:"script"`
	Title     string       `json:"title"`
	State     string       `json:"state"`
	Started   time.Time    `json:"started_at"`
	Finished  *time.Time   `json:"finished_at,omitempty"`
	Repos     []RepoResult `json:"repos"`
}

// Summary is the run in a line: "4 repos · 3 ok · 1 skipped".
func (r Run) Summary() string {
	n := map[string]int{}
	for _, rr := range r.Repos {
		n[rr.State]++
	}
	parts := []string{plural(len(r.Repos), "repo", "repos")}
	for _, s := range []string{StateOK, StateSkipped, StateFailed} {
		if n[s] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n[s], s))
		}
	}
	return strings.Join(parts, " · ")
}

func plural(n int, one, many string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, one)
	}
	return fmt.Sprintf("%d %s", n, many)
}

// Targets are the repos a script runs in: its one repo, or every repo for a script that runs
// for each repo or has only git steps.
func Targets(s Script, repos []Repo) []Repo {
	if s.Repo != "" {
		for _, r := range repos {
			if r.ID == s.Repo {
				return []Repo{r}
			}
		}
		return nil
	}
	if s.ForEach == "repo" || allGit(s) {
		return repos
	}
	if len(repos) > 0 {
		return repos[:1]
	}
	return nil
}

func allGit(s Script) bool {
	for _, st := range s.Steps {
		if st.Git == "" {
			return false
		}
	}
	return true
}

// errDirty is why a repo is skipped before a step that would change its files.
var errDirty = errors.New("it has uncommitted changes, so it was left as it is")

// Runner runs scripts and keeps the latest runs.
type Runner struct {
	Git  Git
	Exec Exec
	// Keep is how many finished runs are remembered (20 when zero).
	Keep int

	mu    sync.Mutex
	runs  map[string]*Run
	order []string
}

// Start begins a run of s over repos and returns it at once; Get follows it.
func (rn *Runner) Start(workspace string, s Script, repos []Repo) Run {
	run := &Run{ID: newID(), Workspace: workspace, Script: s.ID, Title: s.Name(), State: StateRunning, Started: time.Now().UTC()}
	for _, r := range Targets(s, repos) {
		rr := RepoResult{Repo: r.ID, State: StateWaiting}
		for _, st := range s.Steps {
			rr.Steps = append(rr.Steps, StepResult{Label: st.Label(), State: StateWaiting})
		}
		run.Repos = append(run.Repos, rr)
	}
	rn.mu.Lock()
	if rn.runs == nil {
		rn.runs = map[string]*Run{}
	}
	rn.runs[run.ID] = run
	rn.order = append(rn.order, run.ID)
	rn.trim()
	snapshot := copyRun(run)
	rn.mu.Unlock()

	targets := Targets(s, repos)
	go rn.execute(context.Background(), run, s, targets)
	return snapshot
}

// Get returns a run as it stands.
func (rn *Runner) Get(id string) (Run, bool) {
	rn.mu.Lock()
	defer rn.mu.Unlock()
	r, ok := rn.runs[id]
	if !ok {
		return Run{}, false
	}
	return copyRun(r), true
}

// Latest is the last run of each script of a workspace, by script id.
func (rn *Runner) Latest(workspace string) map[string]Run {
	rn.mu.Lock()
	defer rn.mu.Unlock()
	out := map[string]Run{}
	for _, id := range rn.order {
		if r := rn.runs[id]; r != nil && r.Workspace == workspace {
			out[r.Script] = copyRun(r)
		}
	}
	return out
}

func (rn *Runner) trim() {
	keep := rn.Keep
	if keep <= 0 {
		keep = 20
	}
	for len(rn.order) > keep {
		old := rn.runs[rn.order[0]]
		if old != nil && old.State == StateRunning {
			break // never forget a run that is still going
		}
		delete(rn.runs, rn.order[0])
		rn.order = rn.order[1:]
	}
}

// execute runs the steps repo after repo, writing each result into run as it goes.
func (rn *Runner) execute(ctx context.Context, run *Run, s Script, targets []Repo) {
	for i, repo := range targets {
		rn.set(run, func() { run.Repos[i].State = StateRunning })
		state, reason := rn.repo(ctx, run, i, s, repo)
		rn.set(run, func() {
			run.Repos[i].State = state
			run.Repos[i].Reason = reason
		})
	}
	rn.set(run, func() {
		now := time.Now().UTC()
		run.Finished = &now
		run.State = StateOK
		for _, rr := range run.Repos {
			if rr.State == StateFailed {
				run.State = StateFailed
			}
		}
	})
}

// repo runs every step in one repo. A dirty repo is skipped before the first step that would
// change its files; a failed step stops the repo there.
func (rn *Runner) repo(ctx context.Context, run *Run, i int, s Script, repo Repo) (string, string) {
	for j, st := range s.Steps {
		rn.set(run, func() { run.Repos[i].Steps[j].State = StateRunning })
		out, err := rn.step(ctx, repo, st)
		if errors.Is(err, errDirty) {
			rn.set(run, func() {
				for k := j; k < len(run.Repos[i].Steps); k++ {
					run.Repos[i].Steps[k].State = StateSkipped
				}
			})
			return StateSkipped, err.Error()
		}
		rn.set(run, func() {
			run.Repos[i].Steps[j].Output = out
			run.Repos[i].Steps[j].State = StateOK
			if err != nil {
				run.Repos[i].Steps[j].State = StateFailed
				run.Repos[i].Steps[j].Output = err.Error()
			}
		})
		if err != nil {
			rn.set(run, func() {
				for k := j + 1; k < len(run.Repos[i].Steps); k++ {
					run.Repos[i].Steps[k].State = StateSkipped
				}
			})
			return StateFailed, "step " + st.Label() + " failed"
		}
	}
	return StateOK, ""
}

// step runs one step in one repo.
func (rn *Runner) step(ctx context.Context, repo Repo, st Step) (string, error) {
	if st.Run != "" {
		args, err := proc.SplitCommand(st.Run)
		if err != nil {
			return "", err
		}
		if len(args) == 0 {
			return "", errors.New("the command is empty")
		}
		return rn.exec()(ctx, repo.Dir, args)
	}
	w, err := rn.Git.Work(ctx, repo.Dir)
	if err != nil {
		return "", err
	}
	if st.changes() && w.Changed > 0 {
		return "", errDirty
	}
	switch st.Git {
	case GitStatus:
		return describe(w), nil
	case GitCheckout:
		if w.Branch == st.Branch {
			return "already on " + st.Branch, nil
		}
		op := gitx.Operation{Name: GitCheckout, Args: []string{"checkout", st.Branch}, Timeout: time.Minute}
		return rn.Git.Run(ctx, repo.Dir, op)
	default:
		op, err := gitx.Plan(st.Git, repo.Dir, w)
		if err != nil {
			return "", err
		}
		return rn.Git.Run(ctx, repo.Dir, op)
	}
}

// describe is where a repo stands in a line: "dev · 2 behind · 3 changed".
func describe(w gitx.Work) string {
	head := w.Branch
	if w.Detached {
		head = "detached"
	}
	parts := []string{head}
	if w.Ahead > 0 {
		parts = append(parts, fmt.Sprintf("%d ahead", w.Ahead))
	}
	if w.Behind > 0 {
		parts = append(parts, fmt.Sprintf("%d behind", w.Behind))
	}
	if w.Changed > 0 {
		parts = append(parts, fmt.Sprintf("%d changed", w.Changed))
	}
	if len(parts) == 1 {
		parts = append(parts, "clean")
	}
	return strings.Join(parts, " · ")
}

func (rn *Runner) set(run *Run, f func()) {
	rn.mu.Lock()
	defer rn.mu.Unlock()
	f()
}

func (rn *Runner) exec() Exec {
	if rn.Exec != nil {
		return rn.Exec
	}
	return runCommand
}

// runCommand runs a program in dir, without a shell, for up to ten minutes.
func runCommand(ctx context.Context, dir string, args []string) (string, error) {
	res, err := proc.Run(ctx, proc.Cmd{Name: args[0], Args: args[1:], Dir: dir, Timeout: 10 * time.Minute})
	if err != nil {
		return "", err
	}
	out := tail(res.Stdout + "\n" + res.Stderr)
	if !res.OK() {
		return "", fmt.Errorf("exit code %d: %s", res.ExitCode, out)
	}
	return out, nil
}

const maxOutput = 4096

// tail keeps the end of the output, where the result and any error are.
func tail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxOutput {
		return "…" + s[len(s)-maxOutput:]
	}
	return s
}

func copyRun(r *Run) Run {
	c := *r
	c.Repos = make([]RepoResult, len(r.Repos))
	for i, rr := range r.Repos {
		c.Repos[i] = rr
		c.Repos[i].Steps = append([]StepResult(nil), rr.Steps...)
	}
	return c
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
