package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestConnectorGuard(t *testing.T) {
	e := echo.New()
	e.Use(ConnectorGuard())
	ok := func(c echo.Context) error { return c.NoContent(http.StatusNoContent) }
	for _, p := range []string{"/api/v1/health", "/api/v1/runs", "/api/v1/doctor", "/api/v1/workspaces", "/api/v1/workspaces/:id", "/api/v1/hosts", "/api/v1/workspaces/:id/stacks/:stack/logs"} {
		e.GET(p, ok)
	}
	e.POST("/api/v1/workspaces", ok)
	e.PUT("/api/v1/hosts/:ws/:host/token", ok)
	e.GET("/ws", ok)

	tests := []struct {
		name   string
		method string
		path   string
		client string
		want   int
	}{
		{"connector reads health", http.MethodGet, "/api/v1/health", "mcp", http.StatusNoContent},
		{"connector reads runs", http.MethodGet, "/api/v1/runs", "mcp", http.StatusNoContent},
		{"connector reads doctor with a query", http.MethodGet, "/api/v1/doctor?workspace=demo", "mcp", http.StatusNoContent},
		{"connector lists workspaces", http.MethodGet, "/api/v1/workspaces", "mcp", http.StatusNoContent},
		{"connector reads one workspace", http.MethodGet, "/api/v1/workspaces/demo", "MCP", http.StatusNoContent},
		{"connector may not post", http.MethodPost, "/api/v1/workspaces", "mcp", http.StatusForbidden},
		{"connector may not put a token", http.MethodPut, "/api/v1/hosts/demo/dev/token", "mcp", http.StatusForbidden},
		{"connector may not read hosts yet", http.MethodGet, "/api/v1/hosts", "mcp", http.StatusForbidden},
		{"connector may not read logs yet", http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs", "mcp", http.StatusForbidden},
		{"connector may not open the websocket", http.MethodGet, "/ws", "mcp", http.StatusForbidden},
		{"other clients are not limited: post", http.MethodPost, "/api/v1/workspaces", "", http.StatusNoContent},
		{"other clients are not limited: hosts", http.MethodGet, "/api/v1/hosts", "curl", http.StatusNoContent},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.client != "" {
				req.Header.Set(ConnectorHeader, tc.client)
			}
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Errorf("%s %s as %q: got %d, want %d", tc.method, tc.path, tc.client, rec.Code, tc.want)
			}
		})
	}
}
