package workspace

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Where a workspace comes from.
const (
	// SourceLocal workspaces are the user's own and can be created here.
	SourceLocal = "local"
	// SourceExample workspaces ship with devdeck. They are read-only samples.
	SourceExample = "example"
)

var (
	// ErrNotFound means there is no workspace with that id.
	ErrNotFound = errors.New("workspace not found")
	// ErrExists means a workspace with that name already exists.
	ErrExists = errors.New("a workspace with that name already exists")
	// ErrInvalid means the YAML has errors; the issues say which.
	ErrInvalid = errors.New("the workspace has errors")
	// ErrNoDir means no folder is configured for the user's own workspaces.
	ErrNoDir = errors.New("no folder is set up for workspaces")
	// ErrReadOnly means the workspace ships with devdeck and can't be changed or deleted.
	ErrReadOnly = errors.New("sample workspaces can't be changed")
	// ErrRenameWorkspace means an update changed the workspace's name, which is its folder.
	ErrRenameWorkspace = errors.New("a workspace can't be renamed here: its name is its folder. Create a new one with the new name")

	idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
)

// Manager finds, checks and creates workspaces on disk.
type Manager struct {
	// Dir holds the user's own workspaces, one folder each.
	Dir string
	// ExamplesDir optionally holds read-only sample workspaces.
	ExamplesDir string
	// ScanRoots are the folders a scan may look inside. Empty means the user's home folder.
	ScanRoots []string
	// Plugins returns installed plugin ids, so flows naming others get a warning.
	Plugins func() []string
}

// Summary is one workspace in a list.
type Summary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Source      string `json:"source"`
	Root        string `json:"root,omitempty"`
	Repos       int    `json:"repos"`
	Stacks      int    `json:"stacks"`
	Flows       int    `json:"flows"`
	Errors      int    `json:"errors"`
	Warnings    int    `json:"warnings"`
}

// Detail is a whole workspace with everything found wrong in it.
type Detail struct {
	Summary
	Workspace *WorkspaceFile `json:"workspace,omitempty"`
	Stacks    []StackFile    `json:"stacks"`
	Flows     []FlowFile     `json:"flows"`
	Issues    []Issue        `json:"issues"`
	// Folder is where the workspace lives on disk. It is not sent to the browser.
	Folder string `json:"-"`
}

func (s *Manager) plugins() []string {
	if s.Plugins == nil {
		return nil
	}
	return s.Plugins()
}

// options: a user's own workspace is checked against this machine; an example's
// folders are only illustrations, so they aren't.
func (s *Manager) options(source string) Options {
	if source == SourceExample {
		return Options{}
	}
	return Options{CheckPaths: true, KnownPlugins: s.plugins()}
}

// folders lists workspace folders as id -> (path, source). Local wins over an example of the same name.
func (s *Manager) folders() map[string][2]string {
	out := map[string][2]string{}
	add := func(base, source string) {
		if base == "" {
			return
		}
		entries, err := os.ReadDir(base)
		if err != nil {
			return
		}
		for _, e := range entries {
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			if _, taken := out[e.Name()]; !taken {
				out[e.Name()] = [2]string{filepath.Join(base, e.Name()), source}
			}
		}
	}
	add(s.Dir, SourceLocal)
	add(s.ExamplesDir, SourceExample)
	return out
}

func summarise(id, source string, l *Loaded) Summary {
	sum := Summary{ID: id, Name: id, Source: source, Errors: Count(l.Issues, SeverityError), Warnings: Count(l.Issues, SeverityWarning)}
	if w := l.Workspace; w != nil {
		sum.Name, sum.Description, sum.Root, sum.Repos = w.Name, w.Description, w.Root, len(w.Repos)
	}
	sum.Stacks, sum.Flows = len(l.Stacks), len(l.Flows)
	return sum
}

// List returns every workspace, sorted by id.
func (s *Manager) List() []Summary {
	folders := s.folders()
	ids := make([]string, 0, len(folders))
	for id := range folders {
		ids = append(ids, id)
	}
	slices.Sort(ids)

	out := make([]Summary, 0, len(ids))
	for _, id := range ids {
		path, source := folders[id][0], folders[id][1]
		l, err := LoadDir(path, s.options(source))
		if err != nil {
			out = append(out, Summary{ID: id, Name: id, Source: source, Errors: 1})
			continue
		}
		out = append(out, summarise(id, source, l))
	}
	return out
}

// Get returns one workspace in full.
func (s *Manager) Get(id string) (*Detail, error) {
	if !idPattern.MatchString(id) {
		return nil, ErrNotFound
	}
	f, ok := s.folders()[id]
	if !ok {
		return nil, ErrNotFound
	}
	l, err := LoadDir(f[0], s.options(f[1]))
	if err != nil {
		return nil, err
	}
	// The id comes from the folder's own name, not from the caller's string.
	d := &Detail{Summary: summarise(filepath.Base(f[0]), f[1], l), Workspace: l.Workspace, Stacks: l.Stacks, Flows: l.Flows, Issues: l.Issues, Folder: f[0]}
	if d.Stacks == nil {
		d.Stacks = []StackFile{}
	}
	if d.Flows == nil {
		d.Flows = []FlowFile{}
	}
	if d.Issues == nil {
		d.Issues = []Issue{}
	}
	return d, nil
}

