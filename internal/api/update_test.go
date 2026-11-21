package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/update"
	"github.com/shadovxw/devdeck/sdk"
)

// updateServer is a server with the About routes, asking a fake GitHub that answers with status and body.
func updateServer(t *testing.T, current string, status int, body string) http.Handler {
	t.Helper()
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(gh.Close)
	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: current, Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()), Plugins: sdk.NewRegistry(),
		Updates: update.NewCheckerFor(current, gh.URL, "acme/demo-app", gh.Client()),
	})
	return e
}

func updateState(t *testing.T, rec *httptest.ResponseRecorder) update.State {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var s update.State
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

const demoRelease = `{"tag_name":"v0.2.0","html_url":"https://github.com/acme/demo-app/releases/tag/v0.2.0","published_at":"2026-11-21T10:00:00Z"}`

func TestUpdateRoutes(t *testing.T) {
	tests := []struct {
		name      string
		current   string
		status    int
		body      string
		dev       bool
		latest    string
		available bool
		failed    bool
	}{
		{name: "newer release", current: "0.1.0", status: 200, body: demoRelease, latest: "0.2.0", available: true},
		{name: "up to date", current: "0.2.0", status: 200, body: demoRelease, latest: "0.2.0"},
		{name: "development build", current: "dev", status: 200, body: demoRelease, dev: true},
		{name: "GitHub fails", current: "0.1.0", status: 502, body: ``, failed: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := updateServer(t, tt.current, tt.status, tt.body)

			before := updateState(t, callAPI(h, http.MethodGet, "/api/v1/update", "", nil))
			if before.Current != tt.current || before.Latest != "" || !before.CheckedAt.IsZero() {
				t.Errorf("before a check: %+v", before)
			}

			s := updateState(t, callAPI(h, http.MethodPost, "/api/v1/update/check", "", nil))
			if s.Dev != tt.dev || s.Latest != tt.latest || s.Available != tt.available || (s.Error != "") != tt.failed {
				t.Errorf("after a check: %+v", s)
			}

			after := updateState(t, callAPI(h, http.MethodGet, "/api/v1/update", "", nil))
			if after != s {
				t.Errorf("GET after the check = %+v, want %+v", after, s)
			}
		})
	}
}

func TestUpdateRoutesKeepTheGuard(t *testing.T) {
	h := updateServer(t, "0.1.0", 200, demoRelease)
	rec := callAPI(h, http.MethodPost, "/api/v1/update/check", "", map[string]string{"Origin": "https://example.com"})
	if rec.Code != http.StatusForbidden {
		t.Fatalf("a check from another site: status %d, want 403", rec.Code)
	}
}
