// Package supervisor starts the services of a stack in order, waits until each
// is ready, watches them, restarts the ones that crash and stops everything
// without leaving processes behind.
package supervisor

import (
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"time"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/workspace"
)

const (
	defaultReadyTimeout = 30 * time.Second
	defaultNodeCmd      = "npm run dev"
)

// ComposeSpec is the Docker Compose file that provides the stack's dependencies.
type ComposeSpec struct {
	ID       string // "compose", or "compose-<repo>" when the stack has several
	Dir      string // the repo folder
	File     string // absolute path of the compose file
	Services []string
	// Logs holds the capture rule of each container, keyed by compose service name.
	Logs map[string]logs.Rule
	// Named is true when the file has an id of its own in the start order. Then it
	// starts after the steps in After, and a service waits for it only if it lists
	// it. Without an id every service waits for it.
	Named bool
	After []string
	// Optional means a failure of this file doesn't hold back what comes after it.
	Optional bool
}

// LogRules lists the capture rules the stack's file sets, keyed by the id the
// log store knows each service by: the service id, or "<compose id>/<container>".
func (sp StackSpec) LogRules() map[string]logs.Rule {
	rules := map[string]logs.Rule{}
	for _, s := range sp.Services {
		if s.Logs.Store != "" {
			rules[s.ID] = s.Logs
		}
	}
	for _, c := range sp.Compose {
		for name, r := range c.Logs {
			rules[c.ID+"/"+name] = r
		}
	}
	return rules
}

// ReadySpec says how to tell a service is ready. All empty means: as soon as it
// has stayed up for a moment.
type ReadySpec struct {
	HTTP string
	TCP  string
	Log  string
}

// ServiceSpec is one service with every path made absolute and every command split.
type ServiceSpec struct {
	ID   string
	Kind string
	Dir  string // where the program runs
	// Package is the Go package to build (kind go).
	Package string
	// Argv is the program and its arguments (every kind except go).
	Argv    []string
	EnvFile string // absolute path, "" when none
	Env     map[string]string
	Port    int
	After   []string
	Ready   ReadySpec
	// ReadyTimeout is how long to wait for ready before giving up.
	ReadyTimeout time.Duration
	Restart      string // never, on-failure or always
	// Logs says which of its output lines are stored (the zero value: all).
	Logs logs.Rule
}

// StackSpec is a stack ready to run.
type StackSpec struct {
	Workspace string
	Name      string
	Root      string
	Compose   []ComposeSpec
	Services  []ServiceSpec

	// WorkspaceFile and Stacks are kept for the pre-start check.
	WorkspaceFile *workspace.WorkspaceFile
	Stacks        []workspace.StackFile
}

// Errors from planning a stack.
var (
	ErrNoSuchStack = errors.New("that stack doesn't exist in this workspace")
	ErrBadStack    = errors.New("the stack can't be started")
)

func bad(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrBadStack, fmt.Sprintf(format, a...))
}

// Plan turns a stack from a checked workspace into something that can run.
// root is the workspace root as an absolute folder. Every path is kept inside
// its repo, and commands are split into a program and arguments.
func Plan(workspaceID, root string, w *workspace.WorkspaceFile, stacks []workspace.StackFile, name string) (StackSpec, error) {
	i := slices.IndexFunc(stacks, func(s workspace.StackFile) bool { return s.Name == name })
	if i < 0 {
		return StackSpec{}, ErrNoSuchStack
	}
	st := stacks[i]

	repoDir := map[string]string{}
	for _, r := range w.Repos {
		dir, ok := workspace.JoinInside(root, r.Path)
		if !ok {
			return StackSpec{}, bad("the path of repo %q leaves the workspace folder", r.ID)
		}
		repoDir[r.ID] = dir
	}

	// The stack's name is the one written in its file, not the caller's string.
	spec := StackSpec{Workspace: workspaceID, Name: st.Name, Root: root, WorkspaceFile: w, Stacks: stacks}

	usedIDs := map[string]bool{}
	for i, c := range st.Compose {
		dir, ok := repoDir[c.Repo]
		if !ok {
			return StackSpec{}, bad("the compose file uses repo %q, which isn't in the workspace", c.Repo)
		}
		file, ok := workspace.JoinInside(dir, c.File)
		if !ok {
			return StackSpec{}, bad("the compose file path leaves its repo")
		}
		id := composeID
		switch {
		case c.ID != "":
			id = c.ID
		case len(st.Compose) > 1:
			id = composeID + "-" + c.Repo
			if usedIDs[id] {
				id += "-" + strconv.Itoa(i+1)
			}
		}
		usedIDs[id] = true
		spec.Compose = append(spec.Compose, ComposeSpec{
			ID: id, Dir: dir, File: file, Services: slices.Clone(c.Services), Logs: maps.Clone(c.Logs),
			Named: c.ID != "", After: slices.Clone(c.After), Optional: c.Optional,
		})
	}

	ids := map[string]bool{}
	for _, c := range spec.Compose {
		if c.Named {
			ids[c.ID] = true // a service may wait for a named compose file
		}
	}
	for _, sv := range st.Services {
		ids[sv.ID] = true
	}
	for _, sv := range st.Services {
		svc, err := planService(sv, repoDir, ids)
		if err != nil {
			return StackSpec{}, err
		}
		spec.Services = append(spec.Services, svc)
	}

	if _, err := spec.Levels(); err != nil {
		return StackSpec{}, bad("%v", err)
	}
	return spec, nil
}

