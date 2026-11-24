package api

import (
	"net/http"
	"path/filepath"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/databases"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// registerDatabases adds GET /workspaces/:id/databases (dev-plans/2026-11-22-projects §6, PJ6):
// the databases in the compose files the project's run modes use, and the ones its repos' .env
// files point at, with who uses each, whether it answers, and what doesn't line up. Only names,
// hosts, ports and database names are returned, never a password.
func registerDatabases(g *echo.Group, m *workspace.Manager) {
	g.GET("/workspaces/:id/databases", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		if d.Workspace == nil {
			return c.JSON(http.StatusOK, databases.Report{Databases: []databases.Database{}, Warnings: []databases.Warning{}})
		}
		root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
		repoDir := map[string]string{}
		var env []databases.EnvFile
		for _, r := range d.Workspace.Repos {
			dir, ok := workspace.JoinInside(root, r.Path)
			if !ok {
				continue
			}
			repoDir[r.ID] = dir
			// Values are read here only to find hosts and ports; databases.Find keeps no password.
			if entries, err := supervisor.LoadEnvFile(filepath.Join(dir, ".env")); err == nil {
				env = append(env, databases.EnvFile{Repo: r.ID, Entries: entries})
			}
		}
		var compose []databases.ComposeFile
		seen := map[string]bool{}
		for _, s := range d.Stacks {
			for _, cf := range s.Compose {
				dir, ok := repoDir[cf.Repo]
				if !ok {
					continue
				}
				path, ok := workspace.JoinInside(dir, cf.File)
				if !ok || seen[path] {
					continue
				}
				seen[path] = true
				compose = append(compose, databases.ComposeFile{Repo: cf.Repo, Path: path, Display: cf.Repo + "/" + filepath.ToSlash(cf.File)})
			}
		}
		return c.JSON(http.StatusOK, databases.Find(c.Request().Context(), compose, env, databases.TCPDial))
	})
}
