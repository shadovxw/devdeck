// Package api holds the HTTP handlers for the devdeck server.
package api

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
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
	// Workspaces is optional: without it the workspace routes aren't mounted.
	Workspaces *workspace.Manager
	// Supervisor is optional too: it adds the routes that start and stop stacks.
	// It needs Workspaces.
	Supervisor *supervisor.Supervisor
	// Logs is optional: it adds the routes that read a stack's collected output and
	// control what is collected. It needs Workspaces.
	Logs *logs.Store
	// FolderPicker is optional: it adds the route that opens the system's folder dialog.
	FolderPicker FolderPicker
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
	if d.FolderPicker != nil {
		registerSystem(v1, d.FolderPicker)
	}
	if d.Workspaces != nil {
		registerWorkspaces(v1, d.Workspaces, d.Supervisor)
		registerDoctor(v1, d.Workspaces, d.Plugins, d.Supervisor)
		registerStackFiles(v1, d.Workspaces, d.Supervisor)
		registerLogFilters(v1, d.Workspaces)
		if d.Logs != nil {
			registerLogs(v1, d.Logs, d.Workspaces)
			registerLogWhere(v1, d.Workspaces)
		}
		if d.Supervisor != nil {
			registerStacks(v1, d.Workspaces, d.Supervisor)
		}
	}
}
