package workspace

import (
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// maxScanned stops a scan of a huge folder from producing an unusable draft.
const maxScanned = 200

// ScanResult is a draft workspace made from a folder of git repositories.
type ScanResult struct {
	// Root is the folder that was scanned, as an absolute path.
	Root string `json:"root"`
	// Name is a suggested workspace name.
	Name string `json:"name"`
	// Repos are the repositories found, sorted by id.
	Repos []Repo `json:"repos"`
	// YAML is workspace.yaml for the draft, ready to review and save.
	YAML string `json:"yaml"`
	// Truncated is true when the folder had more repositories than the draft keeps.
	Truncated bool `json:"truncated,omitempty"`
}

var (
	scpRemote = regexp.MustCompile(`^(?:[^@/\s]+@)?([^:/\s]+):([^/].*)$`)
	nonID     = regexp.MustCompile(`[^a-z0-9]+`)
)

// ErrOutsideScanRoots means the folder is not inside any folder devdeck may scan.
var ErrOutsideScanRoots = errors.New("that folder is outside the folders devdeck may scan (your home folder unless DEVDECK_SCAN_ROOTS says otherwise)")

// allowedScanRoots are the folders a scan may look inside: the configured ones,
// or the user's home folder when none are set.
func (s *Manager) allowedScanRoots() []string {
	if len(s.ScanRoots) > 0 {
		return s.ScanRoots
	}
	if home, err := os.UserHomeDir(); err == nil {
		return []string{home}
	}
	return nil
}

// checkScanRoot resolves symlinks in root and returns it only when it is inside
// an allowed scan root, so a scan can't be pointed at system folders or escape
// through a link.
func (s *Manager) checkScanRoot(root string) (string, error) {
	resolved, err := filepath.EvalSymlinks(filepath.Clean(root))
	if err != nil {
		return "", errors.New("that folder doesn't exist")
	}
	for _, allowed := range s.allowedScanRoots() {
		base, err := filepath.EvalSymlinks(filepath.Clean(allowed))
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(base, resolved)
		if err != nil || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			continue
		}
		// Rebuild the path from the trusted base plus the cleaned remainder, so
		// the result can never leave base (the usual "clean a rooted path" pattern).
		return filepath.Join(base, filepath.Clean("/"+rel)), nil
	}
	return "", ErrOutsideScanRoots
}

// Scan looks at the folders directly inside root and treats each one that is a
// git repository as a repo. It never runs git and never changes anything: it
// reads folder names, a few marker files and .git/config.
func Scan(root string) (*ScanResult, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if st, err := os.Stat(abs); err != nil || !st.IsDir() {
		return nil, errors.New("that folder doesn't exist")
	}
	if isGit(abs) {
		return nil, errors.New("that folder is itself a repository: pick the folder that contains your repositories")
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		return nil, err
	}
	res := &ScanResult{Root: filepath.ToSlash(abs), Name: sanitizeID(filepath.Base(abs), "workspace")}
	used := map[string]bool{}
	for _, e := range entries {
		name := e.Name()
		if !e.IsDir() || strings.HasPrefix(name, ".") || name == "node_modules" {
			continue
		}
		dir := filepath.Join(abs, name)
		if !isGit(dir) {
			continue
		}
		if len(res.Repos) >= maxScanned {
			res.Truncated = true
			break
		}
		id := uniqueID(sanitizeID(name, "repo"), used)
		res.Repos = append(res.Repos, Repo{ID: id, Path: name, Type: detectType(dir), Remote: originRemote(dir)})
	}
	slices.SortFunc(res.Repos, func(a, b Repo) int { return strings.Compare(a.ID, b.ID) })

	out, err := yamlFor(res)
	if err != nil {
		return nil, err
	}
	res.YAML = out
	return res, nil
}

