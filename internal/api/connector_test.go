package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestConnectorGuard(t *testing.T) {
	e := echo.New()
	e.Use(ConnectorGuard(ConnectorPolicy{}))
	ok := func(c echo.Context) error { return c.NoContent(http.StatusNoContent) }
	for _, p := range []string{"/api/v1/health", "/api/v1/runs", "/api/v1/doctor", "/api/v1/workspaces", "/api/v1/workspaces/:id", "/api/v1/hosts", "/api/v1/workspaces/:id/stacks/:stack/logs", "/api/v1/workspaces/:id/stacks/:stack/logs/histogram", "/api/v1/workspaces/:id/stacks/:stack/logs/groups", "/api/v1/workspaces/:id/stacks/:stack/logs/capture", "/api/v1/workspaces/:id/log-filters"} {
		e.GET(p, ok)
	}
	e.POST("/api/v1/workspaces", ok)
	e.DELETE("/api/v1/workspaces/:id/stacks/:stack/logs", ok)
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
		{"connector reads logs", http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs?level=error&limit=50", "mcp", http.StatusNoContent},
		{"connector reads the histogram", http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs/histogram", "mcp", http.StatusNoContent},
		{"connector reads error groups", http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs/groups", "mcp", http.StatusNoContent},
		{"connector may not read what is captured", http.MethodGet, "/api/v1/workspaces/demo/stacks/full/logs/capture", "mcp", http.StatusForbidden},
		{"connector may not read saved filters", http.MethodGet, "/api/v1/workspaces/demo/log-filters", "mcp", http.StatusForbidden},
		{"connector may not delete logs", http.MethodDelete, "/api/v1/workspaces/demo/stacks/full/logs", "mcp", http.StatusForbidden},
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

func TestConnectorHostRoutes(t *testing.T) {
	var on, open bool
	var tail string
	e := echo.New()
	e.Use(ConnectorGuard(ConnectorPolicy{
		Access:        func(area string) bool { return on && area == AreaHosts },
		HostConnected: func(ws, host string) bool { return open && ws == "demo" && host == "dev" },
	}))
	ok := func(c echo.Context) error { return c.NoContent(http.StatusNoContent) }
	for _, p := range []string{"/api/v1/hosts", "/api/v1/hosts/:ws/:host", "/api/v1/hosts/:ws/:host/info", "/api/v1/hosts/:ws/:host/stacks/:stack/services", "/api/v1/hosts/:ws/:host/stacks/:stack/compose"} {
		e.GET(p, ok)
	}
	e.GET("/api/v1/hosts/:ws/:host/stacks/:stack/logs", func(c echo.Context) error {
		tail = c.QueryParam("tail")
		return c.NoContent(http.StatusNoContent)
	})
	e.PUT("/api/v1/hosts/:ws/:host/token", ok)
	e.POST("/api/v1/hosts/:ws/:host/disconnect", ok)
	e.POST("/api/v1/hosts/:ws/:host/stacks/:stack/services/:svc/restart", ok)

	const h = "/api/v1/hosts/demo/dev"
	tests := []struct {
		name      string
		on, open  bool
		method    string
		path      string
		want      int
		wantTail  string
		checkTail bool
	}{
		{"switched off: the list", false, true, http.MethodGet, "/api/v1/hosts", http.StatusForbidden, "", false},
		{"switched off: one host", false, true, http.MethodGet, h, http.StatusForbidden, "", false},
		{"switched off: services", false, true, http.MethodGet, h + "/stacks/app/services", http.StatusForbidden, "", false},
		{"switched on: the list", true, false, http.MethodGet, "/api/v1/hosts", http.StatusNoContent, "", false},
		{"switched on: one host, tunnel closed", true, false, http.MethodGet, h, http.StatusNoContent, "", false},
		{"tunnel closed: info", true, false, http.MethodGet, h + "/info", http.StatusConflict, "", false},
		{"tunnel closed: logs", true, false, http.MethodGet, h + "/stacks/app/logs", http.StatusConflict, "", false},
		{"another host's tunnel doesn't count", true, true, http.MethodGet, "/api/v1/hosts/demo/other/info", http.StatusConflict, "", false},
		{"tunnel open: info", true, true, http.MethodGet, h + "/info", http.StatusNoContent, "", false},
		{"tunnel open: services", true, true, http.MethodGet, h + "/stacks/app/services", http.StatusNoContent, "", false},
		{"tunnel open: compose", true, true, http.MethodGet, h + "/stacks/app/compose", http.StatusNoContent, "", false},
		{"logs without a tail get the cap", true, true, http.MethodGet, h + "/stacks/app/logs", http.StatusNoContent, "200", true},
		{"logs asking for too many get the cap", true, true, http.MethodGet, h + "/stacks/app/logs?tail=5000&service=api", http.StatusNoContent, "200", true},
		{"a small tail is kept", true, true, http.MethodGet, h + "/stacks/app/logs?tail=30", http.StatusNoContent, "30", true},
		{"a tail that isn't a number is left for the handler to refuse", true, true, http.MethodGet, h + "/stacks/app/logs?tail=abc", http.StatusNoContent, "abc", true},
		{"saving a token is refused", true, true, http.MethodPut, h + "/token", http.StatusForbidden, "", false},
		{"closing the tunnel is refused", true, true, http.MethodPost, h + "/disconnect", http.StatusForbidden, "", false},
		{"restarting a service is refused", true, true, http.MethodPost, h + "/stacks/app/services/api/restart", http.StatusForbidden, "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			on, open, tail = tc.on, tc.open, ""
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set(ConnectorHeader, ConnectorClient)
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("%s %s = %d, want %d: %s", tc.method, tc.path, rec.Code, tc.want, rec.Body)
			}
			if tc.checkTail && tail != tc.wantTail {
				t.Errorf("the handler saw tail=%q, want %q", tail, tc.wantTail)
			}
		})
	}
}

func TestFileAccess(t *testing.T) {
	dir := t.TempDir()
	write := func(name, body string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	tests := []struct {
		name string
		path string
		want bool
	}{
		{"no file means off", filepath.Join(dir, "missing.yaml"), false},
		{"hosts on", write("on.yaml", "hosts: true\n"), true},
		{"hosts off", write("off.yaml", "hosts: false\n"), false},
		{"other areas don't switch hosts on", write("other.yaml", "logs: true\n"), false},
		{"unreadable YAML means off", write("bad.yaml", "hosts: [unclosed"), false},
		{"not a map means off", write("list.yaml", "- hosts\n"), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := FileAccess(tc.path)(AreaHosts); got != tc.want {
				t.Errorf("hosts = %v, want %v", got, tc.want)
			}
		})
	}
	// A change applies at once, with no restart.
	p := write("live.yaml", "hosts: false\n")
	access := FileAccess(p)
	if access(AreaHosts) {
		t.Fatal("hosts should start off")
	}
	write("live.yaml", "hosts: true\n")
	if !access(AreaHosts) {
		t.Error("a change to the file wasn't picked up")
	}
}