// Validate checks YAML text without saving it. workspaceID (optional) names the
// workspace a stack or flow belongs to, so its repo ids can be checked.
func (s *Manager) Validate(k Kind, yamlText, workspaceID string) []Issue {
	var repoIDs map[string]bool
	if workspaceID != "" {
		if d, err := s.Get(workspaceID); err == nil && d.Workspace != nil {
			repoIDs = map[string]bool{}
			for _, r := range d.Workspace.Repos {
				repoIDs[r.ID] = true
			}
		}
	}
	file := string(k) + ".yaml"
	return Check(k, file, []byte(yamlText), repoIDs, Options{KnownPlugins: s.plugins()})
}

// Create saves a new workspace. It never overwrites one. When the YAML has
// errors nothing is written, and the issues come back with ErrInvalid.
func (s *Manager) Create(yamlText string) (*Summary, []Issue, error) {
	if s.Dir == "" {
		return nil, nil, ErrNoDir
	}
	w, issues := checkWorkspaceText("workspace.yaml", "", []byte(yamlText), Options{})
	if w == nil || HasErrors(issues) {
		return nil, tidy(issues), ErrInvalid
	}
	// The name was checked against the id pattern by the schema, so it is a safe folder name.
	dir := filepath.Join(s.Dir, w.Name)
	if _, taken := s.folders()[w.Name]; taken {
		return nil, nil, ErrExists
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, nil, err
	}
	if err := os.WriteFile(filepath.Join(dir, "workspace.yaml"), []byte(yamlText), 0o644); err != nil {
		return nil, nil, fmt.Errorf("save workspace: %w", err)
	}
	d, err := s.Get(w.Name)
	if err != nil {
		return nil, nil, err
	}
	return &d.Summary, nil, nil
}

// YAML returns workspace.yaml as text, for the editor. Samples can be read too.
func (s *Manager) YAML(id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", ErrNotFound
	}
	f, ok := s.folders()[id]
	if !ok {
		return "", ErrNotFound
	}
	b, err := os.ReadFile(filepath.Join(f[0], "workspace.yaml"))
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// Update replaces one of the user's own workspace.yaml files with new text. The text is
// checked first, and when it has errors nothing is written and the issues come back with
// ErrInvalid. The name can't change (it is the folder). The old file is kept next to it
// as workspace.yaml.prev, and the new one is written in one step, so a crash never leaves
// half a file. Samples can't be updated.
func (s *Manager) Update(id, yamlText string) (*Summary, []Issue, error) {
	if !idPattern.MatchString(id) {
		return nil, nil, ErrNotFound
	}
	f, ok := s.folders()[id]
	if !ok {
		return nil, nil, ErrNotFound
	}
	if f[1] == SourceExample {
		return nil, nil, ErrReadOnly
	}
	w, issues := checkWorkspaceText("workspace.yaml", "", []byte(yamlText), Options{})
	if w == nil || HasErrors(issues) {
		return nil, tidy(issues), ErrInvalid
	}
	if w.Name != id {
		return nil, nil, ErrRenameWorkspace
	}
	file := filepath.Join(f[0], "workspace.yaml")
	if old, err := os.ReadFile(file); err == nil {
		if err := os.WriteFile(file+".prev", old, 0o644); err != nil {
			return nil, nil, fmt.Errorf("keep the old workspace.yaml: %w", err)
		}
	}
	tmp, err := os.CreateTemp(f[0], ".workspace-*.yaml")
	if err != nil {
		return nil, nil, fmt.Errorf("save workspace: %w", err)
	}
	_, werr := tmp.WriteString(yamlText)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		_ = os.Remove(tmp.Name())
		return nil, nil, fmt.Errorf("save workspace: %w", errors.Join(werr, cerr))
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, nil, fmt.Errorf("save workspace: %w", err)
	}
	d, err := s.Get(id)
	if err != nil {
		return nil, nil, err
	}
	return &d.Summary, nil, nil
}

// Scan makes a draft workspace from a folder of repositories. It saves nothing.
func (s *Manager) Scan(root string) (*ScanResult, error) {
	checked, err := s.checkScanRoot(root)
	if err != nil {
		return nil, err
	}
	return Scan(checked)
}

// trashDir is where deleted workspaces go, inside the workspaces folder. It starts
// with a dot, so it is never listed as a workspace.
const trashDir = ".trash"

// Delete removes one of the user's own workspaces from devdeck. Nothing is erased:
// its folder is moved into .trash inside the workspaces folder, so a mistake can be
// undone by moving it back. Only the workspace's files move; the repositories it
// describes are not touched. Sample workspaces can't be deleted.
func (s *Manager) Delete(id string) error {
	if !idPattern.MatchString(id) {
		return ErrNotFound
	}
	f, ok := s.folders()[id]
	if !ok {
		return ErrNotFound
	}
	if f[1] != SourceLocal {
		return ErrReadOnly
	}
	// f[0] is the folder as found on disk, not the caller's string.
	trash := filepath.Join(s.Dir, trashDir)
	if err := os.MkdirAll(trash, 0o750); err != nil {
		return err
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	dest := filepath.Join(trash, filepath.Base(f[0])+"-"+stamp)
	for n := 2; ; n++ {
		if _, err := os.Lstat(dest); errors.Is(err, os.ErrNotExist) {
			break
		}
		dest = filepath.Join(trash, fmt.Sprintf("%s-%s-%d", filepath.Base(f[0]), stamp, n))
	}
	return os.Rename(f[0], dest)
}
