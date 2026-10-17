package workspace

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Loaded is a workspace folder after reading and checking it.
type Loaded struct {
	Workspace *WorkspaceFile
	Stacks    []StackFile
	Flows     []FlowFile
	Issues    []Issue
}

// ResolveRoot turns a workspace's root setting into a real folder: ~ is the
// home folder, and a relative path is relative to the workspace folder.
func ResolveRoot(dir, root string) string {
	if root == "~" || strings.HasPrefix(root, "~/") || strings.HasPrefix(root, `~\`) {
		if home, err := os.UserHomeDir(); err == nil {
			root = filepath.Join(home, root[1:])
		}
	}
	if !filepath.IsAbs(root) {
		root = filepath.Join(dir, root)
	}
	return filepath.Clean(root)
}

// JoinInside joins rel to base and reports false when the result is not under
// base, so a path written in a workspace file can't point outside its folder.
func JoinInside(base, rel string) (string, bool) {
	p := filepath.Join(base, filepath.FromSlash(rel))
	r, err := filepath.Rel(base, p)
	if err != nil || r == ".." || strings.HasPrefix(r, ".."+string(filepath.Separator)) || filepath.IsAbs(r) {
		return "", false
	}
	return p, true
}

// decode reads a checked document into its Go shape.
func decode[T any](p *parsed) (*T, bool) {
	var v T
	if err := p.node.Decode(&v); err != nil {
		return nil, false
	}
	return &v, true
}

// checkWorkspaceText checks workspace.yaml text. dir is where the workspace
// lives, for resolving the root when opts.CheckPaths is on.
func checkWorkspaceText(file, dir string, data []byte, opts Options) (*WorkspaceFile, []Issue) {
	p, issues := parse(file, data)
	if p == nil {
		return nil, issues
	}
	issues = append(issues, p.checkSchema(KindWorkspace)...)
	if HasErrors(issues) {
		return nil, issues
	}
	w, ok := decode[WorkspaceFile](p)
	if !ok {
		return nil, append(issues, p.issue("", "The file couldn't be read into a workspace."))
	}
	issues = append(issues, checkWorkspace(p, w)...)
	if opts.CheckPaths {
		issues = append(issues, checkPaths(p, w, dir)...)
	}
	return w, issues
}

func checkPaths(p *parsed, w *WorkspaceFile, dir string) []Issue {
	var out []Issue
	root := ResolveRoot(dir, w.Root)
	if st, err := os.Stat(root); err != nil || !st.IsDir() {
		return append(out, p.warn("/root", fmt.Sprintf("The folder %s doesn't exist on this machine.", filepath.ToSlash(root))))
	}
	for i, r := range w.Repos {
		if !insideRoot(r.Path) {
			continue
		}
		repo := filepath.Join(root, r.Path)
		path := fmt.Sprintf("/repos/%d/path", i)
		st, err := os.Stat(repo)
		switch {
		case err != nil || !st.IsDir():
			out = append(out, p.warn(path, fmt.Sprintf("The folder %s isn't there.", filepath.ToSlash(repo))))
		default:
			if _, err := os.Stat(filepath.Join(repo, ".git")); err != nil {
				out = append(out, p.warn(path, "This folder isn't a git repository (no .git inside)."))
			}
		}
	}
	return out
}

func checkStackText(file string, data []byte, repoIDs map[string]bool) (*StackFile, []Issue) {
	p, issues := parse(file, data)
	if p == nil {
		return nil, issues
	}
	issues = append(issues, p.checkSchema(KindStack)...)
	if HasErrors(issues) {
		return nil, issues
	}
	s, ok := decode[StackFile](p)
	if !ok {
		return nil, append(issues, p.issue("", "The file couldn't be read into a stack."))
	}
	issues = append(issues, checkStack(p, s, repoIDs)...)
	if stem := stemOf(file); stem != s.Name {
		issues = append(issues, p.warn("/name", fmt.Sprintf("The name %q doesn't match the file name %q.", s.Name, stem)))
	}
	return s, issues
}

func checkFlowText(file string, data []byte, opts Options) (*FlowFile, []Issue) {
	p, issues := parse(file, data)
	if p == nil {
		return nil, issues
	}
	issues = append(issues, p.checkSchema(KindFlow)...)
	if HasErrors(issues) {
		return nil, issues
	}
	f, ok := decode[FlowFile](p)
	if !ok {
		return nil, append(issues, p.issue("", "The file couldn't be read into a flow."))
	}
	issues = append(issues, checkFlow(p, f, opts.KnownPlugins)...)
	if stem := stemOf(file); stem != f.Name {
		issues = append(issues, p.warn("/name", fmt.Sprintf("The name %q doesn't match the file name %q.", f.Name, stem)))
	}
	return f, issues
}

func stemOf(file string) string {
	base := filepath.Base(file)
	return strings.TrimSuffix(strings.TrimSuffix(base, ".yaml"), ".yml")
}

// Check checks text of one kind of file without saving it: what an editor
// needs. repoIDs (nil to skip) are the workspace's repo ids, for cross-checks.
func Check(k Kind, file string, data []byte, repoIDs map[string]bool, opts Options) []Issue {
	var issues []Issue
	switch k {
	case KindWorkspace:
		_, issues = checkWorkspaceText(file, "", data, Options{KnownPlugins: opts.KnownPlugins})
	case KindStack:
		_, issues = checkStackText(file, data, repoIDs)
	case KindFlow:
		_, issues = checkFlowText(file, data, opts)
	default:
		issues = []Issue{{File: file, Severity: SeverityError, Message: fmt.Sprintf("Unknown kind %q: use workspace, stack or flow.", k)}}
	}
	return tidy(issues)
}

// LoadDir reads a workspace folder and checks every file in it. The returned
// error is only for a folder that can't be read at all; problems in the files
// are Issues.
func LoadDir(dir string, opts Options) (*Loaded, error) {
	if _, err := os.Stat(dir); err != nil {
		return nil, err
	}
	l := &Loaded{}
	dirName := filepath.Base(dir)

	data, err := os.ReadFile(filepath.Join(dir, "workspace.yaml"))
	switch {
	case errors.Is(err, fs.ErrNotExist):
		l.Issues = append(l.Issues, Issue{File: "workspace.yaml", Severity: SeverityError, Message: "This folder has no workspace.yaml."})
	case err != nil:
		return nil, err
	default:
		var issues []Issue
		l.Workspace, issues = checkWorkspaceText("workspace.yaml", dir, data, opts)
		l.Issues = append(l.Issues, issues...)
		if l.Workspace != nil && l.Workspace.Name != dirName {
			l.Issues = append(l.Issues, Issue{File: "workspace.yaml", Path: "/name", Line: 1, Severity: SeverityWarning,
				Message: fmt.Sprintf("The name %q doesn't match the folder name %q.", l.Workspace.Name, dirName)})
		}
	}

	var repoIDs map[string]bool
	if l.Workspace != nil {
		repoIDs = map[string]bool{}
		for _, r := range l.Workspace.Repos {
			repoIDs[r.ID] = true
		}
	}

	names := map[string]string{}
	for _, name := range yamlFiles(filepath.Join(dir, "stacks")) {
		rel := "stacks/" + name
		raw, err := os.ReadFile(filepath.Join(dir, "stacks", name))
		if err != nil {
			l.Issues = append(l.Issues, Issue{File: rel, Severity: SeverityError, Message: "The file can't be read: " + err.Error()})
			continue
		}
		s, issues := checkStackText(rel, raw, repoIDs)
		l.Issues = append(l.Issues, issues...)
		if s == nil {
			continue
		}
		s.File = rel
		if other, dup := names["stack:"+s.Name]; dup {
			l.Issues = append(l.Issues, Issue{File: rel, Path: "/name", Severity: SeverityError, Line: 1,
				Message: fmt.Sprintf("The stack name %q is already used by %s.", s.Name, other)})
		}
		names["stack:"+s.Name] = rel
		l.Stacks = append(l.Stacks, *s)
	}
	for _, name := range yamlFiles(filepath.Join(dir, "flows")) {
		rel := "flows/" + name
		raw, err := os.ReadFile(filepath.Join(dir, "flows", name))
		if err != nil {
			l.Issues = append(l.Issues, Issue{File: rel, Severity: SeverityError, Message: "The file can't be read: " + err.Error()})
			continue
		}
		f, issues := checkFlowText(rel, raw, opts)
		l.Issues = append(l.Issues, issues...)
		if f == nil {
			continue
		}
		f.File = rel
		if other, dup := names["flow:"+f.Name]; dup {
			l.Issues = append(l.Issues, Issue{File: rel, Path: "/name", Severity: SeverityError, Line: 1,
				Message: fmt.Sprintf("The flow name %q is already used by %s.", f.Name, other)})
		}
		names["flow:"+f.Name] = rel
		l.Flows = append(l.Flows, *f)
	}

	l.Issues = tidy(l.Issues)
	return l, nil
}

// yamlFiles lists *.yaml and *.yml in a folder, sorted. A missing folder is empty.
func yamlFiles(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		n := e.Name()
		if !e.IsDir() && (strings.HasSuffix(n, ".yaml") || strings.HasSuffix(n, ".yml")) {
			out = append(out, n)
		}
	}
	slices.Sort(out)
	return out
}
