package agent

import (
	"context"
	"flag"
	"fmt"
	"io"
	"strings"

	"github.com/rs/zerolog"
)

// DefaultConfig is where the agent's configuration lives on a host.
const DefaultConfig = "/etc/devdeck/agent.yaml"

const usage = `usage:
  devdeck agent [--config FILE]         serve devdeck's agent (default config: ` + DefaultConfig + `)
  devdeck agent check [--config FILE]   check the configuration and the token, then exit
  devdeck agent token                   print a new random token, for the token file
`

// Command is `devdeck agent ...`. It returns the exit code.
func Command(ctx context.Context, args []string, stdout, stderr io.Writer, version string) int {
	sub := ""
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		sub, args = args[0], args[1:]
	}
	switch sub {
	case "token":
		tok, err := NewToken()
		if err != nil {
			_, _ = fmt.Fprintln(stderr, "devdeck agent:", err)
			return 1
		}
		_, _ = fmt.Fprintln(stdout, tok)
		return 0
	case "", "check":
	case "help":
		_, _ = fmt.Fprint(stdout, usage)
		return 0
	default:
		_, _ = fmt.Fprintf(stderr, "devdeck agent: unknown command %q\n%s", sub, usage)
		return 2
	}

	fs := flag.NewFlagSet("devdeck agent", flag.ContinueOnError)
	fs.SetOutput(stderr)
	path := fs.String("config", DefaultConfig, "the agent's configuration file")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	cfg, err := LoadConfig(*path)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "devdeck agent:", err)
		return 1
	}
	tokens, err := ReadTokens(cfg)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "devdeck agent:", err)
		return 1
	}
	if sub == "check" {
		var names []string
		for _, t := range tokens {
			names = append(names, t.Name)
		}
		_, _ = fmt.Fprintf(stdout, "configuration and tokens are fine; listening on %s; tokens: %s\n", cfg.Listen, strings.Join(names, ", "))
		for _, s := range cfg.Stacks {
			mode := "read-only"
			if s.AllowWrite {
				mode = "writes allowed"
			}
			_, _ = fmt.Fprintf(stdout, "  %-12s %s (%s, %s)\n", s.ID, s.Name, strings.Join(s.Files, ", "), mode)
		}
		return 0
	}
	// JSON lines on stderr, which systemd hands to the journal.
	log := zerolog.New(stderr).With().Timestamp().Str("component", "agent").Logger()
	a := New(cfg, nil, nil, log, version)
	a.AddTokens(tokens...)
	if err := a.Serve(ctx); err != nil {
		log.Error().Err(err).Msg("agent stopped")
		return 1
	}
	return 0
}
