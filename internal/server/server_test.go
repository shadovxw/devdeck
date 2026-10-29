package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/sdk"
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

func TestStartListensAndDoneIsQuietWhileServing(t *testing.T) {
	srv, err := New(context.Background(), testConfig(t), "test")
	if err != nil {
		t.Fatal(err)
	}
	if srv.Done() != nil {
		t.Error("Done must be nil before Start")
	}
	if err := srv.Start("test"); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-srv.Done():
		t.Errorf("serving stopped on its own: %v", err)
	default:
	}
	if err := srv.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
}

func TestStartReportsWhyItCannotListen(t *testing.T) {
	taken, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer taken.Close()
	tests := []struct {
		name string
		addr string
		want func(error) bool
	}{
		{"address in use", taken.Addr().String(), func(err error) bool { return errors.Is(err, ErrAddrInUse) }},
		{"not an address", "not-an-address", func(err error) bool { return err != nil && !errors.Is(err, ErrAddrInUse) }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			srv, err := New(context.Background(), testConfig(t), "test")
			if err != nil {
				t.Fatal(err)
			}
			srv.Config.Addr = tc.addr
			if err := srv.Start("test"); !tc.want(err) {
				t.Errorf("Start = %v", err)
			}
			// Run takes the same path and still cleans up after a failed start
			if err := srv.Run(context.Background(), "test"); err == nil {
				t.Error("Run should return the listen error")
			}
		})
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

type namedPlugin string

func (p namedPlugin) Manifest() sdk.Manifest { return sdk.Manifest{ID: string(p), Name: string(p)} }
func (namedPlugin) Check(context.Context) sdk.ToolStatus {
	return sdk.ToolStatus{State: sdk.StateOK}
}

func TestPluginIDsListsTheInstalledPlugins(t *testing.T) {
	reg := sdk.NewRegistry()
	if got := pluginIDs(reg); len(got) != 0 {
		t.Errorf("empty registry = %v", got)
	}
	for _, id := range []string{"git", "docker"} {
		if err := reg.Register(namedPlugin(id)); err != nil {
			t.Fatal(err)
		}
	}
	got := pluginIDs(reg)
	slices.Sort(got)
	if !slices.Equal(got, []string{"docker", "git"}) {
		t.Errorf("ids = %v", got)
	}
}
