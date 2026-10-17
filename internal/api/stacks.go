package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/doctor"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// stopTimeout bounds one stop request. The services have their own, shorter limits.
const stopTimeout = 60 * time.Second

type startRefusal struct {
	Message string         `json:"message"`
	Report  *doctor.Report `json:"report,omitempty"`
}

func registerStacks(g *echo.Group, m *workspace.Manager, sup *supervisor.Supervisor) {
	// GET /runs lists every stack devdeck has started. Subscribe to the
	// "stacks.*" topic on /ws for changes.
	g.GET("/runs", func(c echo.Context) error {
		runs := sup.List()
		if runs == nil {
			runs = []supervisor.RunStatus{}
		}
		return c.JSON(http.StatusOK, runs)
	})

	st := g.Group("/workspaces/:id/stacks/:stack")

	// POST .../start checks the machine, then starts the stack in the background.
	st.POST("/start", func(c echo.Context) error {
		id, stack := c.Param("id"), c.Param("stack")
		d, err := m.Get(id)
		if errors.Is(err, workspace.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		}
		if err != nil {
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
		}
		// A stack's cmd is a program devdeck runs, so only the user's own workspaces may start.
		if d.Source != workspace.SourceLocal {
			return echo.NewHTTPError(http.StatusForbidden, "sample workspaces can't be started: copy it into your own workspace first")
		}
		if d.Workspace == nil || d.Errors > 0 {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "this workspace has errors: fix them before starting a stack")
		}

		spec, err := supervisor.Plan(id, workspace.ResolveRoot(d.Folder, d.Workspace.Root), d.Workspace, d.Stacks, stack)
		switch {
		case errors.Is(err, supervisor.ErrNoSuchStack):
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		case err != nil:
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}

		run, err := sup.Start(c.Request().Context(), spec)
		var refused *supervisor.PreflightError
		switch {
		case errors.As(err, &refused):
			return c.JSON(http.StatusUnprocessableEntity, startRefusal{Message: refused.Error(), Report: &refused.Report})
		case errors.Is(err, supervisor.ErrAlreadyRunning):
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the stack couldn't be started")
		}
		return c.JSON(http.StatusAccepted, run)
	})

	// POST .../stop stops the stack and waits until nothing is left running.
	st.POST("/stop", func(c echo.Context) error {
		// The caller going away must not leave a half-stopped stack.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(c.Request().Context()), stopTimeout)
		defer cancel()
		err := sup.Stop(ctx, c.Param("id"), c.Param("stack"))
		if errors.Is(err, supervisor.ErrNotRunning) {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		if err != nil {
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the stack couldn't be stopped")
		}
		return c.NoContent(http.StatusNoContent)
	})

	// POST .../services/:service/restart starts one service again, or retries a failed one.
	st.POST("/services/:service/restart", func(c echo.Context) error {
		err := sup.RestartService(c.Param("id"), c.Param("stack"), c.Param("service"))
		if errors.Is(err, supervisor.ErrNotRunning) || errors.Is(err, supervisor.ErrNoSuchService) {
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		}
		if err != nil {
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the service couldn't be restarted")
		}
		return c.NoContent(http.StatusAccepted)
	})
}
