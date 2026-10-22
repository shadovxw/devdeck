package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// registerLogs adds the routes that read a stack's collected output and control
// what is collected. New lines also arrive live, in batches, on the event topic
// logs.<workspace>.<stack> (see logs.Topic) over /ws.
func registerLogs(g *echo.Group, store *logs.Store, m *workspace.Manager) {
	lg := g.Group("/workspaces/:id/stacks/:stack/logs", limitBody)

	// GET returns stored lines, oldest first. service limits it to one service;
	// before and after are entry numbers to page from; limit defaults to 500.
	lg.GET("", func(c echo.Context) error {
		q := logs.Query{Service: c.QueryParam("service")}
		var err error
		if q.Before, err = uintParam(c, "before"); err != nil {
			return err
		}
		if q.After, err = uintParam(c, "after"); err != nil {
			return err
		}
		if v := c.QueryParam("limit"); v != "" {
			n, perr := strconv.Atoi(v)
			if perr != nil || n < 1 {
				return echo.NewHTTPError(http.StatusBadRequest, "limit must be a whole number of 1 or more")
			}
			q.Limit = n
		}
		res, err := store.Query(c.Param("id"), c.Param("stack"), q)
		if errors.Is(err, logs.ErrBadName) {
			return echo.NewHTTPError(http.StatusNotFound, "no such stack or service")
		}
		if err != nil {
			c.Logger().Error(oneLine(err))
			return echo.NewHTTPError(http.StatusInternalServerError, "the logs couldn't be read")
		}
		return c.JSON(http.StatusOK, res)
	})

	// GET .../capture lists what is stored for each service: all, matching or off.
	lg.GET("/capture", func(c echo.Context) error {
		list := store.Captures(c.Param("id"), c.Param("stack"))
		if list == nil {
			list = []logs.CaptureInfo{}
		}
		return c.JSON(http.StatusOK, list)
	})

	// PUT .../capture?service=<id> switches a service's rule at run time (saved, and
	// it beats the stack file). The service is a query parameter because a compose
	// container's id has a slash in it.
	lg.PUT("/capture", func(c echo.Context) error {
		if err := workspaceExists(c, m); err != nil {
			return err
		}
		var rule logs.Rule
		if err := c.Bind(&rule); err != nil {
			return bindError(err)
		}
		service := c.QueryParam("service")
		if err := store.SetOverride(c.Param("id"), c.Param("stack"), service, rule); err != nil {
			if errors.Is(err, logs.ErrBadName) {
				return echo.NewHTTPError(http.StatusNotFound, "no such stack or service")
			}
			if verr := rule.Validate(); verr != nil {
				return echo.NewHTTPError(http.StatusUnprocessableEntity, verr.Error())
			}
			c.Logger().Error(oneLine(err))
			return echo.NewHTTPError(http.StatusInternalServerError, "the rule couldn't be saved")
		}
		return c.JSON(http.StatusOK, captureOf(store, c.Param("id"), c.Param("stack"), service))
	})

	// DELETE .../capture?service=<id> goes back to the stack file's rule.
	lg.DELETE("/capture", func(c echo.Context) error {
		if err := workspaceExists(c, m); err != nil {
			return err
		}
		service := c.QueryParam("service")
		if err := store.ClearOverride(c.Param("id"), c.Param("stack"), service); err != nil {
			if errors.Is(err, logs.ErrBadName) {
				return echo.NewHTTPError(http.StatusNotFound, "no such stack or service")
			}
			c.Logger().Error(oneLine(err))
			return echo.NewHTTPError(http.StatusInternalServerError, "the rule couldn't be reset")
		}
		return c.JSON(http.StatusOK, captureOf(store, c.Param("id"), c.Param("stack"), service))
	})
}

func captureOf(store *logs.Store, workspace, stack, service string) logs.CaptureInfo {
	rule, src := store.Rule(workspace, stack, service)
	return logs.CaptureInfo{Service: service, Rule: rule, Source: src}
}

func uintParam(c echo.Context, name string) (uint64, error) {
	v := c.QueryParam(name)
	if v == "" {
		return 0, nil
	}
	n, err := strconv.ParseUint(v, 10, 64)
	if err != nil {
		return 0, echo.NewHTTPError(http.StatusBadRequest, name+" must be an entry number")
	}
	return n, nil
}

// workspaceExists answers 404 unless the workspace is one devdeck knows, so a
// rule can't be saved for a name nobody has.
func workspaceExists(c echo.Context, m *workspace.Manager) error {
	if _, err := m.Get(c.Param("id")); err != nil {
		if errors.Is(err, workspace.ErrNotFound) {
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		}
		c.Logger().Error(oneLine(err))
		return echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
	}
	return nil
}

// oneLine keeps an error to one line so a name that came from the request can't forge log entries.
func oneLine(err error) string {
	return strings.NewReplacer("\n", " ", "\r", " ").Replace(err.Error())
}
