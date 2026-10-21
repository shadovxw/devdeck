// Package doctor checks that a machine is ready to start a workspace: the tools
// its stacks need are installed and new enough, Docker is running, the repo
// folders and env files are there, the ports are free and git knows who you are.
//
// Every check only reads: it runs "--version", "docker info" and "git config",
// looks at files and tries to open a port. Nothing is installed or changed; a
// failed check says what to do and the user does it.
package doctor

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/sdk/proc"
)

// Status is the outcome of one check.
type Status string

const (
	// OK means the check passed.
	OK Status = "ok"
	// Warn means something looks off but a stack can still start.
	Warn Status = "warn"
	// Fail means a stack that needs this will not work.
	Fail Status = "fail"
)

// Groups, in the order the report lists them.
const (
	GroupTools  = "tools"
	GroupRepos  = "repos"
	GroupStacks = "stacks"
	GroupGit    = "git"
)

// Check is one thing that was looked at.
type Check struct {
	ID     string `json:"id"`
	Group  string `json:"group"`
	Title  string `json:"title"`
	Status Status `json:"status"`
	Detail string `json:"detail,omitempty"`
	// Fix is what to do about it: commands to run or a link to open.
	Fix []string `json:"fix,omitempty"`
	// Stack names the stack the check belongs to, when it belongs to one.
	Stack string `json:"stack,omitempty"`
}

// Report is the result of a Doctor run.
type Report struct {
	Workspace string    `json:"workspace"`
	Stack     string    `json:"stack,omitempty"`
	Checks    []Check   `json:"checks"`
	Passed    int       `json:"passed"`
	Warnings  int       `json:"warnings"`
	Failures  int       `json:"failures"`
	CheckedAt time.Time `json:"checked_at"`
}

// Ready reports whether nothing failed. Warnings do not stop a stack.
func (r Report) Ready() bool { return r.Failures == 0 }

// Probes are the few things Doctor asks the machine. Tests replace them.
type Probes struct {
	// Tool checks one binary: installed and new enough.
	Tool func(ctx context.Context, n sdk.Need) sdk.ToolStatus
	// DockerUp returns nil when the Docker engine answers.
	DockerUp func(ctx context.Context) error
	// PortFree reports whether nothing is listening on the loopback port.
	PortFree func(port int) bool
	// Dial reports whether a connection to the loopback host:port is accepted.
	Dial func(ctx context.Context, addr string) bool
	// GitConfig returns a git setting, "" when it is not set. dir "" means the global config.
	GitConfig func(ctx context.Context, dir, key string) string
}

// DefaultProbes asks the real machine.
func DefaultProbes() Probes {
	return Probes{
		Tool: func(ctx context.Context, n sdk.Need) sdk.ToolStatus { return sdk.CheckNeeds(ctx, []sdk.Need{n}) },
		DockerUp: func(ctx context.Context) error {
			res, err := proc.Run(ctx, proc.Cmd{Name: "docker", Args: []string{"info", "--format", "{{.ServerVersion}}"}, Timeout: 8 * time.Second})
			if err != nil {
				return err
			}
			if !res.OK() {
				return fmt.Errorf("docker info exited with code %d", res.ExitCode)
			}
			return nil
		},
		PortFree: portFree,
		GitConfig: func(ctx context.Context, dir, key string) string {
			args := []string{"config", "--get", key}
			if dir == "" {
				args = []string{"config", "--global", "--get", key}
			} else {
				args = append([]string{"-C", dir}, args...)
			}
			res, err := proc.Run(ctx, proc.Cmd{Name: "git", Args: args, Timeout: 5 * time.Second})
			if err != nil || !res.OK() {
				return ""
			}
			return strings.TrimSpace(res.Stdout)
		},
		Dial: dial,
	}
}

// Input is what Run looks at.
type Input struct {
	// Name is the workspace id shown in the report.
	Name      string
	Workspace *workspace.WorkspaceFile
	Stacks    []workspace.StackFile
	// Stack limits the run to one stack by name. Empty checks the whole workspace.
	Stack string
	// Root is the workspace root as an absolute folder.
	Root string
	// Plugins supplies install hints for tools that have a plugin. May be nil.
	Plugins *sdk.Registry
	// OwnPorts are ports held by services devdeck itself is running, so they don't count as taken.
	OwnPorts map[int]bool
	Probes   Probes
}

// ErrNoSuchStack is returned when Input.Stack names a stack the workspace lacks.
var ErrNoSuchStack = errors.New("that stack doesn't exist in this workspace")

// Run performs every check that applies and returns the report. Checks run in
// parallel; the report keeps a stable order.
func Run(ctx context.Context, in Input) (Report, error) {
	if in.Workspace == nil {
		return Report{}, fmt.Errorf("the workspace has errors, so there is nothing to check")
	}
	p := withDefaults(in.Probes)
	stacks := in.Stacks
	if in.Stack != "" {
		stacks = nil
		for _, s := range in.Stacks {
			if s.Name == in.Stack {
				stacks = append(stacks, s)
			}
		}
		if len(stacks) == 0 {
			return Report{}, ErrNoSuchStack
		}
	}

	b := &builder{in: in, p: p, stacks: stacks, repos: map[string]workspace.Repo{}}
	for _, r := range in.Workspace.Repos {
		b.repos[r.ID] = r
	}
	jobs := b.jobs()

	checks := make([]Check, len(jobs))
	var wg sync.WaitGroup
	for i, job := range jobs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			checks[i] = job(ctx)
		}()
	}
	wg.Wait()

	rep := Report{Workspace: in.Name, Stack: in.Stack, Checks: checks, CheckedAt: time.Now()}
	for _, c := range checks {
		switch c.Status {
		case OK:
			rep.Passed++
		case Warn:
			rep.Warnings++
		case Fail:
			rep.Failures++
		}
	}
	return rep, nil
}

func withDefaults(p Probes) Probes {
	d := DefaultProbes()
	if p.Tool == nil {
		p.Tool = d.Tool
	}
	if p.DockerUp == nil {
		p.DockerUp = d.DockerUp
	}
	if p.Dial == nil {
		p.Dial = d.Dial
	}
	if p.PortFree == nil {
		p.PortFree = d.PortFree
	}
	if p.GitConfig == nil {
		p.GitConfig = d.GitConfig
	}
	return p
}

type job func(ctx context.Context) Check

type builder struct {
	in     Input
	p      Probes
	stacks []workspace.StackFile
	repos  map[string]workspace.Repo
}

func (b *builder) jobs() []job {
	var jobs []job
	jobs = append(jobs, b.toolJobs()...)
	jobs = append(jobs, b.repoJobs()...)
	jobs = append(jobs, b.stackJobs()...)
	jobs = append(jobs, b.gitJobs()...)
	return jobs
}

// repoDir is the repo's folder, or false when the path would leave the workspace root.
func (b *builder) repoDir(r workspace.Repo) (string, bool) {
	return inside(b.in.Root, r.Path)
}

// inside joins rel to base and reports false if the result is not under base.
func inside(base, rel string) (string, bool) { return workspace.JoinInside(base, rel) }

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

// portFree reports whether nothing holds the loopback port. Binding alone is
// not enough: on Windows a program listening on all addresses (0.0.0.0) does not
// stop a bind to 127.0.0.1, so a connection attempt is made as well.
func portFree(port int) bool {
	addr := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	if c, err := net.DialTimeout("tcp", addr, 300*time.Millisecond); err == nil {
		_ = c.Close()
		return false
	}
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return false
	}
	_ = l.Close()
	return true
}
