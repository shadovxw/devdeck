package gitx

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// Work is where a repository stands: its branch, how it compares with its upstream and
// how many files have changes.
type Work struct {
	// Branch is the current branch ("" when HEAD is detached).
	Branch   string `json:"branch"`
	Detached bool   `json:"detached"`
	// Upstream is the branch this one tracks, such as origin/main ("" when it tracks none).
	Upstream string `json:"upstream"`
	Ahead    int    `json:"ahead"`
	Behind   int    `json:"behind"`
	// Changed counts the files that are modified, staged, in conflict or untracked.
	Changed int `json:"changed"`
}

// ParseWork reads the output of `git status --porcelain=v2 --branch`.
func ParseWork(out string) Work {
	var w Work
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		switch {
		case strings.HasPrefix(line, "# branch.head "):
			if head := strings.TrimPrefix(line, "# branch.head "); head == "(detached)" {
				w.Detached = true
			} else {
				w.Branch = head
			}
		case strings.HasPrefix(line, "# branch.upstream "):
			w.Upstream = strings.TrimPrefix(line, "# branch.upstream ")
		case strings.HasPrefix(line, "# branch.ab "):
			// "+<ahead> -<behind>"
			for _, f := range strings.Fields(strings.TrimPrefix(line, "# branch.ab ")) {
				n, err := strconv.Atoi(f[1:])
				if err != nil {
					continue
				}
				switch f[0] {
				case '+':
					w.Ahead = n
				case '-':
					w.Behind = n
				}
			}
		case strings.HasPrefix(line, "1 "), strings.HasPrefix(line, "2 "), strings.HasPrefix(line, "u "), strings.HasPrefix(line, "? "):
			w.Changed++
		}
	}
	return w
}

// Work asks git where the repository in dir stands.
func (g Git) Work(ctx context.Context, dir string) (Work, error) {
	out, code, err := g.run(ctx, dir, "status", "--porcelain=v2", "--branch")
	if err != nil || code != 0 {
		return Work{}, fmt.Errorf("git couldn't read the status of %s", dir)
	}
	return ParseWork(out), nil
}

// Head is the commit the repository in dir has checked out, as the full hash.
func (g Git) Head(ctx context.Context, dir string) (string, error) {
	out, code, err := g.run(ctx, dir, "rev-parse", "HEAD")
	if err != nil || code != 0 || out == "" {
		return "", fmt.Errorf("git couldn't read the current commit of %s", dir)
	}
	return out, nil
}

// The operations devdeck runs. Each has one fixed command, shown before it runs.
const (
	OpFetch = "fetch"
	OpPull  = "pull"
	OpPush  = "push"
)

// ErrNothingToDo is returned when an operation has no point right now.
var ErrNothingToDo = errors.New("nothing to do")

// Operation is a git command devdeck can run in a repository.
type Operation struct {
	Name string
	Args []string
	// Command is the command as you would type it, with the folder named, for showing and copying.
	Command string
	// Timeout is how long it may take.
	Timeout time.Duration
}

func display(dir string, args ...string) string {
	return `git -C "` + filepath.ToSlash(dir) + `" ` + strings.Join(args, " ")
}

// Plan builds the operation named op for the repository in dir, given where it stands.
// A refusal says why the operation can't run (no upstream to pull from, a detached HEAD).
func Plan(op, dir string, w Work) (Operation, error) {
	var args []string
	switch op {
	case OpFetch:
		args = []string{"fetch", "--prune", "origin"}
	case OpPull:
		switch {
		case w.Detached:
			return Operation{}, errors.New("HEAD is detached: check out a branch first")
		case w.Upstream == "":
			return Operation{}, errors.New("this branch tracks no upstream branch, so there is nothing to pull from")
		}
		args = []string{"pull", "--ff-only"}
	case OpPush:
		switch {
		case w.Detached:
			return Operation{}, errors.New("HEAD is detached: check out a branch before pushing")
		case w.Upstream == "":
			args = []string{"push", "-u", "origin", w.Branch}
		case w.Ahead == 0:
			return Operation{}, fmt.Errorf("%w: no commits are waiting to be pushed", ErrNothingToDo)
		default:
			args = []string{"push"}
		}
	default:
		return Operation{}, fmt.Errorf("unknown operation %q", op)
	}
	return Operation{Name: op, Args: args, Command: display(dir, args...), Timeout: 2 * time.Minute}, nil
}

// Commands are the commands the page offers for a repository, as strings to copy. An
// operation that can't run right now is left out.
func Commands(dir string, w Work) map[string]string {
	cmds := map[string]string{}
	for _, name := range []string{OpFetch, OpPull, OpPush} {
		if op, err := Plan(name, dir, w); err == nil {
			cmds[name] = op.Command
		}
	}
	return cmds
}

// noPrompt makes git and Git Credential Manager fail instead of asking, since nobody is
// at the terminal the server runs in.
var noPrompt = []string{"GIT_TERMINAL_PROMPT=0", "GCM_INTERACTIVE=never"}

const maxOutput = 4096

// tail keeps the end of what git printed, where the reason is.
func tail(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > maxOutput {
		s = "…" + s[len(s)-maxOutput:]
	}
	return s
}

// Run runs the operation in dir and returns what git printed. A failure carries git's own message.
func (g Git) Run(ctx context.Context, dir string, op Operation) (string, error) {
	return g.exec(ctx, op.Name, op.Timeout, append([]string{"-C", dir}, op.Args...)...)
}

// exec runs git with args; verb names the operation in an error.
func (g Git) exec(ctx context.Context, verb string, timeout time.Duration, args ...string) (string, error) {
	name := g.Path
	if name == "" {
		name = "git"
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: name, Args: args, Env: append(append([]string{}, g.Env...), noPrompt...), Timeout: timeout})
	if err != nil {
		return "", fmt.Errorf("git %s: %w", verb, err)
	}
	out := tail(res.Stderr + "\n" + res.Stdout)
	if !res.OK() {
		if out == "" {
			out = "exit code " + strconv.Itoa(res.ExitCode)
		}
		return "", fmt.Errorf("git %s failed: %s", verb, out)
	}
	return out, nil
}

// CloneAddress checks that raw is an https address on github.com and returns it without
// credentials. Anything else (ssh, another host, a local path, an option) is refused.
func CloneAddress(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || !strings.EqualFold(u.Hostname(), Host) {
		return "", false
	}
	if _, ok := ParseRemote(raw); !ok {
		return "", false
	}
	return StripCredentials(raw), true
}

// CloneCommand is the command Clone runs, as you would type it.
func CloneCommand(remote, dir string) string {
	return `git clone -- "` + remote + `" "` + filepath.ToSlash(dir) + `"`
}

// Clone clones remote into dir, which must not exist or must be empty, then writes the
// connection's identity (when there is one) into the new repository.
func (g Git) Clone(ctx context.Context, remote, dir string, cn *Connection) (string, error) {
	if entries, err := os.ReadDir(dir); err == nil && len(entries) > 0 {
		return "", fmt.Errorf("%s already has files in it", dir)
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o750); err != nil {
		return "", fmt.Errorf("the folder for %s couldn't be made: %w", dir, err)
	}
	out, err := g.exec(ctx, "clone", 10*time.Minute, "clone", "--", remote, dir)
	if err != nil {
		return "", err
	}
	if cn != nil && (cn.Name != "" || cn.Email != "") {
		if err := g.ApplyIdentity(ctx, dir, *cn); err != nil {
			return out, fmt.Errorf("cloned, but %w", err)
		}
	}
	return out, nil
}
