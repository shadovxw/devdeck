// Command devdeck runs the devdeck server.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/shadovxw/devdeck/internal/api"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

// listenAddr is loopback only on purpose: nothing on the network may reach devdeck (plan §6.1).
const listenAddr = "127.0.0.1:7070"

func main() {
	log.Logger = zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.TimeOnly}).With().Timestamp().Logger()

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	api.Register(e, version)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	go func() {
		log.Info().Str("addr", listenAddr).Str("version", version).Msg("devdeck listening")
		if err := e.Start(listenAddr); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("server stopped")
		}
	}()

	<-ctx.Done()
	log.Info().Msg("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("graceful shutdown failed")
	}
}