func isGit(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

func exists(dir string, names ...string) bool {
	for _, n := range names {
		if _, err := os.Stat(filepath.Join(dir, n)); err == nil {
			return true
		}
	}
	return false
}

// detectType guesses a repo's main language from marker files.
func detectType(dir string) string {
	switch {
	case exists(dir, "go.mod"):
		return "go"
	case exists(dir, "package.json"):
		return "node"
	case exists(dir, "pyproject.toml", "requirements.txt", "setup.py"):
		return "python"
	case exists(dir, "Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"):
		return "docker"
	}
	return "other"
}

// sanitizeID turns a folder name into a valid id (lowercase letters, digits, dashes).
func sanitizeID(name, fallback string) string {
	id := strings.Trim(nonID.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if id == "" {
		return fallback
	}
	if id[0] >= '0' && id[0] <= '9' {
		id = "r-" + id
	}
	if len(id) > 40 {
		id = strings.TrimRight(id[:40], "-")
	}
	return id
}

func uniqueID(id string, used map[string]bool) string {
	candidate := id
	for n := 2; used[candidate]; n++ {
		suffix := fmt.Sprintf("-%d", n)
		base := id
		if len(base)+len(suffix) > 40 {
			base = base[:40-len(suffix)]
		}
		candidate = base + suffix
	}
	used[candidate] = true
	return candidate
}

// originRemote reads the origin URL from .git/config and returns it as
// host/owner/repo, with any credentials removed. "" when unknown.
func originRemote(dir string) string {
	raw, err := os.ReadFile(filepath.Join(dir, ".git", "config"))
	if err != nil {
		return "" // .git may be a file (worktree or submodule)
	}
	inOrigin := false
	sc := bufio.NewScanner(bytes.NewReader(raw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		switch {
		case strings.HasPrefix(line, "["):
			inOrigin = line == `[remote "origin"]`
		case inOrigin && strings.HasPrefix(line, "url"):
			if _, val, ok := strings.Cut(line, "="); ok {
				return normalizeRemote(strings.TrimSpace(val))
			}
		}
	}
	return ""
}

// normalizeRemote turns a git URL into host/owner/repo. Credentials in the
// URL are dropped, so a token that was pasted into a clone URL can't leak into
// a file that may be committed.
func normalizeRemote(raw string) string {
	var host, path string
	switch {
	case strings.Contains(raw, "://"):
		u, err := url.Parse(raw)
		if err != nil || u.Hostname() == "" {
			return ""
		}
		host, path = u.Hostname(), u.Path
	case scpRemote.MatchString(raw):
		m := scpRemote.FindStringSubmatch(raw)
		host, path = m[1], m[2]
	default:
		return "" // a local path or something we don't understand
	}
	path = strings.TrimSuffix(strings.Trim(path, "/"), ".git")
	if host == "" || path == "" {
		return ""
	}
	return strings.ToLower(host) + "/" + path
}

// displayRoot writes a folder the way people do: ~/code when it is under home.
func displayRoot(abs string) string {
	slash := filepath.ToSlash(abs)
	if home, err := os.UserHomeDir(); err == nil {
		h := filepath.ToSlash(home)
		if slash == h {
			return "~"
		}
		if rest, ok := strings.CutPrefix(slash, h+"/"); ok {
			return "~/" + rest
		}
	}
	return slash
}

func yamlFor(res *ScanResult) (string, error) {
	w := WorkspaceFile{
		Version: 1,
		Name:    res.Name,
		Root:    displayRoot(filepath.FromSlash(res.Root)),
		Repos:   res.Repos,
	}
	var buf bytes.Buffer
	fmt.Fprintf(&buf, "# Made by devdeck from %s. Edit freely.\n", displayRoot(filepath.FromSlash(res.Root)))
	enc := yaml.NewEncoder(&buf)
	enc.SetIndent(2)
	if err := enc.Encode(w); err != nil {
		return "", err
	}
	if err := enc.Close(); err != nil {
		return "", err
	}
	return buf.String(), nil
}
