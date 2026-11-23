package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// whereResponse is a place in a source file, for an editor link.
type whereResponse struct {
	// File is the absolute path of a file inside the service's repo.
	File string `json:"file"`
	Line int    `json:"line"`
}

const maxCallerLen = 500

// resolveCaller finds the file a log line's caller ("path/file.go:42") points at,
// inside repoDir and nowhere else. The path may be absolute (then it must already be
// inside the repo, or end the way a file of the repo does), or relative to the repo.
// Paths from another machine (a trace from a Docker build, say) are matched by their
// tail: the longest tail of at least two folders and a name that exists in the repo.
func resolveCaller(repoDir, caller string) (whereResponse, bool) {
	i := strings.LastIndexByte(caller, ':')
	if i <= 0 || len(caller) > maxCallerLen || strings.ContainsRune(caller, 0) {
		return whereResponse{}, false
	}
	line, err := strconv.Atoi(caller[i+1:])
	if err != nil || line < 1 || line > 10_000_000 {
		return whereResponse{}, false
	}
	name := filepath.ToSlash(caller[:i])
	root := filepath.Clean(repoDir)
	prefix := root + string(filepath.Separator)

	regular := func(path string) bool {
		if !strings.HasPrefix(path, prefix) { // never look outside the repo
			return false
		}
		info, err := os.Stat(path)
		return err == nil && info.Mode().IsRegular()
	}

	if filepath.IsAbs(filepath.FromSlash(name)) {
		if abs := filepath.Clean(filepath.FromSlash(name)); regular(abs) {
			return whereResponse{File: abs, Line: line}, true
		}
	}
	parts := strings.Split(strings.Trim(name, "/"), "/")
	for start := 0; start < len(parts); start++ {
		if start > 0 && len(parts)-start < 2 {
			break // a bare file name from elsewhere says too little
		}
		cand := filepath.Join(root, filepath.Join(parts[start:]...))
		if regular(cand) {
			return whereResponse{File: cand, Line: line}, true
		}
	}
	return whereResponse{}, false
}

// repoDirOf is the folder of the repo a service (or a compose container) belongs to.
func repoDirOf(d *workspace.Detail, stack, service string) (string, bool) {
	root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
	if compose, _, isContainer := strings.Cut(service, "/"); isContainer {
		spec, err := supervisor.Plan(d.ID, root, d.Workspace, d.Stacks, stack)
		if err != nil {
			return "", false
		}
		for _, c := range spec.Compose {
			if c.ID == compose {
				return c.Dir, true
			}
		}
		return "", false
	}
	for _, st := range d.Stacks {
		if st.Name != stack {
			continue
		}
		for _, sv := range st.Services {
			if sv.ID != service {
				continue
			}
			for _, r := range d.Workspace.Repos {
				if r.ID == sv.Repo {
					return workspace.JoinInside(root, r.Path)
				}
			}
		}
	}
	return "", false
}

// registerLogWhere adds GET .../logs/where?service=<id>&caller=<file:line>, which says
// where in the service's repo a log line came from, when that file exists.
func registerLogWhere(g *echo.Group, m *workspace.Manager) {
	g.GET("/workspaces/:id/stacks/:stack/logs/where", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		if errors.Is(err, workspace.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		}
		if err != nil {
			c.Logger().Error(oneLine(err))
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
		}
		// Only the user's own workspaces point at real folders.
		if d.Source != workspace.SourceLocal || d.Workspace == nil {
			return echo.NewHTTPError(http.StatusNotFound, "no such file")
		}
		repo, ok := repoDirOf(d, c.Param("stack"), c.QueryParam("service"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such file")
		}
		where, ok := resolveCaller(repo, c.QueryParam("caller"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such file")
		}
		return c.JSON(http.StatusOK, where)
	})
}
