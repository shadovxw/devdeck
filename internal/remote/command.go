package remote

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/shadovxw/devdeck/internal/agent"
)

const usage = `usage: devdeck remote <info|services|compose|logs> --url URL [--token-file FILE] [--stack ID] [--service NAME] [--tail N]

Talks to a devdeck agent through a tunnel that is already open, for checking it by hand.
The token comes from --token-file or the DEVDECK_AGENT_TOKEN environment variable.
`

// Command is `devdeck remote ...`. It returns the exit code.
func Command(ctx context.Context, args []string, stdout, stderr io.Writer, getenv func(string) string) int {
	if len(args) == 0 || strings.HasPrefix(args[0], "-") || args[0] == "help" {
		_, _ = fmt.Fprint(stderr, usage)
		return 2
	}
	sub, args := args[0], args[1:]
	fs := flag.NewFlagSet("devdeck remote", flag.ContinueOnError)
	fs.SetOutput(stderr)
	base := fs.String("url", "http://127.0.0.1:7071", "where the tunnel's local end is")
	tokenFile := fs.String("token-file", "", "a file with the agent's token")
	stack := fs.String("stack", "", "the stack (services, compose, logs)")
	service := fs.String("service", "", "one service (logs); all of the stack's when empty")
	tail := fs.Int("tail", 100, "how many earlier lines to show first (logs)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	tok := strings.TrimSpace(getenv("DEVDECK_AGENT_TOKEN"))
	if *tokenFile != "" {
		data, err := os.ReadFile(*tokenFile) // #nosec G304 -- a file the user names on the command line
		if err != nil {
			_, _ = fmt.Fprintln(stderr, "devdeck remote:", err)
			return 1
		}
		tok = strings.TrimSpace(string(data))
	}
	if tok == "" {
		_, _ = fmt.Fprintln(stderr, "devdeck remote: no token: pass --token-file or set DEVDECK_AGENT_TOKEN")
		return 2
	}
	if sub != "info" && *stack == "" {
		_, _ = fmt.Fprintln(stderr, "devdeck remote: --stack is needed")
		return 2
	}
	c := &Client{Base: *base, Token: tok}
	fail := func(err error) int {
		_, _ = fmt.Fprintln(stderr, "devdeck remote:", err)
		return 1
	}

	switch sub {
	case "info":
		info, err := c.Info(ctx)
		if err != nil {
			return fail(err)
		}
		_, _ = fmt.Fprintf(stdout, "agent %s (API %d)\n", info.Version, info.API)
		for _, s := range info.Stacks {
			mode := "read-only"
			if s.AllowWrite {
				mode = "writes allowed"
			}
			_, _ = fmt.Fprintf(stdout, "  %-12s %s (%s)\n", s.ID, s.Name, mode)
		}
	case "services":
		list, err := c.Services(ctx, *stack)
		if err != nil {
			return fail(err)
		}
		tw := tabwriter.NewWriter(stdout, 0, 2, 2, ' ', 0)
		_, _ = fmt.Fprintln(tw, "SERVICE\tSTATE\tHEALTH\tIMAGE")
		for _, s := range list {
			_, _ = fmt.Fprintf(tw, "%s\t%s\t%s\t%s\n", s.Service, s.State, dash(s.Health), s.Image)
		}
		_ = tw.Flush()
	case "compose":
		v, err := c.Compose(ctx, *stack)
		if err != nil {
			return fail(err)
		}
		enc := json.NewEncoder(stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(v)
	case "logs":
		err := c.Follow(ctx, LogQuery{Stack: *stack, Service: *service, Tail: *tail}, func(l agent.LogLine) {
			if l.Error != "" {
				_, _ = fmt.Fprintf(stderr, "%s | %s\n", l.Service, l.Error)
				return
			}
			_, _ = fmt.Fprintf(stdout, "%s %s | %s\n", l.TS.Local().Format(time.TimeOnly), l.Service, l.Line)
		})
		if err != nil {
			return fail(err)
		}
	default:
		_, _ = fmt.Fprintf(stderr, "devdeck remote: unknown command %q\n%s", sub, usage)
		return 2
	}
	return 0
}

func dash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
