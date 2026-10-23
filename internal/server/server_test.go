package server

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/config"
)

func testConfig(t *testing.T) config.Config {
	dir := t.TempDir()
	cfg, err := config.Load(func(k string) string {
		switch k {
		case "DEVDECK_DATA_DIR":
			return dir
		case "DEVDECK_ADDR":
			return "127.0.0.1:0"
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	cfg.LogDir = filepath.Join(dir, "logs")
	return cfg
}

func TestServerStartsAnswersAndCloses(t *testing.T) {
	cfg := testConfig(t)
	SetLogLevel(cfg)
	srv, err := New(context.Background(), cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	if srv.Running() != 0 {
		t.Errorf("running = %d", srv.Running())
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	req.Host = cfg.Addr
	rec := httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"version":"test"`) {
		t.Errorf("health = %d %s", rec.Code, rec.Body)
	}
	// this build has no web app, so the app's own paths are not served
	req = httptest.NewRequest(http.MethodGet, "/stacks", nil)
	req.Host = cfg.Addr
	rec = httptest.NewRecorder()
	srv.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Errorf("no UI in a test build = %d", rec.Code)
	}
	if err := srv.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
}

func TestRunStopsWhenTheContextEnds(t *testing.T) {
	cfg := testConfig(t)
	log := zerolog.Nop()
	_ = log
	srv, err := New(context.Background(), cfg, "test")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- srv.Run(ctx, "test") }()
	cancel()
	if err := <-done; err != nil {
		t.Errorf("run: %v", err)
	}
}
