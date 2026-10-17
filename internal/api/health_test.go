package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/sdk"
)

func newTestServer(t *testing.T) *echo.Echo {
	t.Helper()
	return newTestServerWith(t, sdk.NewRegistry())
}

func newTestServerWith(t *testing.T, reg *sdk.Registry) *echo.Echo {
	t.Helper()
	bus := events.NewBus()
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	e := echo.New()
	Register(e, Deps{
		Version: "test",
		Bus:     bus,
		Guard:   guard,
		Hub:     NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: reg,
	})
	return e
}

func TestHealth(t *testing.T) {
	e := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	req.Host = "127.0.0.1:7070"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	var got HealthResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if want := (HealthResponse{Status: "ok", Version: "test"}); got != want {
		t.Fatalf("body = %+v, want %+v", got, want)
	}
}

func TestHealthIsBehindTheGuard(t *testing.T) {
	e := newTestServer(t)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	req.Host = "evil.example.com:7070"
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
