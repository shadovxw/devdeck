// Package cli is devdeck's command line: up, down and status. It calls the API
// of the running server, because the server's supervisor owns the processes of
// a stack and stops them when it closes.
package cli

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// Exit codes.
const (
	exitOK    = 0
	exitFail  = 1
	exitUsage = 2
	exitStop  = 130 // interrupted
)

// Commands are the words the program treats as the command line instead of the server.
var Commands = []string{"up", "down", "status", "help"}

const usage = `Usage:
  devdeck                         run the server
  devdeck up <stack> [flags]      start a stack and wait until it is ready
  devdeck down <stack> [flags]    stop a stack
  devdeck status                  show the stacks that are running

Flags for up and down:
  -w <workspace>                  workspace id (default: your only workspace)
Flags for up:
  --detach                        don't wait for the stack to be ready

The commands talk to the running server (DEVDECK_ADDR, default 127.0.0.1:7070).

git calls this one itself (set it up on the Connections page; you don't run it):
  devdeck git-credential <get|store|erase>
`

// Env is what the commands read and write. Tests replace the parts they need.
type Env struct {
	Getenv func(string) string
	Stdout io.Writer
	Stderr io.Writer
	// Client is used for every call. Nil means a plain http.Client.
	Client *http.Client
	// Poll is how often `up` asks the server for progress. Zero means 500 ms.
	Poll time.Duration
	// Now gives the time `status` measures uptime against. Nil means time.Now.
	Now func() time.Time
}

type app struct {
	env Env
	api *client
}

// Run runs one command and returns the exit code: 0 done, 1 failed, 2 wrong
// usage, 130 interrupted. args excludes the program name.
func Run(ctx context.Context, args []string, env Env) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		_, _ = io.WriteString(env.Stdout, usage)
		return exitOK
	}

	addr, err := config.ListenAddr(env.Getenv)
	if err != nil {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck:", err)
		return exitUsage
	}
	hc := env.Client
	if hc == nil {
		hc = &http.Client{}
	}
	if env.Poll <= 0 {
		env.Poll = 500 * time.Millisecond
	}
	if env.Now == nil {
		env.Now = time.Now
	}
	// The server only listens on a loopback address (ListenAddr checked it), so plain HTTP never leaves the machine.
	base := url.URL{Scheme: "http", Host: addr}
	a := &app{env: env, api: &client{base: base.String(), http: hc}}

	switch args[0] {
	case "up":
		return a.up(ctx, args[1:])
	case "down":
		return a.down(ctx, args[1:])
	case "status":
		return a.status(ctx, args[1:])
	}
	a.errorf("unknown command %q\n\n%s", args[0], usage)
	return exitUsage
}

func (a *app) printf(format string, v ...any) { _, _ = fmt.Fprintf(a.env.Stdout, format, v...) }
func (a *app) errorf(format string, v ...any) { _, _ = fmt.Fprintf(a.env.Stderr, format, v...) }

// flags parses args that may mix flags and the one stack name, in any order
// (`up full -w demo` and `up -w demo full` both work).
func (a *app) flags(fs *flag.FlagSet, args []string) (positional []string, code int, ok bool) {
	fs.SetOutput(a.env.Stderr)
	fs.Usage = func() { a.errorf("%s", usage) }
	for {
		if err := fs.Parse(args); err != nil {
			if errors.Is(err, flag.ErrHelp) {
				return nil, exitOK, false
			}
			return nil, exitUsage, false
		}
		if fs.NArg() == 0 {
			return positional, exitOK, true
		}
		positional = append(positional, fs.Arg(0))
		args = fs.Args()[1:]
	}
}

// stackArgs parses `<stack> -w <workspace>` and resolves the workspace.
func (a *app) stackArgs(ctx context.Context, name string, args []string, extra func(*flag.FlagSet)) (ws, stack string, code int, ok bool) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	wsFlag := fs.String("w", "", "workspace id")
	if extra != nil {
		extra(fs)
	}
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return "", "", code, false
	}
	if len(pos) != 1 {
		a.errorf("devdeck %s needs exactly one stack name\n\n%s", name, usage)
		return "", "", exitUsage, false
	}
	ws, code, ok = a.workspace(ctx, *wsFlag)
	return ws, pos[0], code, ok
}

