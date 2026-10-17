package config

import (
	"path/filepath"
	"reflect"
	"testing"

	"github.com/rs/zerolog"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load(env(map[string]string{"DEVDECK_DATA_DIR": "/data"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:7070" || cfg.DataDir != "/data" || cfg.LogLevel != zerolog.InfoLevel || len(cfg.ExtraOrigins) != 0 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestWorkspaceDirs(t *testing.T) {
	cfg, err := Load(env(map[string]string{"DEVDECK_DATA_DIR": "/data"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.WorkspacesDir != filepath.Join("/data", "workspaces") || cfg.ExamplesDir != "" {
		t.Fatalf("defaults: %+v", cfg)
	}
	cfg, err = Load(env(map[string]string{"DEVDECK_DATA_DIR": "/data", "DEVDECK_WORKSPACES_DIR": "/ws", "DEVDECK_EXAMPLES_DIR": "/ex"}))
	if err != nil || cfg.WorkspacesDir != "/ws" || cfg.ExamplesDir != "/ex" {
		t.Fatalf("overrides: %+v %v", cfg, err)
	}
}

func TestLoadOverrides(t *testing.T) {
	cfg, err := Load(env(map[string]string{
		"DEVDECK_ADDR":          "[::1]:9000",
		"DEVDECK_DATA_DIR":      "/data",
		"DEVDECK_LOG_LEVEL":     "debug",
		"DEVDECK_EXTRA_ORIGINS": " http://a:1 , ,http://b:2",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "[::1]:9000" || cfg.LogLevel != zerolog.DebugLevel {
		t.Fatalf("unexpected config: %+v", cfg)
	}
	if want := []string{"http://a:1", "http://b:2"}; !reflect.DeepEqual(cfg.ExtraOrigins, want) {
		t.Fatalf("ExtraOrigins = %v, want %v", cfg.ExtraOrigins, want)
	}
}

func TestLoadRejects(t *testing.T) {
	tests := []struct {
		name string
		env  map[string]string
	}{
		{"all interfaces", map[string]string{"DEVDECK_ADDR": "0.0.0.0:7070"}},
		{"lan address", map[string]string{"DEVDECK_ADDR": "192.168.1.5:7070"}},
		{"empty host", map[string]string{"DEVDECK_ADDR": ":7070"}},
		{"no port", map[string]string{"DEVDECK_ADDR": "127.0.0.1"}},
		{"bad level", map[string]string{"DEVDECK_LOG_LEVEL": "loud"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.env["DEVDECK_DATA_DIR"] = "/data"
			if _, err := Load(env(tt.env)); err == nil {
				t.Fatal("expected an error")
			}
		})
	}
}
