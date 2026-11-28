package api

import (
	"errors"
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/databases"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// registerConvert adds the conversion to project.yaml (dev-plans/2026-11-22-projects §5, PJ9):
//
//	GET  /workspaces/:id/convert   the project.yaml devdeck would write, which stack files go inline, and its problems
//	POST /workspaces/:id/convert   writes it, only with {"confirm": true}; workspace.yaml and stacks/ are kept as .v1
//
// The databases found for the project are written in too. Offered, never forced.
func registerConvert(g *echo.Group, m *workspace.Manager) {
	decls := func(c echo.Context, id string) ([]workspace.DatabaseDecl, error) {
		d, err := m.Get(id)
		if err != nil {
			return nil, err
		}
		return toDecls(databases.ToDeclare(findDatabases(c.Request().Context(), d))), nil
	}

	g.GET("/workspaces/:id/convert", func(c echo.Context) error {
		id := c.Param("id")
		dbs, err := decls(c, id)
		if err != nil {
			return workspaceError(err)
		}
		conv, err := m.ConvertPreview(id, dbs)
		if err != nil {
			return convertError(err)
		}
		return c.JSON(http.StatusOK, conv)
	})

	g.POST("/workspaces/:id/convert", func(c echo.Context) error {
		var body struct {
			Confirm bool `json:"confirm"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if !body.Confirm {
			return echo.NewHTTPError(http.StatusBadRequest, "this rewrites the project's files: send {\"confirm\": true} to go ahead")
		}
		id := c.Param("id")
		dbs, err := decls(c, id)
		if err != nil {
			return workspaceError(err)
		}
		conv, err := m.Convert(id, dbs)
		if errors.Is(err, workspace.ErrInvalid) {
			return c.JSON(http.StatusUnprocessableEntity, invalidResponse{Message: "the new file would have errors, so nothing was changed", Issues: conv.Issues})
		}
		if err != nil {
			return convertError(err)
		}
		return c.JSON(http.StatusOK, conv)
	})
}

func convertError(err error) error {
	switch {
	case errors.Is(err, workspace.ErrNotFound):
		return echo.NewHTTPError(http.StatusNotFound, "no such project")
	case errors.Is(err, workspace.ErrReadOnly):
		return echo.NewHTTPError(http.StatusForbidden, "example projects can't be converted: add your own project")
	case errors.Is(err, workspace.ErrConverted), errors.Is(err, workspace.ErrOldFilesThere):
		return echo.NewHTTPError(http.StatusConflict, err.Error())
	}
	return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
}
