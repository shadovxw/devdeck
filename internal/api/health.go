// Package api holds the HTTP handlers for the devdeck server.
package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/sdk"
)

// HealthResponse is returned by GET /api/v1/health.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// Deps are the services the HTTP layer needs.
type Deps struct {
	Version string
	Bus     *events.Bus
	Guard   *Guard
	Hub     *Hub
	Plugins *sdk.Registry
}

// Register mounts the API and WebSocket routes on e. Every route sits behind
// the Host/Origin guard.
func Register(e *echo.Echo, d Deps) {
	e.Use(d.Guard.Middleware())

	e.GET("/ws", d.Hub.Handler())

	v1 := e.Group("/api/v1")
	v1.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, HealthResponse{Status: "ok", Version: d.Version})
	})
	registerPlugins(v1, d.Plugins)
}
