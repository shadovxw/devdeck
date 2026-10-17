// Package config loads devdeck's runtime settings from the environment.
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/rs/zerolog"
)

// Config is the server's runtime configuration.
type Config struct {
	// Addr is the listen address. Always loopback (plan §6.1).
	Addr string
	// DataDir holds state.db and other local state.
	DataDir string
	// WorkspacesDir holds the user's own workspaces, one folder each.
	WorkspacesDir string
	// ExamplesDir optionally holds read-only sample workspaces.
	ExamplesDir string
	// ScanRoots are the folders the workspace scanner may look inside. Empty means
	// the user's home folder.
	ScanRoots []string
	// LogLevel is the zerolog level for devdeck's own log.
	LogLevel zerolog.Level
	// ExtraOrigins are additional browser origins allowed to call the API,
	// e.g. the Vite dev server. The server's own origins are always allowed.
	ExtraOrigins []string
}

const (
	defaultAddr     = "127.0.0.1:7070"
	defaultLogLevel = "info"
)

// Load reads configuration from environment variables:
//
//	DEVDECK_ADDR           listen address, loopback only (default 127.0.0.1:7070)
//	DEVDECK_DATA_DIR       data directory (default <user config dir>/devdeck)
//	DEVDECK_WORKSPACES_DIR workspaces folder (default <data dir>/workspaces)
//	DEVDECK_EXAMPLES_DIR   sample workspaces folder (default none)
//	DEVDECK_SCAN_ROOTS     comma-separated folders the workspace scanner may look inside (default your home folder)
//	DEVDECK_LOG_LEVEL      zerolog level (default info)
//	DEVDECK_EXTRA_ORIGINS  comma-separated extra allowed origins
func Load(getenv func(string) string) (Config, error) {
	addr := orDefault(getenv("DEVDECK_ADDR"), defaultAddr)
	if err := checkLoopback(addr); err != nil {
		return Config{}, err
	}

	level, err := zerolog.ParseLevel(orDefault(getenv("DEVDECK_LOG_LEVEL"), defaultLogLevel))
	if err != nil {
		return Config{}, fmt.Errorf("DEVDECK_LOG_LEVEL: %w", err)
	}

	dataDir := getenv("DEVDECK_DATA_DIR")
	if dataDir == "" {
		base, err := os.UserConfigDir()
		if err != nil {
			return Config{}, fmt.Errorf("find user config dir (set DEVDECK_DATA_DIR): %w", err)
		}
		dataDir = filepath.Join(base, "devdeck")
	}

	return Config{
		Addr:          addr,
		DataDir:       dataDir,
		WorkspacesDir: orDefault(getenv("DEVDECK_WORKSPACES_DIR"), filepath.Join(dataDir, "workspaces")),
		ExamplesDir:   getenv("DEVDECK_EXAMPLES_DIR"),
		ScanRoots:     splitList(getenv("DEVDECK_SCAN_ROOTS")),
		LogLevel:      level,
		ExtraOrigins:  splitList(getenv("DEVDECK_EXTRA_ORIGINS")),
	}, nil
}

// checkLoopback rejects any listen address that is reachable from the network.
func checkLoopback(addr string) error {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("DEVDECK_ADDR %q: %w", addr, err)
	}
	if host == "localhost" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf("DEVDECK_ADDR %q: must be a loopback address (127.0.0.1, [::1] or localhost)", addr)
}

func orDefault(v, def string) string {
	if v == "" {
		return def
	}
	return v
}

func splitList(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}