// workspace returns the id to use: the one given, or the only workspace of the user's own.
func (a *app) workspace(ctx context.Context, given string) (string, int, bool) {
	if given != "" {
		return given, exitOK, true
	}
	all, err := a.api.workspaces(ctx)
	if err != nil {
		return "", a.fail(err), false
	}
	var own []string
	for _, w := range all {
		if w.Source == workspace.SourceLocal {
			own = append(own, w.ID)
		}
	}
	switch len(own) {
	case 1:
		return own[0], exitOK, true
	case 0:
		a.errorf("devdeck: you have no workspace yet: add one in the browser first\n")
		return "", exitFail, false
	}
	a.errorf("devdeck: you have several workspaces, pick one with -w: %s\n", strings.Join(own, ", "))
	return "", exitUsage, false
}

// fail prints an error in plain words and returns the exit code for it.
func (a *app) fail(err error) int {
	var ae *apiError
	switch {
	case errors.Is(err, context.Canceled):
		return exitStop
	case errors.Is(err, errNotRunning):
		a.errorf("devdeck: %v: start it first with `devdeck`\n", err)
	case errors.As(err, &ae) && ae.Report != nil:
		a.errorf("devdeck: %s\n", ae.Message)
		a.printFailedChecks(*ae.Report)
	default:
		a.errorf("devdeck: %v\n", err)
	}
	return exitFail
}

func (a *app) printFailedChecks(r doctor.Report) {
	for _, c := range r.Checks {
		if c.Status != doctor.Fail {
			continue
		}
		a.errorf("  x %s", c.Title)
		if c.Detail != "" {
			a.errorf(": %s", oneLine(c.Detail))
		}
		a.errorf("\n")
		for _, f := range c.Fix {
			a.errorf("      %s\n", oneLine(f))
		}
	}
}

func (a *app) up(ctx context.Context, args []string) int {
	var detach *bool
	ws, stack, code, ok := a.stackArgs(ctx, "up", args, func(fs *flag.FlagSet) {
		detach = fs.Bool("detach", false, "don't wait for the stack to be ready")
	})
	if !ok {
		return code
	}

	err := a.api.start(ctx, ws, stack)
	var ae *apiError
	switch {
	case errors.As(err, &ae) && ae.Status == http.StatusConflict:
		a.printf("%s/%s is already running\n", ws, stack)
	case err != nil:
		return a.fail(err)
	default:
		a.printf("starting %s/%s\n", ws, stack)
	}
	if *detach {
		return exitOK
	}
	return a.follow(ctx, ws, stack)
}

// follow prints each service's state as it changes, until the stack is running
// or can't get there.
func (a *app) follow(ctx context.Context, ws, stack string) int {
	shown := map[string]string{}
	for {
		runs, err := a.api.runs(ctx)
		if err != nil {
			if code := a.fail(err); code == exitStop {
				a.printf("\nstill starting in the background: `devdeck down %s` stops it\n", stack)
				return code
			}
			return exitFail
		}
		run := findRun(runs, ws, stack)
		if run == nil || run.State == supervisor.RunStopping || run.State == supervisor.RunStopped {
			a.errorf("devdeck: %s/%s was stopped before it was ready\n", ws, stack)
			return exitFail
		}

		for _, s := range run.Services {
			line := serviceLine(s)
			if shown[s.ID] != line {
				shown[s.ID] = line
				a.printf("  %s\n", line)
			}
		}

		if settled(run) {
			return a.summary(run, ws, stack)
		}
		select {
		case <-ctx.Done():
			a.printf("\nstill starting in the background: `devdeck down %s` stops it\n", stack)
			return exitStop
		case <-time.After(a.env.Poll):
		}
	}
}

