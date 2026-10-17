// Package api holds the HTTP handlers for the devdeck server.
package api

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// HealthResponse is returned by GET /api/v1/health.
type HealthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
}

// Register mounts the v1 API routes on e.
func Register(e *echo.Echo, version string) {
	v1 := e.Group("/api/v1")
	v1.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, HealthResponse{Status: "ok", Version: version})
	})
}
