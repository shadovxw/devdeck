package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// queryFromRequest reads the filters of a log query from the URL: service, level,
// field (each may repeat or be a comma list, except field), regex, since, until and group.
func queryFromRequest(c echo.Context, now time.Time) (logs.Query, error) {
	p := c.QueryParams()
	q := logs.Query{
		Services: listParam(p["service"]),
		Levels:   listParam(p["level"]),
		Regex:    c.QueryParam("regex"),
		Group:    c.QueryParam("group"),
	}
	for _, raw := range p["field"] {
		f, err := logs.ParseField(raw)
		if err != nil {
			return q, err
		}
		q.Fields = append(q.Fields, f)
	}
	var err error
	if q.Since, err = logs.ParseWhen(c.QueryParam("since"), now); err != nil {
		return q, err
	}
	q.Until, err = logs.ParseWhen(c.QueryParam("until"), now)
	return q, err
}

// listParam flattens repeated parameters and comma lists: a=x&a=y,z is x, y, z.
func listParam(values []string) []string {
	var out []string
	for _, v := range values {
		for _, part := range strings.Split(v, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}

// queryRefusal turns a mistake in a query into a 400 with its reason.
func queryRefusal(err error) error {
	var qe *logs.QueryError
	if errors.As(err, &qe) {
		return echo.NewHTTPError(http.StatusBadRequest, qe.Msg)
	}
	return err
}

// registerLogFilters adds the routes for a workspace's saved log filters.
func registerLogFilters(g *echo.Group, m *workspace.Manager) {
	lf := g.Group("/workspaces/:id/log-filters", limitBody)

	fail := func(c echo.Context, err error) error {
		var qe *logs.QueryError
		switch {
		case errors.As(err, &qe):
			return echo.NewHTTPError(http.StatusUnprocessableEntity, qe.Msg)
		case errors.Is(err, workspace.ErrNotFound):
			return echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		case errors.Is(err, workspace.ErrFilterNotFound):
			return echo.NewHTTPError(http.StatusNotFound, err.Error())
		case errors.Is(err, workspace.ErrReadOnly):
			return echo.NewHTTPError(http.StatusForbidden, err.Error())
		case errors.Is(err, workspace.ErrTooManyFilters):
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}
		c.Logger().Error(oneLine(err))
		return echo.NewHTTPError(http.StatusInternalServerError, "the saved filters couldn't be read or written")
	}

	// GET lists the saved filters.
	lf.GET("", func(c echo.Context) error {
		list, err := m.LogFilters(c.Param("id"))
		if err != nil {
			return fail(c, err)
		}
		if list == nil {
			list = []logs.Filter{}
		}
		return c.JSON(http.StatusOK, list)
	})

	// PUT /:filter saves a filter under that id, replacing one with the same id.
	lf.PUT("/:filter", func(c echo.Context) error {
		var f logs.Filter
		if err := c.Bind(&f); err != nil {
			return bindError(err)
		}
		if f.ID != "" && f.ID != c.Param("filter") {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "the id in the body must be the one in the address")
		}
		f.ID = c.Param("filter")
		replaced, err := m.SaveLogFilter(c.Param("id"), f)
		if err != nil {
			return fail(c, err)
		}
		code := http.StatusCreated
		if replaced {
			code = http.StatusOK
		}
		return c.JSON(code, f)
	})

	// DELETE /:filter removes a saved filter.
	lf.DELETE("/:filter", func(c echo.Context) error {
		if err := m.DeleteLogFilter(c.Param("id"), c.Param("filter")); err != nil {
			return fail(c, err)
		}
		return c.NoContent(http.StatusNoContent)
	})
}
