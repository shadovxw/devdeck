package api

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// claudeProbe looks for devdeck's connector in Claude Code's settings. Tests replace it so a
// run doesn't depend on whose machine it is.
var claudeProbe = doctor.DetectClaudeConnector

func registerDoctor(g *echo.Group, m *workspace.Manager, reg *sdk.Registry, sup *supervisor.Supervisor) {
	// GET /doctor?workspace=<id>[&stack=<name>] checks the machine for a workspace,
	// or for one stack of it. It only reads; it never installs or changes anything.
	g.GET("/doctor", func(c echo.Context) error {
		id := c.QueryParam("workspace")
		if id == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "choose a workspace to check")
		}
		d, err := m.Get(id)
		if errors.Is(err, workspace.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		}
		if err != nil {
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
		}
		if d.Workspace == nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "this workspace has errors: fix them first, then check the machine")
		}

		rep, err := doctor.Run(c.Request().Context(), doctor.Input{
			Name:      id,
			Workspace: d.Workspace,
			Stacks:    d.Stacks,
			Stack:     c.QueryParam("stack"),
			Root:      workspace.ResolveRoot(d.Folder, d.Workspace.Root),
			Plugins:   reg,
			OwnPorts:  ownPorts(sup, id, c.QueryParam("stack")),
			Probes:    doctor.Probes{ClaudeConnector: claudeProbe},
		})
		switch {
		case errors.Is(err, doctor.ErrNoSuchStack):
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the check couldn't be run")
		}
		return c.JSON(http.StatusOK, rep)
	})
}

// ownPorts are the ports held by stacks devdeck is running, so Doctor doesn't call them taken.
func ownPorts(sup *supervisor.Supervisor, workspaceID, stack string) map[int]bool {
	if sup == nil {
		return nil
	}
	return sup.OwnPorts(workspaceID, stack)
}
