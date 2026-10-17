package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/sdk"
)

// pluginDTO is one plugin as the UI sees it: its manifest plus a live status.
type pluginDTO struct {
	sdk.Manifest
	Status sdk.ToolStatus `json:"status"`
}

func registerPlugins(g *echo.Group, reg *sdk.Registry) {
	// GET /plugins lists every plugin with a freshly run Check.
	g.GET("/plugins", func(c echo.Context) error {
		statuses := reg.CheckAll(c.Request().Context())
		list := reg.List()
		out := make([]pluginDTO, len(list))
		for i, p := range list {
			m := p.Manifest()
			out[i] = pluginDTO{Manifest: m, Status: statuses[m.ID]}
		}
		return c.JSON(http.StatusOK, out)
	})

	// POST /plugins/:id/check re-runs one plugin's Check.
	g.POST("/plugins/:id/check", func(c echo.Context) error {
		p, ok := reg.Get(c.Param("id"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such plugin")
		}
		return c.JSON(http.StatusOK, pluginDTO{Manifest: p.Manifest(), Status: p.Check(c.Request().Context())})
	})
}
