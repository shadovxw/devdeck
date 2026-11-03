package workspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

var (
	// ErrConflict means workspace.yaml changed on disk after the editor read it.
	ErrConflict = errors.New("workspace.yaml changed on disk after you opened it")
	// ErrNoRepo means the workspace has no repo with that id.
	ErrNoRepo = errors.New("this workspace has no repo with that id")
	// ErrNoFolder means the repo's folder isn't on this machine.
	ErrNoFolder = errors.New("the repo's folder isn't there")
	// ErrHasGit means the folder already is a git repository.
	ErrHasGit = errors.New("this folder is already a git repository")
)

// File is a workspace.yaml as the editor reads it: the text, a hash that says which version
// that is, and where it lives, so the editor can offer to open it in another tool.
type File struct {
	YAML string `json:"yaml"`
	Hash string `json:"hash"`
	Path string `json:"path"`
}

// Hash says which version of a file some bytes are: the SHA-256 in hex.
func Hash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// File reads workspace.yaml for the editor. Samples can be read too.
func (s *Manager) File(id string) (File, error) {
	if !idPattern.MatchString(id) {
		return File{}, ErrNotFound
	}
	f, ok := s.folders()[id]
	if !ok {
		return File{}, ErrNotFound
	}
	path := filepath.Join(f[0], workspaceYAML)
	b, err := os.ReadFile(path)
	if err != nil {
		return File{}, err
	}
	return File{YAML: string(b), Hash: Hash(b), Path: path}, nil
}

// UpdateIf is Update, but only when workspace.yaml is still the version the editor started from
// (baseHash, from File). If the file changed since, nothing is written and ErrConflict comes back,
// so an edit never silently overwrites newer work. An empty baseHash skips the check. It also
// returns the hash of what was written.
func (s *Manager) UpdateIf(id, yamlText, baseHash string) (*Summary, string, []Issue, error) {
	if baseHash != "" {
		cur, err := s.File(id)
		if err != nil {
			return nil, "", nil, err
		}
		if cur.Hash != baseHash {
			return nil, "", nil, ErrConflict
		}
	}
	sum, issues, err := s.Update(id, yamlText)
	if err != nil {
		return nil, "", issues, err
	}
	return sum, Hash([]byte(yamlText)), nil, nil
}

// GitInit runs `git init` in a repo's folder: the fix offered for a folder that isn't a git
// repository. It only acts on a folder that exists inside the workspace's root and has no .git.
// Samples can't be changed.
func (s *Manager) GitInit(ctx context.Context, id, repoID string) error {
	d, err := s.Get(id)
	if err != nil {
		return err
	}
	if d.Source == SourceExample {
		return ErrReadOnly
	}
	if d.Workspace == nil {
		return ErrNotFound
	}
	var repo *Repo
	for i := range d.Workspace.Repos {
		if d.Workspace.Repos[i].ID == repoID {
			repo = &d.Workspace.Repos[i]
		}
	}
	if repo == nil || !insideRoot(repo.Path) {
		return ErrNoRepo
	}
	dir := filepath.Join(ResolveRoot(d.Folder, d.Workspace.Root), repo.Path)
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		return ErrNoFolder
	}
	if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
		return ErrHasGit
	}
	cmd := exec.CommandContext(ctx, "git", "init")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("git init: %w: %s", err, strings.TrimSpace(string(out)))
	}
	return nil
}
