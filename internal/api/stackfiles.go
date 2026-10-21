package api

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

type stackYAMLRequest struct {
	YAML string `json:"yaml"`
}

type stackFileResponse struct {
	YAML string `json:"yaml"`
}

// stackSavedResponse is what a saved stack answers with: where it went, and any
// warnings found in it (errors would have stopped the save).
type stackSavedResponse struct {
	Name   string            `json:"name"`
	File   string            `json:"file"`
	Issues []workspace.Issue `json:"issues"`
}

// registerStackFiles adds the routes that read, add, change and delete a stack's
// file. sup may be nil; when it is set, a stack that is running can't be changed
// or deleted, since the run was planned from the old file.
func registerStackFiles(g *echo.Group, m *workspace.Manager, sup *supervisor.Supervisor) {
	ws := g.Group("/workspaces/:id/stacks", limitBody)

	refuseWhileRunning := func(c echo.Context) error {
		if sup == nil {
			return nil
		}
		if _, running := sup.Status(c.Param("id"), c.Param("stack")); running {
			return echo.NewHTTPError(http.StatusConflict, "stop the stack before changing it")
		}
		return nil
	}

	saved := func(c echo.Context, code int, st *workspace.StackFile, issues []workspace.Issue, err error) error {
		switch {
		case errors.Is(err, workspace.ErrInvalid):
			return c.JSON(http.StatusUnprocessableEntity, invalidResponse{Message: "the stack has errors, so it wasn't saved", Issues: issues})
		case err != nil:
			return stackFileError(c, err)
		}
		if issues == nil {
			issues = []workspace.Issue{}
		}
		return c.JSON(code, stackSavedResponse{Name: st.Name, File: st.File, Issues: issues})
	}

	// GET .../:stack/file is the stack's file as text, for the editor.
	ws.GET("/:stack/file", func(c echo.Context) error {
		text, err := m.StackYAML(c.Param("id"), c.Param("stack"))
		if err != nil {
			return stackFileError(c, err)
		}
		return c.JSON(http.StatusOK, stackFileResponse{YAML: text})
	})

	// POST saves a new stack as stacks/<name>.yaml; the name comes from the YAML.
	ws.POST("", func(c echo.Context) error {
		var req stackYAMLRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		st, issues, err := m.CreateStack(c.Param("id"), req.YAML)
		return saved(c, http.StatusCreated, st, issues, err)
	})

	// PUT replaces the stack's file. The name inside must stay the same.
	ws.PUT("/:stack", func(c echo.Context) error {
		if err := refuseWhileRunning(c); err != nil {
			return err
		}
		var req stackYAMLRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		st, issues, err := m.UpdateStack(c.Param("id"), c.Param("stack"), req.YAML)
		return saved(c, http.StatusOK, st, issues, err)
	})

	// DELETE moves the stack's file to the workspace's .trash/stacks folder.
	ws.DELETE("/:stack", func(c echo.Context) error {
		if err := refuseWhileRunning(c); err != nil {
			return err
		}
		if err := m.DeleteStack(c.Param("id"), c.Param("stack")); err != nil {
			return stackFileError(c, err)
		}
		return c.NoContent(http.StatusNoContent)
	})
}

// stackFileError turns the errors of the stack file methods into plain answers.
func stackFileError(c echo.Context, err error) error {
	switch {
	case errors.Is(err, workspace.ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
	case errors.Is(err, workspace.ErrStackNotFound):
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	case errors.Is(err, workspace.ErrReadOnly):
		return echo.NewHTTPError(http.StatusForbidden, err.Error())
	case errors.Is(err, workspace.ErrStackExists):
		return echo.NewHTTPError(http.StatusConflict, err.Error())
	case errors.Is(err, workspace.ErrRename):
		return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
	}
	c.Logger().Error(err)
	return echo.NewHTTPError(http.StatusInternalServerError, "the stack couldn't be saved")
}
