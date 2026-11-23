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
		Updates: update.NewCheckerFor(current, update.Options{API: gh.URL, Downloads: gh.URL, Repo: "acme/demo-app", Client: gh.Client()}),
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

func TestUpdateInstallNeedsConfirmAndADownload(t *testing.T) {
	h := updateServer(t, "0.1.0", 200, demoRelease)
	tests := []struct {
		name, body string
		want       int
	}{
		{name: "no body", body: ``, want: http.StatusBadRequest},
		{name: "not confirmed", body: `{"confirm":false}`, want: http.StatusBadRequest},
		{name: "confirmed, nothing downloaded", body: `{"confirm":true}`, want: http.StatusConflict},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if rec := callAPI(h, http.MethodPost, "/api/v1/update/install", tt.body, nil); rec.Code != tt.want {
				t.Fatalf("status %d, want %d: %s", rec.Code, tt.want, rec.Body.String())
			}
		})
	}
}

func TestUpdateDownloadSaysWhyNot(t *testing.T) {
	// A copy that wasn't installed by the installer (as in a test) can't download an update.
	h := updateServer(t, "0.1.0", 200, demoRelease)
	_ = callAPI(h, http.MethodPost, "/api/v1/update/check", "", nil)
	s := updateState(t, callAPI(h, http.MethodPost, "/api/v1/update/download", "", nil))
	if s.Installable || s.Ready != "" || s.Error == "" {
		t.Fatalf("state = %+v", s)
	}
}

func TestUpdateAutoSetting(t *testing.T) {
	h := updateServer(t, "0.1.0", 200, demoRelease)
	if s := updateState(t, callAPI(h, http.MethodGet, "/api/v1/update", "", nil)); !s.Auto {
		t.Fatalf("automatic checks must be on by default: %+v", s)
	}
	if s := updateState(t, callAPI(h, http.MethodPut, "/api/v1/update/auto", `{"auto":false}`, nil)); s.Auto {
		t.Fatalf("after turning it off: %+v", s)
	}
	if s := updateState(t, callAPI(h, http.MethodGet, "/api/v1/update", "", nil)); s.Auto {
		t.Fatalf("GET after turning it off: %+v", s)
	}
	for _, body := range []string{``, `{}`, `{"auto":"no"}`} {
		if rec := callAPI(h, http.MethodPut, "/api/v1/update/auto", body, nil); rec.Code != http.StatusBadRequest {
			t.Errorf("body %q: status %d, want 400", body, rec.Code)
		}
	}
}
