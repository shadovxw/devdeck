package logs

import (
	"os"
	"path/filepath"
	"strings"
)

// Clear deletes what is stored of a stack: the lines in memory, the day files and
// the error groups, of one service or (with an empty service) of all of them. It
// returns how many files it removed. Capture rules are kept. A service that is
// still printing simply starts a new file.
func (s *Store) Clear(workspace, stack, service string) (int, error) {
	if !validNames(workspace, stack, service) {
		return 0, ErrBadName
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	var dirs []string
	for k, sv := range s.svcs {
		if k.workspace != workspace || k.stack != stack || (service != "" && k.service != service) {
			continue
		}
		if sv.file != nil {
			_ = sv.file.close()
			sv.file = nil
		}
		sv.ring = newRing(s.o.Capacity)
		dirs = append(dirs, s.serviceDir(k))
	}
	// Services not read in yet have folders too.
	if service != "" {
		dirs = append(dirs, s.serviceDir(svcKey{workspace, stack, service}))
	} else if entries, err := os.ReadDir(filepath.Join(s.o.Dir, workspace, stack)); err == nil {
		for _, e := range entries {
			if e.IsDir() {
				name := strings.ReplaceAll(e.Name(), "__", "/")
				if serviceName.MatchString(name) && !strings.Contains(name, "..") {
					dirs = append(dirs, s.serviceDir(svcKey{workspace, stack, name}))
				}
			}
		}
	}

	removed := 0
	seen := map[string]bool{}
	for _, dir := range dirs {
		if seen[dir] {
			continue
		}
		seen[dir] = true
		if !strings.HasPrefix(dir, filepath.Clean(s.o.Dir)+string(filepath.Separator)) {
			continue // never delete outside the log folder, whatever the names were
		}
		removed += len(dayFiles(dir))
		if err := os.RemoveAll(dir); err != nil {
			return removed, err
		}
	}

	if service == "" {
		delete(s.groups, stackKey{workspace, stack})
	} else {
		byPrint := s.groups[stackKey{workspace, stack}]
		for fp, g := range byPrint {
			if g.Service == service {
				delete(byPrint, fp)
			}
		}
	}
	return removed, nil
}