func planService(sv workspace.Service, repoDir map[string]string, ids map[string]bool) (ServiceSpec, error) {
	base, ok := repoDir[sv.Repo]
	if !ok {
		return ServiceSpec{}, bad("service %q uses repo %q, which isn't in the workspace", sv.ID, sv.Repo)
	}
	dir := base
	if sv.Dir != "" {
		if dir, ok = workspace.JoinInside(base, sv.Dir); !ok {
			return ServiceSpec{}, bad("the folder of service %q leaves its repo", sv.ID)
		}
	}
	for _, a := range sv.After {
		if !ids[a] {
			return ServiceSpec{}, bad("service %q waits for %q, which isn't in the stack", sv.ID, a)
		}
	}

	svc := ServiceSpec{
		ID: sv.ID, Kind: sv.Kind, Dir: dir, Port: sv.Port, After: slices.Clone(sv.After),
		Env: sv.Env, Restart: sv.Restart, ReadyTimeout: defaultReadyTimeout,
	}
	if sv.Logs != nil {
		svc.Logs = *sv.Logs
	}
	if svc.Restart == "" {
		svc.Restart = "on-failure"
	}
	if sv.EnvFile != "" {
		if svc.EnvFile, ok = workspace.JoinInside(dir, sv.EnvFile); !ok {
			return ServiceSpec{}, bad("the env file of service %q leaves its folder", sv.ID)
		}
	}
	if err := planCommand(&svc, sv); err != nil {
		return ServiceSpec{}, err
	}
	if err := planReady(&svc, sv); err != nil {
		return ServiceSpec{}, err
	}
	return svc, nil
}

func planCommand(svc *ServiceSpec, sv workspace.Service) error {
	switch sv.Kind {
	case "go":
		svc.Package = sv.Cmd
		if svc.Package == "" {
			svc.Package = "."
		}
		return nil
	case "node", "python", "command":
		cmd := sv.Cmd
		if cmd == "" && sv.Kind == "node" {
			cmd = defaultNodeCmd
		}
		if cmd == "" {
			return bad("service %q has no cmd", sv.ID)
		}
		argv, err := SplitCommand(cmd)
		if err != nil {
			return bad("the cmd of service %q: %v", sv.ID, err)
		}
		svc.Argv = argv
		return nil
	}
	return bad("service %q has an unknown kind %q", sv.ID, sv.Kind)
}

func planReady(svc *ServiceSpec, sv workspace.Service) error {
	if r := sv.Ready; r != nil {
		svc.Ready = ReadySpec{HTTP: r.HTTP, TCP: r.TCP, Log: r.Log}
		if r.Timeout != "" {
			d, err := time.ParseDuration(r.Timeout)
			if err != nil || d <= 0 {
				return bad("the ready timeout of service %q isn't a duration like 30s", sv.ID)
			}
			svc.ReadyTimeout = d
		}
		return nil
	}
	if sv.Port > 0 {
		svc.Ready.TCP = fmt.Sprintf("127.0.0.1:%d", sv.Port)
	}
	return nil
}

// Ordered is true when the stack's compose files have ids: they are steps in the
// start order next to the services. Otherwise every service waits for all of them.
func (sp StackSpec) Ordered() bool {
	for _, c := range sp.Compose {
		if c.Named {
			return true
		}
	}
	return false
}

// step is one thing in the start order: a service, or a named compose file.
type step struct {
	id    string
	after []string
}

// steps lists what the start order is made of. Compose files without an id are
// not in it: they simply come first.
func (sp StackSpec) steps() []step {
	var out []step
	if sp.Ordered() {
		for _, c := range sp.Compose {
			out = append(out, step{c.ID, c.After})
		}
	}
	for _, s := range sp.Services {
		out = append(out, step{s.ID, s.After})
	}
	return out
}

// Levels orders the stack's steps so that each comes after the ones it waits for:
// every inner slice can start together (and, read backwards, stop together). A
// missing dependency or a loop is an error.
func (sp StackSpec) Levels() ([][]string, error) { return levelsOf(sp.steps()) }

// Levels orders services so that each comes after the ones it waits for: every
// inner slice can start together. A missing dependency or a loop is an error.
func Levels(services []ServiceSpec) ([][]string, error) {
	steps := make([]step, len(services))
	for i, s := range services {
		steps[i] = step{s.ID, s.After}
	}
	return levelsOf(steps)
}

func levelsOf(steps []step) ([][]string, error) {
	deps := map[string][]string{}
	for _, s := range steps {
		deps[s.id] = s.after
	}
	placed := map[string]bool{}
	var levels [][]string
	for len(placed) < len(steps) {
		var level []string
		for _, s := range steps {
			if placed[s.id] {
				continue
			}
			ok := true
			for _, d := range deps[s.id] {
				if _, known := deps[d]; !known {
					return nil, fmt.Errorf("%q waits for %q, which isn't in the stack", s.id, d)
				}
				if !placed[d] {
					ok = false
				}
			}
			if ok {
				level = append(level, s.id)
			}
		}
		if len(level) == 0 {
			return nil, errors.New("some steps wait for each other in a loop")
		}
		for _, id := range level {
			placed[id] = true
		}
		levels = append(levels, level)
	}
	return levels, nil
}
