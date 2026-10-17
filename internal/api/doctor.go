package api

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

func registerDoctor(g *echo.Group, m *workspace.Manager, reg *sdk.Registry) {
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
