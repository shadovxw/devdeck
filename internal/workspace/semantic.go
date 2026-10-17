package workspace

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// Options tune a check.
type Options struct {
	// CheckPaths also looks at the folders on disk and warns about missing ones.
	// Off for examples and for text that hasn't been saved.
	CheckPaths bool
	// KnownPlugins are the installed plugin ids. A flow step that names another
	// plugin gets a warning. Nil skips the check.
	KnownPlugins []string
}

func (p *parsed) warn(path, msg string) Issue {
	i := p.issue(path, msg)
	i.Severity = SeverityWarning
	return i
}

var (
	secretName = regexp.MustCompile(`(?i)(token|passw(or)?d|secret|api[_-]?key|private[_-]?key)`)
	envRef     = regexp.MustCompile(`^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$`)
	urlCreds   = regexp.MustCompile(`://[^/@\s]+@`)
	hostPort   = regexp.MustCompile(`^[^:\s/]+:[0-9]{1,5}$`)
)

func ids[T any](items []T, id func(T) string) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, id(it))
	}
	return out
}

func list(names []string) string {
	s := slices.Clone(names)
	sort.Strings(s)
	if len(s) == 0 {
		return "none yet"
	}
	return strings.Join(s, ", ")
}

// insideRoot reports whether a relative path stays inside its folder.
func insideRoot(rel string) bool {
	if filepath.IsAbs(rel) || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, `\`) {
		return false
	}
	clean := filepath.ToSlash(filepath.Clean(rel))
	return clean != ".." && !strings.HasPrefix(clean, "../")
}

func checkWorkspace(p *parsed, w *WorkspaceFile) []Issue {
	var out []Issue

	connIDs := map[string]bool{}
	for i, c := range w.Connections {
		path := fmt.Sprintf("/connections/%d", i)
		if connIDs[c.ID] {
			out = append(out, p.issue(path+"/id", fmt.Sprintf("Connection id %q is used more than once.", c.ID)))
		}
		connIDs[c.ID] = true
		for key, val := range c.Settings {
			if secretName.MatchString(key) && val != "" && !envRef.MatchString(val) {
				out = append(out, p.issue(path+"/settings/"+escape(key),
					fmt.Sprintf("%q looks like a secret. Secrets never go in YAML: devdeck keeps them in your OS keychain.", key)))
			}
		}
	}
	missingConn := func(path, id string) {
		out = append(out, p.issue(path, fmt.Sprintf("There is no connection with id %q. Defined: %s.", id, list(ids(w.Connections, func(c Connection) string { return c.ID })))))
	}
	if w.DefaultConnection != "" && !connIDs[w.DefaultConnection] {
		missingConn("/default_connection", w.DefaultConnection)
	}
	for i, r := range w.AccountRules {
		if !connIDs[r.Connection] {
			missingConn(fmt.Sprintf("/account_rules/%d/connection", i), r.Connection)
		}
	}

	repoIDs := map[string]bool{}
	for i, r := range w.Repos {
		path := fmt.Sprintf("/repos/%d", i)
		if repoIDs[r.ID] {
			out = append(out, p.issue(path+"/id", fmt.Sprintf("Repo id %q is used more than once.", r.ID)))
		}
		repoIDs[r.ID] = true
		if !insideRoot(r.Path) {
			out = append(out, p.issue(path+"/path", "The path must be inside the workspace root: relative, with no ..."))
		}
		if r.Connection != "" && !connIDs[r.Connection] {
			missingConn(path+"/connection", r.Connection)
		}
		switch {
		case urlCreds.MatchString(r.Remote):
			out = append(out, p.issue(path+"/remote", "Remove the user name or token from the remote. Write host/owner/repo; credentials belong in a connection."))
		case strings.Contains(r.Remote, "://") || strings.Contains(r.Remote, "@"):
			out = append(out, p.warn(path+"/remote", "Write the remote as host/owner/repo, for example github.com/acme/api."))
		}
	}
	return out
}

func checkStack(p *parsed, s *StackFile, repoIDs map[string]bool) []Issue {
	var out []Issue
	known := func(path, repo string) {
		if repoIDs != nil && !repoIDs[repo] {
			out = append(out, p.issue(path, fmt.Sprintf("There is no repo with id %q in this workspace. Defined: %s.", repo, list(keys(repoIDs)))))
		}
	}

	if s.Compose != nil {
		known("/compose/repo", s.Compose.Repo)
		if !insideRoot(s.Compose.File) {
			out = append(out, p.issue("/compose/file", "The compose file must be inside the repo: relative, with no ..."))
		}
	}

	svcIDs := map[string]bool{}
	ports := map[int]string{}
	deps := map[string][]string{}
	var order []string
	for i, sv := range s.Services {
		path := fmt.Sprintf("/services/%d", i)
		if svcIDs[sv.ID] {
			out = append(out, p.issue(path+"/id", fmt.Sprintf("Service id %q is used more than once.", sv.ID)))
		}
		svcIDs[sv.ID] = true
		order = append(order, sv.ID)
		deps[sv.ID] = sv.After
		known(path+"/repo", sv.Repo)

		if sv.Kind == "command" && sv.Cmd == "" {
			out = append(out, p.issue(path, "A service of kind command needs cmd: what to run."))
		}
		if sv.Dir != "" && !insideRoot(sv.Dir) {
			out = append(out, p.issue(path+"/dir", "The folder must be inside the repo: relative, with no ..."))
		}
		if sv.Port != 0 {
			if other, taken := ports[sv.Port]; taken {
				out = append(out, p.issue(path+"/port", fmt.Sprintf("Port %d is already used by %q.", sv.Port, other)))
			} else {
				ports[sv.Port] = sv.ID
			}
		}
		out = append(out, checkReady(p, path, sv.Ready)...)
		for key, val := range sv.Env {
			if secretName.MatchString(key) && val != "" && !envRef.MatchString(val) {
				out = append(out, p.warn(path+"/env/"+escape(key),
					fmt.Sprintf("%q looks like a secret. Put it in the env_file (kept out of git) instead of here.", key)))
			}
		}
	}

	for i, sv := range s.Services {
		for j, dep := range sv.After {
			path := fmt.Sprintf("/services/%d/after/%d", i, j)
			switch {
			case dep == sv.ID:
				out = append(out, p.issue(path, "A service can't wait for itself."))
			case !svcIDs[dep]:
				out = append(out, p.issue(path, fmt.Sprintf("There is no service %q in this stack. Defined: %s.", dep, list(order))))
			}
		}
	}
	if cycle := findCycle(order, deps); cycle != nil {
		out = append(out, p.issue("/services", "These services wait for each other in a loop, so none could start: "+strings.Join(cycle, " → ")+"."))
	}
	return out
}

func checkReady(p *parsed, path string, r *Ready) []Issue {
	if r == nil {
		return nil
	}
	var out []Issue
	set := 0
	for _, v := range []string{r.HTTP, r.TCP, r.Log} {
		if v != "" {
			set++
		}
	}
	switch {
	case set == 0:
		out = append(out, p.issue(path+"/ready", "ready needs one of http, tcp or log."))
	case set > 1:
		out = append(out, p.issue(path+"/ready", "Choose one of http, tcp or log in ready, not several."))
	}
	if r.HTTP != "" && !strings.HasPrefix(r.HTTP, "http://") && !strings.HasPrefix(r.HTTP, "https://") {
		out = append(out, p.issue(path+"/ready/http", "An http check needs a full URL starting with http:// or https://."))
	}
	if r.TCP != "" {
		if !hostPort.MatchString(r.TCP) {
			out = append(out, p.issue(path+"/ready/tcp", "A tcp check is written host:port, for example 127.0.0.1:5432."))
		} else if n, _ := strconv.Atoi(r.TCP[strings.LastIndex(r.TCP, ":")+1:]); n < 1 || n > 65535 {
			out = append(out, p.issue(path+"/ready/tcp", "The port must be between 1 and 65535."))
		}
	}
	return out
}

func checkFlow(p *parsed, f *FlowFile, knownPlugins []string) []Issue {
	var out []Issue
	stepIDs := map[string]bool{}
	deps := map[string][]string{}
	var order []string
	for i, st := range f.Steps {
		path := fmt.Sprintf("/steps/%d", i)
		if stepIDs[st.ID] {
			out = append(out, p.issue(path+"/id", fmt.Sprintf("Step id %q is used more than once.", st.ID)))
		}
		stepIDs[st.ID] = true
		order = append(order, st.ID)
		deps[st.ID] = st.Needs
		if knownPlugins != nil {
			if plugin, _, ok := strings.Cut(st.Uses, "."); ok && !slices.Contains(knownPlugins, plugin) {
				out = append(out, p.warn(path+"/uses", fmt.Sprintf("There is no plugin %q installed. Installed: %s.", plugin, list(knownPlugins))))
			}
		}
	}
	for i, st := range f.Steps {
		for j, need := range st.Needs {
			path := fmt.Sprintf("/steps/%d/needs/%d", i, j)
			switch {
			case need == st.ID:
				out = append(out, p.issue(path, "A step can't wait for itself."))
			case !stepIDs[need]:
				out = append(out, p.issue(path, fmt.Sprintf("There is no step %q in this flow. Defined: %s.", need, list(order))))
			}
		}
	}
	if cycle := findCycle(order, deps); cycle != nil {
		out = append(out, p.issue("/steps", "These steps wait for each other in a loop, so none could run: "+strings.Join(cycle, " → ")+"."))
	}
	return out
}

func keys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// findCycle returns a loop in the dependency graph (a → b → a), or nil.
func findCycle(order []string, deps map[string][]string) []string {
	const (
		white = iota
		grey
		black
	)
	color := map[string]int{}
	var stack []string
	var cycle []string

	var visit func(n string) bool
	visit = func(n string) bool {
		color[n] = grey
		stack = append(stack, n)
		for _, d := range deps[n] {
			switch color[d] {
			case grey:
				start := slices.Index(stack, d)
				cycle = append(slices.Clone(stack[start:]), d)
				return true
			case white:
				if _, known := deps[d]; known && visit(d) {
					return true
				}
			}
		}
		stack = stack[:len(stack)-1]
		color[n] = black
		return false
	}
	for _, n := range order {
		if color[n] == white && visit(n) {
			return cycle
		}
	}
	return nil
}
