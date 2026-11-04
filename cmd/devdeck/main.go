// Command devdeck runs the devdeck server.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"strings"
	"syscall"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/shadovxw/devdeck/internal/agent"
	"github.com/shadovxw/devdeck/internal/cli"
	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/desktop"
	"github.com/shadovxw/devdeck/internal/dialog"
	"github.com/shadovxw/devdeck/internal/dockerx"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/mcp"
	"github.com/shadovxw/devdeck/internal/remote"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/server"
)

// version is overridden at build time with -ldflags "-X main.version=...".
var version = "dev"

func main() {
	// The desktop build opens its window when it is started with no command, as a
	// double click does. devdeck serve is still the headless server.
	if len(os.Args) == 1 && desktop.DefaultToWindow {
		os.Args = append(os.Args, "app")
	}
	// devdeck --pick-folder shows one folder dialog and exits. The server starts
	// itself this way, so the dialog can always be closed by ending the process.
	if len(os.Args) > 1 && os.Args[1] == dialog.ChildArg {
		os.Exit(dialog.RunChild(os.Args[2:], os.Stdout, os.Stderr, dialog.Native))
	}

	// docker-credential-devdeck is docker's credential helper while devdeck builds an image: a
	// build runs docker with a private config that names it, and puts a copy of this program
	// under that name on the PATH. `devdeck docker-credential <verb>` is the same, for trying it.
	// It reads the account's token from the keychain itself; it never starts the server.
	if name := strings.TrimSuffix(strings.ToLower(filepath.Base(os.Args[0])), ".exe"); name == dockerx.HelperName {
		os.Exit(dockerx.CredentialCommand(os.Args[1:], os.Stdin, os.Stdout, os.Getenv, secrets.NewKeyring()))
	}
	if len(os.Args) > 1 && os.Args[1] == "docker-credential" {
		os.Exit(dockerx.CredentialCommand(os.Args[2:], os.Stdin, os.Stdout, os.Getenv, secrets.NewKeyring()))
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

	// devdeck mcp is the Claude Code connector: Claude Code starts it and talks to it on
	// stdin and stdout. It reads the running devdeck and never starts the server.
	if len(os.Args) > 1 && os.Args[1] == "mcp" {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		code := mcp.Command(ctx, os.Args[2:], mcp.OSEnv(version))
		stop()
		os.Exit(code)
	}

	// devdeck app shows devdeck in a window of its own (a build made with -tags desktop).
	if len(os.Args) > 1 && os.Args[1] == "app" {
		cfg, err := config.Load(os.Getenv)
		if err != nil {
			fmt.Fprintln(os.Stderr, "devdeck:", err)
			os.Exit(1)
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		err = desktop.Run(ctx, cfg, version)
		stop()
		if err != nil {
			fmt.Fprintln(os.Stderr, "devdeck:", err)
			os.Exit(1)
		}
		os.Exit(0)
	}

	// devdeck workspace check | schema read files and exit: no server needed.
	if len(os.Args) > 1 && slices.Contains(cli.WorkspaceCommands, os.Args[1]) {
		if os.Args[1] == "schema" {
			os.Exit(cli.Schema(os.Args[2:], os.Stdout, os.Stderr))
		}
		os.Exit(cli.Workspace(os.Args[2:], os.Getenv, os.Stdout, os.Stderr))
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
	server.SetLogLevel(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()

	srv, err := server.New(ctx, cfg, version)
	if err != nil {
		return err
	}
	return srv.Run(ctx, version)
}
