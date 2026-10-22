package workspace

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"

	"go.yaml.in/yaml/v3"

	"github.com/shadovxw/devdeck/internal/logs"
)

// logFiltersFile is where a workspace keeps its saved log filters.
const logFiltersFile = "log-filters.yaml"

// maxLogFilters and maxLogFiltersBytes keep the file small enough to read and edit by hand.
const (
	maxLogFilters      = 100
	maxLogFiltersBytes = 256 << 10
)

var (
	// ErrFilterNotFound means the workspace has no saved filter with that id.
	ErrFilterNotFound = errors.New("no such saved filter in this workspace")
	// ErrTooManyFilters means the workspace already has as many saved filters as it may.
	ErrTooManyFilters = errors.New("this workspace has the most saved filters it can have")
)

type logFilters struct {
	Version int           `yaml:"version"`
	Filters []logs.Filter `yaml:"filters"`
}

// filtersMu serialises the read-change-write of the file.
var filtersMu sync.Mutex

func (r *stackRoom) filtersPath() string { return filepath.Join(r.dir, logFiltersFile) }

// readFilters loads the saved filters of a workspace. A missing file means none. The
// file is read strictly: a key it doesn't know is an error, so a typo isn't silently dropped.
func (r *stackRoom) readFilters() ([]logs.Filter, error) {
	data, err := os.ReadFile(r.filtersPath())
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if len(data) > maxLogFiltersBytes {
		return nil, fmt.Errorf("%s is too large (over %d KiB)", logFiltersFile, maxLogFiltersBytes>>10)
	}
	var f logFilters
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&f); err != nil && !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("%s: %w", logFiltersFile, err)
	}
	return f.Filters, nil
}

// writeFilters replaces the file: the text is written aside and renamed over the old
// one, so a failure part way never leaves a half-written file.
func (r *stackRoom) writeFilters(filters []logs.Filter) error {
	data, err := yaml.Marshal(logFilters{Version: 1, Filters: filters})
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(r.dir, ".log-filters-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil { //nolint:gosec // a workspace file, readable like the others
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, r.filtersPath()); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}

// LogFilters lists a workspace's saved log filters. It works for sample workspaces too.
func (s *Manager) LogFilters(workspaceID string) ([]logs.Filter, error) {
	r, err := s.room(workspaceID)
	if err != nil {
		return nil, err
	}
	filtersMu.Lock()
	defer filtersMu.Unlock()
	return r.readFilters()
}

// SaveLogFilter adds a saved filter, or replaces the one with the same id (replaced
// says which). Only the user's own workspaces can be changed. A filter that doesn't
// validate is refused with the reason (a *logs.QueryError).
func (s *Manager) SaveLogFilter(workspaceID string, f logs.Filter) (replaced bool, err error) {
	r, err := s.ownRoom(workspaceID)
	if err != nil {
		return false, err
	}
	if err := f.Validate(); err != nil {
		return false, err
	}
	filtersMu.Lock()
	defer filtersMu.Unlock()
	all, err := r.readFilters()
	if err != nil {
		return false, err
	}
	for i := range all {
		if all[i].ID == f.ID {
			all[i], replaced = f, true
		}
	}
	if !replaced {
		if len(all) >= maxLogFilters {
			return false, ErrTooManyFilters
		}
		all = append(all, f)
	}
	return replaced, r.writeFilters(all)
}

// DeleteLogFilter removes a saved filter.
func (s *Manager) DeleteLogFilter(workspaceID, id string) error {
	r, err := s.ownRoom(workspaceID)
	if err != nil {
		return err
	}
	filtersMu.Lock()
	defer filtersMu.Unlock()
	all, err := r.readFilters()
	if err != nil {
		return err
	}
	kept := all[:0:0]
	for _, f := range all {
		if f.ID != id {
			kept = append(kept, f)
		}
	}
	if len(kept) == len(all) {
		return ErrFilterNotFound
	}
	return r.writeFilters(kept)
}
