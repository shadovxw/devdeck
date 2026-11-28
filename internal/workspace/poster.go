package workspace

import (
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// A project's poster (dev-plans/2026-11-28-project-posters) is the one file on disk whose bytes go to
// the browser. Its path comes only from the project file: a local .svg or .png of at most 2 MB.

const (
	maxPoster = 2 << 20
	// maxPosterLinks stops a loop of links.
	maxPosterLinks = 40
)

// ErrNoPoster means there is no poster to serve: none is set, or the file doesn't pass the checks.
var ErrNoPoster = errors.New("no poster")

// posterError is why a poster can't be shown. Its text is the warning on the project file, written as a
// sentence, and it never names a path.
type posterError string

func (e posterError) Error() string { return string(e) }

const (
	errPosterWeb     posterError = "The poster must be a file on this machine, not a web address."
	errPosterNetwork posterError = "The poster can't be on a network path: use a file on this machine."
	errPosterType    posterError = "The poster must be an .svg or .png file."
	errPosterMissing posterError = "The poster file isn't there, or can't be read."
	errPosterNotFile posterError = "The poster path isn't a file."
	errPosterBig     posterError = "The poster is over 2 MB."
	errPosterContent posterError = "The poster isn't a real PNG or SVG image."
)

var pngSignature = []byte("\x89PNG\r\n\x1a\n")

// networkPath reports a path that could reach another machine: a UNC or device path, with either
// slash. It looks at the text only, because on Windows even looking such a path up can make the
// machine connect and sign in to that server.
func networkPath(p string) bool {
	p = strings.ReplaceAll(p, `\`, "/")
	return strings.HasPrefix(p, "//") || strings.HasPrefix(p, "/??/")
}

var posterTypes = map[string]string{".png": "image/png", ".svg": "image/svg+xml"}

func posterType(path string) string { return posterTypes[strings.ToLower(filepath.Ext(path))] }

// findPoster resolves a project file's poster setting to a real file, without reading it. value
// resolves like root. Everything that can be refused from the text is refused before the disk is touched.
func findPoster(dir, value string) (string, fs.FileInfo, error) {
	switch {
	case strings.Contains(value, "://"):
		return "", nil, errPosterWeb
	case networkPath(value):
		return "", nil, errPosterNetwork
	}
	path := ResolveRoot(dir, value)
	if networkPath(path) {
		return "", nil, errPosterNetwork
	}
	if posterType(path) == "" {
		return "", nil, errPosterType
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", nil, errPosterMissing
	}
	resolved, err := followLinks(abs)
	if err != nil {
		return "", nil, err
	}
	if posterType(resolved) == "" {
		return "", nil, errPosterType
	}
	info, err := os.Lstat(resolved)
	switch {
	case err != nil:
		return "", nil, errPosterMissing
	case !info.Mode().IsRegular():
		return "", nil, errPosterNotFile
	case info.Size() > maxPoster:
		return "", nil, errPosterBig
	}
	return resolved, info, nil
}

// followLinks resolves the links in an absolute path one part at a time, so that a link to a network
// path is refused before anything follows it (Stat and Open would follow it, and connect).
func followLinks(path string) (string, error) {
	sep := string(filepath.Separator)
	for hops := 0; hops <= maxPosterLinks; hops++ {
		vol := filepath.VolumeName(path)
		cur := vol + sep
		parts := strings.Split(strings.Trim(path[len(vol):], sep), sep)
		linked := false
		for i, part := range parts {
			next := filepath.Join(cur, part)
			info, err := os.Lstat(next)
			if err != nil {
				return "", errPosterMissing
			}
			// A Windows junction shows as irregular, not as a symlink.
			if info.Mode()&(fs.ModeSymlink|fs.ModeIrregular) == 0 {
				cur = next
				continue
			}
			target, err := os.Readlink(next)
			if err != nil {
				if info.Mode()&fs.ModeSymlink != 0 {
					return "", errPosterMissing
				}
				cur = next // some other special file, such as a cloud placeholder
				continue
			}
			if networkPath(target) {
				return "", errPosterNetwork
			}
			switch {
			case filepath.IsAbs(target):
			case strings.HasPrefix(filepath.FromSlash(target), sep): // Windows: rooted, on the same drive
				target = vol + target
			default:
				target = filepath.Join(cur, target)
			}
			path = filepath.Join(append([]string{target}, parts[i+1:]...)...)
			linked = true
			break
		}
		if !linked {
			return cur, nil
		}
	}
	return "", errPosterMissing
}

// checkPoster is the warning for a poster that can't be shown. It never stops a project loading or saving.
func checkPoster(p *parsed, w *WorkspaceFile, dir string) []Issue {
	if w.Poster == "" {
		return nil
	}
	if _, _, err := findPoster(dir, w.Poster); err != nil {
		return []Issue{p.warn("/poster", err.Error())}
	}
	return nil
}

// posterURL is where the browser gets a project's poster, or "" when there is none to show. It changes
// when the file does, so a changed poster is never served from the browser's cache.
func posterURL(id, dir, value string) string {
	if value == "" {
		return ""
	}
	_, info, err := findPoster(dir, value)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("/api/v1/workspaces/%s/poster?v=%x-%x", url.PathEscape(id), info.ModTime().UnixNano(), info.Size())
}

// Poster returns a project's poster and its content type. The content is checked as well as the name,
// so only a real PNG or SVG is ever sent.
func (s *Manager) Poster(id string) ([]byte, string, error) {
	d, err := s.Get(id)
	if err != nil {
		return nil, "", err
	}
	if d.Workspace == nil || d.Workspace.Poster == "" {
		return nil, "", ErrNoPoster
	}
	data, kind, err := readPoster(d.Folder, d.Workspace.Poster)
	if err != nil {
		return nil, "", fmt.Errorf("%w: %w", ErrNoPoster, err)
	}
	return data, kind, nil
}

func readPoster(dir, value string) ([]byte, string, error) {
	path, _, err := findPoster(dir, value)
	if err != nil {
		return nil, "", err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, "", errPosterMissing
	}
	defer func() { _ = f.Close() }()
	// One byte over the limit shows a file that grew since it was looked at.
	data, err := io.ReadAll(io.LimitReader(f, maxPoster+1))
	switch {
	case err != nil:
		return nil, "", errPosterMissing
	case len(data) > maxPoster:
		return nil, "", errPosterBig
	}
	kind := posterType(path)
	if (kind == "image/png" && !bytes.HasPrefix(data, pngSignature)) || (kind == "image/svg+xml" && !isSVG(data)) {
		return nil, "", errPosterContent
	}
	return data, kind, nil
}

// isSVG reports whether data is well-formed XML whose root element is svg.
func isSVG(data []byte) bool {
	d := xml.NewDecoder(bytes.NewReader(data))
	// Only the structure is looked at, so a declared encoding other than UTF-8 is read as it is.
	d.CharsetReader = func(_ string, r io.Reader) (io.Reader, error) { return r, nil }
	root := ""
	for {
		t, err := d.Token()
		if errors.Is(err, io.EOF) {
			return root == "svg"
		}
		if err != nil {
			return false
		}
		if el, ok := t.(xml.StartElement); ok && root == "" {
			root = el.Name.Local
		}
	}
}
