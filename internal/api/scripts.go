package api

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/scripts"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// scriptRow is a script as the Scripts tab lists it: what it does, whether it asks first, and
// how its last run went.
type scriptRow struct {
	scripts.Script
	// Writes says the script can change files, so running it needs {"confirm": true}.
	Writes bool         `json:"writes"`
	Last   *scripts.Run `json:"last,omitempty"`
}

// projectScripts is every script of a project, in order: devdeck's starters, the file's own,
// then what the repos have (package.json scripts, Makefile targets). The repos are where the
// scripts run, local_only folders left out (they aren't git repositories).
func projectScripts(d *workspace.Detail) ([]scripts.Script, []scripts.Repo) {
	list := scripts.BuiltIns()
	var repos []scripts.Repo
	if d.Workspace == nil {
		return list, nil
	}
	for _, s := range d.Workspace.Scripts {
		s.Source = scripts.SourceFile
		list = append(list, s)
	}
	root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
	for _, r := range d.Workspace.Repos {
		dir, ok := workspace.JoinInside(root, r.Path)
		if !ok {
			continue
		}
		if !r.LocalOnly {
			repos = append(repos, scripts.Repo{ID: r.ID, Dir: dir})
		}
		list = append(list, scripts.Found(r.ID, dir)...)
	}
	return list, repos
}

// registerScripts adds a project's scripts (dev-plans/2026-11-22-projects §7, PJ4):
//
//	GET  /workspaces/:id/scripts              every script, with its last run
//	POST /workspaces/:id/scripts/:script/run  runs one; {"confirm": true} when it can change files
//	GET  /script-runs/:run                    a run as it stands, repo by repo and step by step
//
// Runs happen on this machine only. A repo with uncommitted changes is skipped before any
// checkout or pull, never reset. Commands run without a shell.
func registerScripts(g *echo.Group, m *workspace.Manager, runner *scripts.Runner) {
	g.GET("/workspaces/:id/scripts", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		list, _ := projectScripts(d)
		last := runner.Latest(d.ID)
		rows := make([]scriptRow, 0, len(list))
		for _, s := range list {
			row := scriptRow{Script: s, Writes: s.Writes()}
			if r, ok := last[s.ID]; ok {
				row.Last = &r
			}
			rows = append(rows, row)
		}
		return c.JSON(http.StatusOK, rows)
	})

	g.POST("/workspaces/:id/scripts/:script/run", func(c echo.Context) error {
		var body struct {
			Confirm bool `json:"confirm"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		if d.Source != workspace.SourceLocal {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "example projects don't run scripts: add your own project")
		}
		list, repos := projectScripts(d)
		s, err := scripts.Find(list, c.Param("script"))
		if err != nil {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		if err := s.Validate(); err != nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		if s.Writes() && !body.Confirm {
			return echo.NewHTTPError(http.StatusBadRequest, "this script can change your files: send {\"confirm\": true} to go ahead")
		}
		if len(scripts.Targets(s, repos)) == 0 {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "this project has no repo for the script to run in")
		}
		return c.JSON(http.StatusAccepted, runner.Start(d.ID, s, repos))
	})

	g.GET("/script-runs/:run", func(c echo.Context) error {
		r, ok := runner.Get(c.Param("run"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such run: it may be too old to be kept")
		}
		return c.JSON(http.StatusOK, r)
	})
}

// workspaceError turns a workspace lookup failure into the right HTTP error.
func workspaceError(err error) error {
	if errors.Is(err, workspace.ErrNotFound) {
		return echo.NewHTTPError(http.StatusNotFound, "no such project")
	}
	return echo.NewHTTPError(http.StatusInternalServerError, "the project couldn't be read")
}
