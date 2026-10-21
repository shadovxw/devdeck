package workspace

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

var (
	// ErrStackNotFound means the workspace has no stack with that name.
	ErrStackNotFound = errors.New("no such stack in this workspace")
	// ErrStackExists means a stack with that name is already in the workspace.
	ErrStackExists = errors.New("a stack with that name already exists in this workspace")
	// ErrRename means an update changed the stack's name.
	ErrRename = errors.New("a stack can't be renamed here: delete it and add it again with the new name")
)

// stackRoom is a workspace folder found on disk with its files loaded.
type stackRoom struct {
	dir    string
	source string
	loaded *Loaded
}

func (r *stackRoom) repoIDs() map[string]bool {
	if r.loaded.Workspace == nil {
		return nil
	}
	ids := map[string]bool{}
	for _, repo := range r.loaded.Workspace.Repos {
		ids[repo.ID] = true
	}
	return ids
}

func (r *stackRoom) find(name string) (StackFile, bool) {
	for _, s := range r.loaded.Stacks {
		if s.Name == name {
			return s, true
		}
	}
	return StackFile{}, false
}

// path is where a loaded stack's file is. The relative name came from a
// directory listing, not from a caller's string.
func (r *stackRoom) path(st StackFile) string {
	return filepath.Join(r.dir, filepath.FromSlash(st.File))
}

func (s *Manager) room(id string) (*stackRoom, error) {
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
	return &stackRoom{dir: f[0], source: f[1], loaded: l}, nil
}

// ownRoom is room for a workspace the user may change: not a sample.
func (s *Manager) ownRoom(id string) (*stackRoom, error) {
	r, err := s.room(id)
	if err != nil {
		return nil, err
	}
	if r.source != SourceLocal {
		return nil, ErrReadOnly
	}
	return r, nil
}

// StackYAML returns the text of a stack's file, for editing. It works for sample
// workspaces too, since reading changes nothing.
func (s *Manager) StackYAML(workspaceID, stack string) (string, error) {
	r, err := s.room(workspaceID)
	if err != nil {
		return "", err
	}
	st, ok := r.find(stack)
	if !ok {
		return "", ErrStackNotFound
	}
	data, err := os.ReadFile(r.path(st))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// check reads the text the way it will be loaded from the file rel. It returns
// the stack and the issues (warnings included), or ErrInvalid when there are errors.
func (r *stackRoom) check(rel, text string) (*StackFile, []Issue, error) {
	st, issues := checkStackText(rel, []byte(text), r.repoIDs())
	if st == nil || HasErrors(issues) {
		return nil, tidy(issues), ErrInvalid
	}
	return st, tidy(issues), nil
}

// CreateStack saves a new stack as stacks/<name>.yaml in one of the user's own
// workspaces. It never overwrites a file. When the YAML has errors nothing is
// written, and the issues come back with ErrInvalid. Warnings come back with the
// saved stack.
func (s *Manager) CreateStack(workspaceID, yamlText string) (*StackFile, []Issue, error) {
	r, err := s.ownRoom(workspaceID)
	if err != nil {
		return nil, nil, err
	}
	// The first pass only finds the name, which decides the file name. The file has
	// no name yet, so its warnings (such as "name doesn't match the file") are dropped.
	st, issues, err := r.check("stack.yaml", yamlText)
	if err != nil {
		return nil, errorsOnly(issues), err
	}
	rel := "stacks/" + st.Name + ".yaml"
	st, issues, err = r.check(rel, yamlText)
	if err != nil {
		return nil, issues, err
	}
	if _, taken := r.find(st.Name); taken {
		return nil, nil, ErrStackExists
	}

	// The name passed the schema's id pattern, so it is a safe file name.
	dir := filepath.Join(r.dir, "stacks")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, st.Name+".yaml"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644) //nolint:gosec // see above
	if errors.Is(err, os.ErrExist) {
		return nil, nil, ErrStackExists
	}
	if err != nil {
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	if _, err := f.WriteString(yamlText); err != nil {
		_ = f.Close()
		_ = os.Remove(f.Name())
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	if err := f.Close(); err != nil {
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	st.File = rel
	return st, issues, nil
}

// UpdateStack replaces a stack's file in place, in one of the user's own
// workspaces. The name inside the new text must be the same. When the YAML has
// errors nothing is written. The text is written aside and renamed over the old
// file, so a failure part way never leaves a half-written stack.
func (s *Manager) UpdateStack(workspaceID, stack, yamlText string) (*StackFile, []Issue, error) {
	r, err := s.ownRoom(workspaceID)
	if err != nil {
		return nil, nil, err
	}
	old, ok := r.find(stack)
	if !ok {
		return nil, nil, ErrStackNotFound
	}
	st, issues, err := r.check(old.File, yamlText)
	if err != nil {
		return nil, issues, err
	}
	if st.Name != stack {
		return nil, nil, ErrRename
	}

	path := r.path(old)
	tmp, err := os.CreateTemp(filepath.Dir(path), ".stack-*.tmp")
	if err != nil {
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	_, werr := tmp.WriteString(yamlText)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	if err := os.Chmod(tmp.Name(), 0o644); err != nil { //nolint:gosec // the mode CreateStack gives
		_ = os.Remove(tmp.Name())
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return nil, nil, fmt.Errorf("save stack: %w", err)
	}
	st.File = old.File
	return st, issues, nil
}

// DeleteStack removes a stack from one of the user's own workspaces. Nothing is
// erased: the file moves into .trash/stacks inside the workspace, so a mistake
// can be undone by moving it back.
func (s *Manager) DeleteStack(workspaceID, stack string) error {
	r, err := s.ownRoom(workspaceID)
	if err != nil {
		return err
	}
	old, ok := r.find(stack)
	if !ok {
		return ErrStackNotFound
	}
	path := r.path(old)
	trash := filepath.Join(r.dir, trashDir, "stacks")
	if err := os.MkdirAll(trash, 0o750); err != nil {
		return err
	}
	stamp := time.Now().UTC().Format("20060102-150405")
	base := filepath.Base(path)
	dest := filepath.Join(trash, base+"-"+stamp)
	for n := 2; ; n++ {
		if _, err := os.Lstat(dest); errors.Is(err, os.ErrNotExist) {
			break
		}
		dest = filepath.Join(trash, fmt.Sprintf("%s-%s-%d", base, stamp, n))
	}
	return os.Rename(path, dest)
}

// errorsOnly keeps the problems that stop a save.
func errorsOnly(issues []Issue) []Issue {
	var out []Issue
	for _, i := range issues {
		if i.Severity == SeverityError {
			out = append(out, i)
		}
	}
	return out
}
