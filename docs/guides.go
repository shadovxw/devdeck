package docs

import (
	"bufio"
	"io/fs"
	"regexp"
	"slices"
	"strings"
)

// idPattern is what a guide's id looks like: its file name without .md.
var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,63}$`)

// order lists the guides to show first, in this order; any others follow by name.
var order = []string{"claude-quickstart", "teammate-setup", "workspace-editor", "docker-builds", "remote-versions", "claude-connector", "features", "appearance"}

// Entry is one guide in the list.
type Entry struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// Title is a guide's first heading, or id when it has none.
func Title(id, text string) string {
	sc := bufio.NewScanner(strings.NewReader(text))
	for sc.Scan() {
		if t, ok := strings.CutPrefix(sc.Text(), "# "); ok {
			return strings.TrimSpace(t)
		}
	}
	return id
}

// List reads the guides in fsys, in the order they should be shown.
func List(fsys fs.FS) []Entry {
	files, _ := fs.Glob(fsys, "*.md")
	out := make([]Entry, 0, len(files))
	for _, f := range files {
		id := strings.TrimSuffix(f, ".md")
		if !idPattern.MatchString(id) {
			continue
		}
		text, err := fs.ReadFile(fsys, f)
		if err != nil {
			continue
		}
		out = append(out, Entry{ID: id, Title: Title(id, string(text))})
	}
	rank := func(id string) int {
		if i := slices.Index(order, id); i >= 0 {
			return i
		}
		return len(order)
	}
	slices.SortFunc(out, func(a, b Entry) int {
		if d := rank(a.ID) - rank(b.ID); d != 0 {
			return d
		}
		return strings.Compare(a.ID, b.ID)
	})
	return out
}

// Read is one guide's Markdown. ok is false for an id that isn't a guide in fsys.
func Read(fsys fs.FS, id string) (text string, ok bool) {
	if !idPattern.MatchString(id) {
		return "", false
	}
	b, err := fs.ReadFile(fsys, id+".md")
	if err != nil {
		return "", false
	}
	return string(b), true
}
