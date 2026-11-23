package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/logs"
)

// asConnector sends a request the way `devdeck mcp` does, to devdeck's own address.
func asConnector(h http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, nil)
	req.Host = "127.0.0.1:7070"
	req.Header.Set(ConnectorHeader, ConnectorClient)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestConnectorReadsMaskedLogs takes lines through the real intake (the sink, which
// masks secrets), then reads them the way the connector does, and checks that no
// secret value is in anything the connector can fetch.
func TestConnectorReadsMaskedLogs(t *testing.T) {
	const fake = "hunter2-not-a-real-value"
	e, store := logsServer(t)

	sink := logs.NewSink(store, events.NewBus())
	now := time.Now()
	sink.Line("demo", "full", "api", "stdout", "login failed password="+fake+" user=ana", now)
	sink.Line("demo", "full", "api", "stdout", "calling https://svc:"+fake+"@example.com/v1", now)
	sink.Line("demo", "full", "api", "stderr", `{"level":"error","msg":"bad","api_token":"`+fake+`"}`, now)
	sink.Close() // waits until everything is stored

	base := "/api/v1/workspaces/demo/stacks/full/logs"
	for _, path := range []string{base, base + "?level=error", base + "/histogram", base + "/groups"} {
		rec := asConnector(e, http.MethodGet, path)
		if rec.Code != http.StatusOK {
			t.Errorf("GET %s as the connector = %d, want 200: %s", path, rec.Code, rec.Body)
			continue
		}
		if strings.Contains(rec.Body.String(), fake) {
			t.Errorf("GET %s let a secret through: %s", path, rec.Body)
		}
	}

	if rec := asConnector(e, http.MethodGet, base); !strings.Contains(rec.Body.String(), "login failed") {
		t.Errorf("the lines themselves should still be there: %s", rec.Body)
	}

	// What the connector may not touch stays refused, through the real routes.
	for _, tc := range []struct{ method, path string }{
		{http.MethodDelete, base},
		{http.MethodGet, base + "/capture"},
		{http.MethodPut, base + "/capture?service=api"},
	} {
		if rec := asConnector(e, tc.method, tc.path); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as the connector = %d, want 403", tc.method, tc.path, rec.Code)
		}
	}
}
