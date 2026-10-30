package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"time"

	"github.com/shadovxw/devdeck/internal/config"
)

const usage = `Usage:
  devdeck mcp                 the connector Claude Code starts (speaks MCP on stdin and stdout)
  devdeck mcp install         connect devdeck to Claude Code (runs "claude mcp add" for you)
  devdeck mcp uninstall       take devdeck out of Claude Code again
  devdeck mcp config [--full] print the JSON for a project's .mcp.json

Claude reads what devdeck shows: what is running and the workspaces. It cannot
change anything. devdeck has to be running (DEVDECK_ADDR, default 127.0.0.1:7070).
`

const instructions = "Read-only view of the user's running devdeck, their local developer cockpit. " +
	"Start with devdeck_status to see what is running. Secrets are never available: " +
	"environment variable values are hidden and tokens are not exposed. If a tool says devdeck isn't running, ask the user to open the devdeck app."

// Env is what the command reads and writes. Tests replace the parts they need.
type Env struct {
	Stdin   io.Reader
	Stdout  io.Writer
	Stderr  io.Writer
	Getenv  func(string) string
	Version string
	// Client is used for every call to devdeck. Nil means a client with a timeout.
	Client *http.Client
	// Executable gives the path of this program.
	Executable func() (string, error)
	// LookPath finds a program on the PATH.
	LookPath func(string) (string, error)
	// Run runs a program to its end, wired to out and errw.
	Run func(ctx context.Context, name string, args []string, out, errw io.Writer) error
}

// OSEnv is the Env of the real process.
func OSEnv(version string) Env {
	return Env{
		Stdin:      os.Stdin,
		Stdout:     os.Stdout,
		Stderr:     os.Stderr,
		Getenv:     os.Getenv,
		Version:    version,
		Executable: os.Executable,
		LookPath:   exec.LookPath,
		Run: func(ctx context.Context, name string, args []string, out, errw io.Writer) error {
			cmd := exec.CommandContext(ctx, name, args...) // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command -- only install() calls this: name is the claude found on the PATH, args are fixed (addArgs) plus this program's own path
			cmd.Stdout, cmd.Stderr = out, errw
			return cmd.Run()
		},
	}
}

// Command runs `devdeck mcp` and returns the exit code: 0 done, 1 failed, 2 wrong usage.
// args excludes "mcp". With no args it serves Claude Code until stdin closes.
func Command(ctx context.Context, args []string, env Env) int {
	if len(args) == 0 {
		return serve(ctx, env)
	}
	switch args[0] {
	case "install":
		return install(ctx, env)
	case "uninstall":
		return uninstall(ctx, env)
	case "config":
		return printConfig(args[1:], env)
	case "help", "-h", "--help":
		_, _ = io.WriteString(env.Stdout, usage)
		return 0
	}
	_, _ = fmt.Fprintf(env.Stderr, "devdeck mcp: unknown command %q\n\n%s", args[0], usage)
	return 2
}

func serve(ctx context.Context, env Env) int {
	addr, err := config.ListenAddr(env.Getenv)
	if err != nil {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp:", err)
		return 2
	}
	hc := env.Client
	if hc == nil {
		hc = &http.Client{Timeout: 30 * time.Second}
	}
	// ListenAddr checked that the address is loopback, so plain HTTP never leaves the machine.
	base := url.URL{Scheme: "http", Host: addr}
	s := &Server{Name: "devdeck", Version: env.Version, Instructions: instructions, Tools: Tools(base.String(), hc), Resources: Resources(), Prompts: Prompts()}
	// stdout carries the protocol and nothing else: anything to say goes to stderr.
	if err := s.Serve(ctx, env.Stdin, env.Stdout); err != nil && !errors.Is(err, context.Canceled) {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp:", err)
		return 1
	}
	return 0
}

// addArgs is the `claude mcp add` command line that connects the program at exe.
func addArgs(exe string) []string {
	return []string{"mcp", "add", "--scope", "user", "devdeck", "--", exe, "mcp"}
}

func install(ctx context.Context, env Env) int {
	exe, err := env.Executable()
	if err != nil {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp: can't find where devdeck is installed:", err)
		return 1
	}
	claude, err := env.LookPath("claude")
	if err != nil {
		_, _ = fmt.Fprintf(env.Stdout, "Claude Code (claude) isn't on your PATH. Run this where it is:\n\n  claude mcp add --scope user devdeck -- \"%s\" mcp\n", exe)
		return 1
	}
	if err := env.Run(ctx, claude, addArgs(exe), env.Stdout, env.Stderr); err != nil {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp: claude couldn't add the connector:", err)
		return 1
	}
	_, _ = fmt.Fprintln(env.Stdout, "devdeck is connected to Claude Code. Start a new Claude Code session and ask: what is running in devdeck?")
	return 0
}

func uninstall(ctx context.Context, env Env) int {
	claude, err := env.LookPath("claude")
	if err != nil {
		_, _ = fmt.Fprintln(env.Stdout, "Claude Code (claude) isn't on your PATH, so there is nothing to remove from it.")
		return 0
	}
	if err := env.Run(ctx, claude, []string{"mcp", "remove", "--scope", "user", "devdeck"}, env.Stdout, env.Stderr); err != nil {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp: claude couldn't remove the connector (it may not be installed):", err)
		return 1
	}
	_, _ = fmt.Fprintln(env.Stdout, "devdeck is no longer connected to Claude Code.")
	return 0
}

func printConfig(args []string, env Env) int {
	fs := flag.NewFlagSet("mcp config", flag.ContinueOnError)
	fs.SetOutput(env.Stderr)
	full := fs.Bool("full", false, "use the full path of devdeck instead of relying on the PATH")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	command := "devdeck"
	if *full {
		exe, err := env.Executable()
		if err != nil {
			_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp: can't find where devdeck is installed:", err)
			return 1
		}
		command = exe
	} else {
		_, _ = fmt.Fprintln(env.Stderr, "devdeck mcp: this needs devdeck on your PATH; use --full to write its full path instead.")
	}
	b, err := json.MarshalIndent(map[string]any{
		"mcpServers": map[string]any{"devdeck": map[string]any{"command": command, "args": []string{"mcp"}}},
	}, "", "  ")
	if err != nil {
		return 1
	}
	_, _ = fmt.Fprintln(env.Stdout, string(b))
	return 0
}
