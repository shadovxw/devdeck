// Package config loads devdeck's runtime settings from the environment.
package config

import (
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
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
	// LogDir holds the service logs devdeck collects (one folder per workspace, stack and service).
	LogDir string
	// LogRetentionDays is how long those files are kept.
	LogRetentionDays int
	// LogMaxMB caps all of them together; the oldest go first.
	LogMaxMB int
	// LogLevel is the zerolog level for devdeck's own log.
	LogLevel zerolog.Level
	// ExtraOrigins are additional browser origins allowed to call the API,
	// e.g. the Vite dev server. The server's own origins are always allowed.
	ExtraOrigins []string
}

const (
	defaultAddr     = "127.0.0.1:7070"
	defaultLogLevel = "info"

	defaultRetentionDays = 7
	defaultLogMaxMB      = 500
)

// positive reads a whole number above zero from the environment, or def when it is unset.
func positive(getenv func(string) string, name string, def int) (int, error) {
	v := strings.TrimSpace(getenv(name))
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("%s %q: must be a whole number of 1 or more", name, v)
	}
	return n, nil
}

// Load reads configuration from environment variables:
//
//	DEVDECK_ADDR           listen address, loopback only (default 127.0.0.1:7070)
//	DEVDECK_DATA_DIR       data directory (default <user config dir>/devdeck)
//	DEVDECK_WORKSPACES_DIR workspaces folder (default <data dir>/workspaces)
//	DEVDECK_EXAMPLES_DIR   sample workspaces folder (default none)
//	DEVDECK_SCAN_ROOTS     comma-separated folders the workspace scanner may look inside (default your home folder)
//	DEVDECK_LOG_LEVEL      zerolog level (default info)
//	DEVDECK_LOG_DIR        where service logs are kept (default <data dir>/logs)
//	DEVDECK_LOG_RETENTION_DAYS  days of service logs to keep (default 7)
//	DEVDECK_LOG_MAX_MB     most space service logs may use, in MB (default 500)
//	DEVDECK_EXTRA_ORIGINS  comma-separated extra allowed origins
func Load(getenv func(string) string) (Config, error) {
	addr, err := ListenAddr(getenv)
	if err != nil {
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

	retention, err := positive(getenv, "DEVDECK_LOG_RETENTION_DAYS", defaultRetentionDays)
	if err != nil {
		return Config{}, err
	}
	maxMB, err := positive(getenv, "DEVDECK_LOG_MAX_MB", defaultLogMaxMB)
	if err != nil {
		return Config{}, err
	}

	return Config{
		Addr:             addr,
		LogDir:           orDefault(getenv("DEVDECK_LOG_DIR"), filepath.Join(dataDir, "logs")),
		LogRetentionDays: retention,
		LogMaxMB:         maxMB,
		DataDir:          dataDir,
		WorkspacesDir:    orDefault(getenv("DEVDECK_WORKSPACES_DIR"), filepath.Join(dataDir, "workspaces")),
		ExamplesDir:      getenv("DEVDECK_EXAMPLES_DIR"),
		ScanRoots:        splitList(getenv("DEVDECK_SCAN_ROOTS")),
		LogLevel:         level,
		ExtraOrigins:     splitList(getenv("DEVDECK_EXTRA_ORIGINS")),
	}, nil
}

// ListenAddr returns the address the server listens on (DEVDECK_ADDR) and that
// the command line talks to. It rejects anything that is not a loopback address.
func ListenAddr(getenv func(string) string) (string, error) {
	addr := orDefault(getenv("DEVDECK_ADDR"), defaultAddr)
	if err := checkLoopback(addr); err != nil {
		return "", err
	}
	return addr, nil
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
