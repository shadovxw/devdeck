package api

import (
	"context"
	"net/http"
	"path/filepath"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/databases"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// findDatabases is what devdeck finds for a project on its own: the databases in the compose files
// its run modes use, and the ones its repos' .env files point at.
func findDatabases(ctx context.Context, d *workspace.Detail) databases.Report {
	if d.Workspace == nil {
		return databases.Report{Databases: []databases.Database{}, Warnings: []databases.Warning{}}
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
	return databases.Find(ctx, compose, env, databases.TCPDial)
}

// declared turns the databases project.yaml names into the databases package's shape.
func declared(list []workspace.DatabaseDecl) []databases.Declared {
	out := make([]databases.Declared, 0, len(list))
	for _, d := range list {
		out = append(out, databases.Declared{ID: d.ID, Engine: d.Engine, Name: d.Name, Compose: d.From.Compose, Local: d.From.Local, URLEnv: d.From.URLEnv, Port: d.Port, UsedBy: d.UsedBy})
	}
	return out
}

// toDecls is the other way: what a conversion writes for the databases found.
func toDecls(list []databases.Declared) []workspace.DatabaseDecl {
	out := make([]workspace.DatabaseDecl, 0, len(list))
	for _, d := range list {
		out = append(out, workspace.DatabaseDecl{ID: d.ID, Engine: d.Engine, Name: d.Name, Port: d.Port, UsedBy: d.UsedBy,
			From: workspace.DatabaseFrom{Compose: d.Compose, Local: d.Local, URLEnv: d.URLEnv}})
	}
	return out
}

// registerDatabases adds GET /workspaces/:id/databases (dev-plans/2026-11-22-projects §6, PJ6):
// the databases in the compose files the project's run modes use, and the ones its repos' .env
// files point at, with who uses each, whether it answers, and what doesn't line up. The ones
// project.yaml names go on top (PJ9). Only names, hosts, ports and database names are returned,
// never a password.
func registerDatabases(g *echo.Group, m *workspace.Manager) {
	g.GET("/workspaces/:id/databases", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		ctx := c.Request().Context()
		rep := findDatabases(ctx, d)
		if len(d.Databases) > 0 {
			rep = databases.Merge(ctx, rep, declared(d.Databases), databases.TCPDial)
		}
		return c.JSON(http.StatusOK, rep)
	})
}
