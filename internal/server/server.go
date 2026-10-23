// Package server builds and runs the devdeck server: the store, the event bus, the
// logs, the supervisor, the remote tunnels and the HTTP API (with the web app when the
// build has it). `devdeck serve` and the desktop app both run one of these.
package server

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/shadovxw/devdeck/internal/api"
	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/dialog"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/logs"
	"github.com/shadovxw/devdeck/internal/remote"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/store"
	"github.com/shadovxw/devdeck/internal/supervisor"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/plugins"
	"github.com/shadovxw/devdeck/sdk"
	"github.com/shadovxw/devdeck/web"
)

// Server is a running devdeck: everything it owns, and how to stop it.
type Server struct {
	// Config is what it was started with.
	Config config.Config

	echo     *echo.Echo
	db       *store.Store
	logStore *logs.Store
	logSink  *logs.Sink
	sup      *supervisor.Supervisor
	tunnels  *remote.Tunnels
}

// New opens everything and builds the HTTP handler. Nothing listens until Start.
func New(ctx context.Context, cfg config.Config, version string) (*Server, error) {
	db, err := store.Open(ctx, filepath.Join(cfg.DataDir, "state.db"))
	if err != nil {
		return nil, err
	}
	s := &Server{Config: cfg, db: db}
	if err := s.build(version); err != nil {
		_ = db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Server) build(version string) error {
	cfg := s.Config
	registry, err := plugins.NewRegistry()
	if err != nil {
		return err
	}
	bus := events.NewBus()
	guard, err := api.NewGuard(cfg.Addr, cfg.ExtraOrigins)
	if err != nil {
		return err
	}
	s.logStore, err = logs.Open(logs.Options{
		Dir:           cfg.LogDir,
		RetentionDays: cfg.LogRetentionDays,
		MaxBytes:      int64(cfg.LogMaxMB) << 20,
		Settings:      logs.SQLSettings{DB: s.db.DB},
	})
	if err != nil {
		return err
	}
	s.logSink = logs.NewSink(s.logStore, bus)
	s.sup = supervisor.New(supervisor.Options{
		Bus:     bus,
		Plugins: registry,
		BinDir:  filepath.Join(cfg.DataDir, "bin"),
		Logs:    s.logSink,
	})
	workspaces := &workspace.Manager{
		Dir:         cfg.WorkspacesDir,
		ExamplesDir: cfg.ExamplesDir,
		ScanRoots:   cfg.ScanRoots,
		Plugins:     func() []string { return pluginIDs(registry) },
	}
	// Remote hosts: their tokens in the OS keychain, their SSM tunnels opened when needed.
	s.tunnels = &remote.Tunnels{}

	s.echo = echo.New()
	s.echo.HideBanner = true
	s.echo.HidePort = true
	api.Register(s.echo, api.Deps{
		Version:      version,
		Bus:          bus,
		Guard:        guard,
		Hub:          api.NewHub(bus, guard.OriginHosts(), log.Logger),
		Plugins:      registry,
		Supervisor:   s.sup,
		Logs:         s.logStore,
		GitX:         gitx.NewService(cfg.DataDir, exePath()),
		FolderPicker: dialog.PickFolder,
		Workspaces:   workspaces,
		Hosts:        &remote.Hosts{Workspaces: workspaces, Secrets: secrets.NewKeyring(), Tunnels: s.tunnels},
		UI:           webui.Handler(),
	})
	return nil
}

// Handler is the whole HTTP surface, for a caller that serves it itself.
func (s *Server) Handler() http.Handler { return s.echo }

// Run listens on the configured address until ctx ends or listening fails, then shuts down.
func (s *Server) Run(ctx context.Context, version string) error {
	serverErr := make(chan error, 1)
	go func() {
		log.Info().Str("addr", s.Config.Addr).Str("data", s.Config.DataDir).Str("version", version).Msg("devdeck listening")
		if err := s.echo.Start(s.Config.Addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()
	var err error
	select {
	case err = <-serverErr:
	case <-ctx.Done():
	}
	log.Info().Msg("shutting down")
	if cerr := s.Close(); err == nil {
		err = cerr
	}
	return err
}

// Close stops what devdeck started first, so closing it leaves no processes behind, then
// everything it opened. It is safe to call once.
func (s *Server) Close() error {
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer stopCancel()
	s.sup.StopAll(stopCtx)
	s.tunnels.Close()
	// Everything the services printed is stored and on disk before devdeck exits.
	s.logSink.Close()
	if err := s.logStore.Close(); err != nil {
		log.Warn().Err(err).Msg("closing the service logs")
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := s.echo.Shutdown(shutdownCtx)
	if cerr := s.db.Close(); err == nil {
		err = cerr
	}
	return err
}

// Running is how many stacks devdeck is running now.
func (s *Server) Running() int { return len(s.sup.List()) }

// SetLogLevel applies the configured level to the global logger.
func SetLogLevel(cfg config.Config) { zerolog.SetGlobalLevel(cfg.LogLevel) }

// pluginIDs lists the installed plugins, so flows naming others get a warning.
func pluginIDs(reg *sdk.Registry) []string {
	list := reg.List()
	ids := make([]string, len(list))
	for i, p := range list {
		ids[i] = p.Manifest().ID
	}
	return ids
}

// exePath is where this program is, for git to run as its credential helper. When it can't
// be told, git accounts still work except for the helper setup, which then refuses.
func exePath() string {
	p, err := os.Executable()
	if err != nil {
		return ""
	}
	return p
}
