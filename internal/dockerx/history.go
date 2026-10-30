package dockerx

import (
	"database/sql"
	"time"
)

// maxBuilds is how many finished builds the history keeps.
const maxBuilds = 500

// Build is one finished build, for the history on the Images page. It holds what was built
// and how it went: never a token, never the build's output.
type Build struct {
	ID         int64     `json:"id"`
	At         time.Time `json:"at"`
	Workspace  string    `json:"workspace"`
	Repo       string    `json:"repo"`
	Image      string    `json:"image"`
	Repository string    `json:"repository"`
	Tag        string    `json:"tag"`
	Revision   string    `json:"revision,omitempty"`
	// Dirty is true when the repository had uncommitted changes.
	Dirty   bool    `json:"dirty"`
	Account string  `json:"account"`
	OK      bool    `json:"ok"`
	Error   string  `json:"error,omitempty"`
	Seconds float64 `json:"seconds"`
}

// History keeps finished builds in the database. A nil DB keeps none.
type History struct{ DB *sql.DB }

// Add notes a finished build and drops the oldest beyond maxBuilds.
func (h *History) Add(b Build) error {
	if h == nil || h.DB == nil {
		return nil
	}
	if b.At.IsZero() {
		b.At = time.Now()
	}
	if _, err := h.DB.Exec(`INSERT INTO image_builds (at, workspace, repo, image, repository, tag, revision, dirty, account, ok, error, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		b.At.UTC().Format(time.RFC3339Nano), b.Workspace, b.Repo, b.Image, b.Repository, b.Tag, b.Revision, b.Dirty, b.Account, b.OK, b.Error, b.Seconds); err != nil {
		return err
	}
	_, _ = h.DB.Exec(`DELETE FROM image_builds WHERE id <= (SELECT MAX(id) FROM image_builds) - ?`, maxBuilds)
	return nil
}

// List returns the newest builds first.
func (h *History) List(limit int) ([]Build, error) {
	out := []Build{}
	if h == nil || h.DB == nil {
		return out, nil
	}
	rows, err := h.DB.Query(`SELECT id, at, workspace, repo, image, repository, tag, revision, dirty, account, ok, error, seconds FROM image_builds ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return out, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var b Build
		var at string
		if err := rows.Scan(&b.ID, &at, &b.Workspace, &b.Repo, &b.Image, &b.Repository, &b.Tag, &b.Revision, &b.Dirty, &b.Account, &b.OK, &b.Error, &b.Seconds); err != nil {
			return out, err
		}
		b.At, _ = time.Parse(time.RFC3339Nano, at)
		out = append(out, b)
	}
	return out, rows.Err()
}

// Newest is the newest build of each image, keyed by "workspace/repo/image".
func (h *History) Newest() (map[string]Build, error) {
	all, err := h.List(maxBuilds)
	if err != nil {
		return nil, err
	}
	out := map[string]Build{}
	for _, b := range all { // newest first, so the first of each key wins
		k := b.Workspace + "/" + b.Repo + "/" + b.Image
		if _, seen := out[k]; !seen {
			out[k] = b
		}
	}
	return out, nil
}

// Clear empties the history.
func (h *History) Clear() error {
	if h == nil || h.DB == nil {
		return nil
	}
	_, err := h.DB.Exec(`DELETE FROM image_builds`)
	return err
}
