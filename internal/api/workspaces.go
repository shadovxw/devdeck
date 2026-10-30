package api

import (
	"errors"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// maxBody keeps a stray upload from filling memory; real workspace files are tiny.
const maxBody = 512 << 10

// limitBody rejects request bodies over maxBody. Echo's own middleware package
// would add a dependency for what is a few lines.
func limitBody(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		if c.Request().ContentLength > maxBody {
			return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "that is too large")
		}
		c.Request().Body = http.MaxBytesReader(c.Response(), c.Request().Body, maxBody)
		return next(c)
	}
}

type validateRequest struct {
	Kind        workspace.Kind `json:"kind"`
	YAML        string         `json:"yaml"`
	WorkspaceID string         `json:"workspace_id"`
}

type validateResponse struct {
	Valid  bool              `json:"valid"`
	Issues []workspace.Issue `json:"issues"`
}

type scanRequest struct {
	Root string `json:"root"`
}

type createRequest struct {
	YAML string `json:"yaml"`
}

type invalidResponse struct {
	Message string            `json:"message"`
	Issues  []workspace.Issue `json:"issues"`
}

func registerWorkspaces(g *echo.Group, m *workspace.Manager, sup *supervisor.Supervisor) {
	ws := g.Group("/workspaces", limitBody)

	ws.GET("", func(c echo.Context) error {
		return c.JSON(http.StatusOK, m.List())
	})

	// The fixed paths below are registered before /:id; Echo prefers them anyway.
	ws.POST("/validate", func(c echo.Context) error {
		var req validateRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		switch req.Kind {
		case workspace.KindWorkspace, workspace.KindStack, workspace.KindFlow:
		default:
			return echo.NewHTTPError(http.StatusBadRequest, "kind must be workspace, stack or flow")
		}
		issues := m.Validate(req.Kind, req.YAML, req.WorkspaceID)
		if issues == nil {
			issues = []workspace.Issue{}
		}
		return c.JSON(http.StatusOK, validateResponse{Valid: !workspace.HasErrors(issues), Issues: issues})
	})

	ws.POST("/scan", func(c echo.Context) error {
		var req scanRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		root := strings.TrimSpace(req.Root)
		if root == "" {
			return echo.NewHTTPError(http.StatusBadRequest, "choose a folder to scan")
		}
		abs := workspace.ResolveRoot("", root)
		if !filepath.IsAbs(abs) {
			return echo.NewHTTPError(http.StatusBadRequest, "write the full path of the folder, for example ~/code")
		}
		res, err := m.Scan(abs)
		if err != nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		return c.JSON(http.StatusOK, res)
	})

	ws.POST("", func(c echo.Context) error {
		var req createRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		sum, issues, err := m.Create(req.YAML)
		switch {
		case errors.Is(err, workspace.ErrInvalid):
			return c.JSON(http.StatusUnprocessableEntity, invalidResponse{Message: err.Error(), Issues: issues})
		case errors.Is(err, workspace.ErrExists):
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		case errors.Is(err, workspace.ErrNoDir):
			return echo.NewHTTPError(http.StatusServiceUnavailable, err.Error())
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be saved")
		}
		return c.JSON(http.StatusCreated, sum)
	})

	// GET /:id/file is workspace.yaml as text, for the editor.
	ws.GET("/:id/file", func(c echo.Context) error {
		text, err := m.YAML(c.Param("id"))
		switch {
		case errors.Is(err, workspace.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
		}
		return c.JSON(http.StatusOK, map[string]string{"yaml": text})
	})

	// PUT /:id replaces the workspace's workspace.yaml with new text. The text is checked first;
	// the name can't change; a sample can't be changed. The old file is kept as workspace.yaml.prev.
	ws.PUT("/:id", func(c echo.Context) error {
		var req createRequest
		if err := c.Bind(&req); err != nil {
			return bindError(err)
		}
		sum, issues, err := m.Update(c.Param("id"), req.YAML)
		switch {
		case errors.Is(err, workspace.ErrInvalid):
			return c.JSON(http.StatusUnprocessableEntity, invalidResponse{Message: err.Error(), Issues: issues})
		case errors.Is(err, workspace.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		case errors.Is(err, workspace.ErrReadOnly):
			return echo.NewHTTPError(http.StatusForbidden, err.Error())
		case errors.Is(err, workspace.ErrRenameWorkspace):
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be saved")
		}
		return c.JSON(http.StatusOK, sum)
	})

	ws.GET("/:id", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		switch {
		case errors.Is(err, workspace.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
		}
		return c.JSON(http.StatusOK, d)
	})

	// DELETE /:id removes one of the user's own workspaces from devdeck. Its folder
	// moves to .trash, so nothing is lost for good, and the repositories it describes
	// are not touched. A workspace with a running stack can't be deleted.
	ws.DELETE("/:id", func(c echo.Context) error {
		id := c.Param("id")
		if sup != nil {
			for _, r := range sup.List() {
				if r.Workspace == id {
					return echo.NewHTTPError(http.StatusConflict, "stop its running stacks before deleting this workspace")
				}
			}
		}
		err := m.Delete(id)
		switch {
		case errors.Is(err, workspace.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		case errors.Is(err, workspace.ErrReadOnly):
			return echo.NewHTTPError(http.StatusForbidden, err.Error())
		case err != nil:
			c.Logger().Error(err)
			return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be deleted")
		}
		return c.NoContent(http.StatusNoContent)
	})
}

func bindError(err error) error {
	var tooBig *http.MaxBytesError
	if errors.As(err, &tooBig) {
		return echo.NewHTTPError(http.StatusRequestEntityTooLarge, "that is too large")
	}
	return echo.NewHTTPError(http.StatusBadRequest, "that request couldn't be read")
}
