// Command devdeck runs the devdeck server.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/api"
	"github.com/shadovxw/devdeck/internal/cli"
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
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// devdeck --pick-folder shows one folder dialog and exits. The server starts
	// itself this way, so the dialog can always be closed by ending the process.
	if len(os.Args) > 1 && os.Args[1] == dialog.ChildArg {
		os.Exit(dialog.RunChild(os.Args[2:], os.Stdout, os.Stderr, dialog.Native))
	}

	// devdeck git-credential is git's credential helper: git runs it, reads its answer, and
	// it exits at once. It never starts the server and never fails git.
	if len(os.Args) > 1 && os.Args[1] == "git-credential" {
		os.Exit(gitx.Command(os.Args[2:], os.Stdin, os.Stdout, os.Stderr, os.Getenv))
	}

	// devdeck agent runs on a remote host, next to its compose stacks; devdeck remote
	// talks to one through an open tunnel, for checking it by hand.
	if len(os.Args) > 1 && (os.Args[1] == "agent" || os.Args[1] == "remote") {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		var code int
		if os.Args[1] == "agent" {
			code = agent.Command(ctx, os.Args[2:], os.Stdout, os.Stderr, version)
		} else {
			code = remote.Command(ctx, os.Args[2:], os.Stdout, os.Stderr, os.Getenv)
		}
		stop()
		os.Exit(code)
	}

	// devdeck up | down | status talk to the running server and exit.
	if len(os.Args) > 1 && slices.Contains(cli.Commands, os.Args[1]) {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
		code := cli.Run(ctx, os.Args[1:], cli.Env{Getenv: os.Getenv, Stdout: os.Stdout, Stderr: os.Stderr})
		stop()
		os.Exit(code)
	}
	// "serve" is the same as no command, for scripts that like to say so.
	if len(os.Args) > 1 && os.Args[1] != "serve" {
		_, _ = fmt.Fprintf(os.Stderr, "devdeck: unknown command %q: try `devdeck help`\n", os.Args[1])
		os.Exit(2)
	}

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

	logStore, err := logs.Open(logs.Options{
		Dir:           cfg.LogDir,
		RetentionDays: cfg.LogRetentionDays,
		MaxBytes:      int64(cfg.LogMaxMB) << 20,
		Settings:      logs.SQLSettings{DB: db.DB},
	})
	if err != nil {
		return err
	}
	logSink := logs.NewSink(logStore, bus)

	sup := supervisor.New(supervisor.Options{
		Bus:     bus,
		Plugins: registry,
		BinDir:  filepath.Join(cfg.DataDir, "bin"),
		Logs:    logSink,
	})

	workspaces := &workspace.Manager{
		Dir:         cfg.WorkspacesDir,
		ExamplesDir: cfg.ExamplesDir,
		ScanRoots:   cfg.ScanRoots,
		Plugins:     func() []string { return pluginIDs(registry) },
	}
	// Remote hosts: their tokens in the OS keychain, their SSM tunnels opened when needed.
	tunnels := &remote.Tunnels{}
	defer tunnels.Close()

	e := echo.New()
	e.HideBanner = true
	e.HidePort = true
	api.Register(e, api.Deps{
		Version:      version,
		Bus:          bus,
		Guard:        guard,
		Hub:          api.NewHub(bus, guard.OriginHosts(), log.Logger),
		Plugins:      registry,
		Supervisor:   sup,
		Logs:         logStore,
		GitX:         gitx.NewService(cfg.DataDir, exePath()),
		FolderPicker: dialog.PickFolder,
		Workspaces:   workspaces,
		Hosts:        &remote.Hosts{Workspaces: workspaces, Secrets: secrets.NewKeyring(), Tunnels: tunnels},
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

	// Stop what devdeck started first, so closing it leaves no processes behind.
	stopCtx, stopCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer stopCancel()
	sup.StopAll(stopCtx)
	// Everything the services printed is stored and on disk before devdeck exits.
	logSink.Close()
	if err := logStore.Close(); err != nil {
		log.Warn().Err(err).Msg("closing the service logs")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return e.Shutdown(shutdownCtx)
}

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