func (a *app) summary(run *supervisor.RunStatus, ws, stack string) int {
	var bad, skipped []string
	for _, s := range run.Services {
		if s.State != supervisor.StateFailed && s.State != supervisor.StateBlocked {
			continue
		}
		if s.Optional {
			skipped = append(skipped, s.ID) // optional: what came after it carried on
		} else {
			bad = append(bad, s.ID)
		}
	}
	if len(bad) == 0 {
		a.printf("%s/%s is running\n", ws, stack)
		if len(skipped) > 0 {
			a.errorf("devdeck: optional and didn't start: %s\n", strings.Join(skipped, ", "))
		}
		return exitOK
	}
	a.errorf("devdeck: %s/%s didn't start: %s\n", ws, stack, strings.Join(bad, ", "))
	return exitFail
}

// settled is true when no service can still change by itself: each one is
// ready, or has failed, been blocked or stopped. A restarting service is not
// settled, because it may recover (or give up and fail).
func settled(run *supervisor.RunStatus) bool {
	for _, s := range run.Services {
		switch s.State {
		case supervisor.StateReady, supervisor.StateFailed, supervisor.StateBlocked, supervisor.StateStopped:
		default:
			return false
		}
	}
	return true
}

func (a *app) down(ctx context.Context, args []string) int {
	ws, stack, code, ok := a.stackArgs(ctx, "down", args, nil)
	if !ok {
		return code
	}
	a.printf("stopping %s/%s\n", ws, stack)
	if err := a.api.stop(ctx, ws, stack); err != nil {
		var ae *apiError
		if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
			a.errorf("devdeck: %s/%s isn't running\n", ws, stack)
			return exitFail
		}
		return a.fail(err)
	}
	a.printf("%s/%s is stopped\n", ws, stack)
	return exitOK
}

func (a *app) status(ctx context.Context, args []string) int {
	fs := flag.NewFlagSet("status", flag.ContinueOnError)
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return code
	}
	if len(pos) != 0 {
		a.errorf("devdeck status takes no arguments\n\n%s", usage)
		return exitUsage
	}
	runs, err := a.api.runs(ctx)
	if err != nil {
		return a.fail(err)
	}
	if len(runs) == 0 {
		a.printf("no stacks are running\n")
		return exitOK
	}
	for _, r := range runs {
		a.printf("%s/%s  %s  up %s\n", r.Workspace, r.Stack, r.State, formatUptime(a.env.Now().Sub(r.StartedAt)))
		for _, s := range r.Services {
			a.printf("  %s\n", serviceLine(s))
		}
	}
	return exitOK
}

func findRun(runs []supervisor.RunStatus, ws, stack string) *supervisor.RunStatus {
	for i := range runs {
		if runs[i].Workspace == ws && runs[i].Stack == stack {
			return &runs[i]
		}
	}
	return nil
}

// serviceLine is "<id>  <state>" plus the port, restarts and reason when there are any.
func serviceLine(s supervisor.ServiceStatus) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%-14s %s", s.ID, s.State)
	if s.Port != 0 {
		fmt.Fprintf(&b, "  :%d", s.Port)
	}
	if s.Restarts > 0 {
		fmt.Fprintf(&b, "  restarts %d", s.Restarts)
	}
	if s.LastError != "" && s.State != supervisor.StateReady {
		fmt.Fprintf(&b, "  %s", oneLine(s.LastError))
	}
	return b.String()
}

// ansi matches the colour codes that tools like Vite put in their output.
var ansi = regexp.MustCompile(`\x1b\[[0-9;]*[A-Za-z]`)

// oneLine puts text on one line and cuts it short: a service's error can be a
// whole block of its output.
func oneLine(s string) string {
	const limit = 160
	s = ansi.ReplaceAllString(s, "")
	s = strings.Join(strings.Fields(s), " ")
	if r := []rune(s); len(r) > limit {
		s = string(r[:limit]) + "…"
	}
	return s
}

func formatUptime(d time.Duration) string {
	d = d.Round(time.Second)
	switch {
	case d < 0:
		return "0s"
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
	}
	return fmt.Sprintf("%dh%02dm", int(d.Hours()), int(d.Minutes())%60)
}
