// Command devdeck runs the devdeck server.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/shadovxw/devdeck/internal/api"
	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/store"
	"github.com/shadovxw/devdeck/plugins"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.TimeOnly}).With().Timestamp().Logger()

	if err := run(); err != nil {
		log.Fatal().Err(err).Msg("devdeck failed")
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	zerolog.SetGlobalLevel(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	db, err := store.Open(ctx, filepath.Join(cfg.DataDir, "state.db"))
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	registry, err := plugins.NewRegistry()
	if err != nil {
		return err
	}

	bus := events.NewBus()
	guard, err := api.NewGuard(cfg.Addr, cfg.ExtraOrigins)
	if err != nil {
		return err
	}

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	api.Register(e, api.Deps{
		Version: version,
		Bus:     bus,
		Guard:   guard,
		Hub:     api.NewHub(bus, guard.OriginHosts(), log.Logger),
		Plugins: registry,
	})

	serverErr := make(chan error, 1)
	go func() {
		log.Info().Str("addr", cfg.Addr).Str("data", cfg.DataDir).Str("version", version).Msg("devdeck listening")
		if err := e.Start(cfg.Addr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		return err
	case <-ctx.Done():
	}
	log.Info().Msg("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return e.Shutdown(shutdownCtx)
}
