package cli

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"text/tabwriter"

	"github.com/shadovxw/devdeck/internal/feature"
)

// featureList is the answer of GET /api/v1/features.
type featureList struct {
	Features []feature.Summary `json:"features"`
	Problems []struct {
		Workspace string `json:"workspace"`
		Message   string `json:"message"`
	} `json:"problems"`
	NoPlansRepo []string `json:"no_plans_repo"`
}

func (c *client) features(ctx context.Context) (featureList, error) {
	var out featureList
	return out, c.do(ctx, http.MethodGet, "/api/v1/features", http.StatusOK, &out)
}

// featureStatus is a feature as the plain text the server renders for a terminal.
func (c *client) featureStatus(ctx context.Context, ws, name string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/api/v1/features/"+url.PathEscape(ws)+"/"+url.PathEscape(name)+"/status", nil)
	if err != nil {
		return "", err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("%w at %s", errNotRunning, c.base)
	}
	defer func() { _ = resp.Body.Close() }()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", decodeError(resp.StatusCode, body)
	}
	return string(body), nil
}

const featureHelp = `Usage:
  devdeck feature list                          every feature of your workspaces
  devdeck feature status [-w <workspace>] [name]   one feature: its PRs, their state and what is next
  devdeck feature check [--json] [--workspace <name>] <feature.yaml or plan folder>
`

// feature runs `devdeck feature ...`. check reads a file and needs no server; list and status ask the running server.
func (a *app) feature(ctx context.Context, args []string) int {
	if len(args) == 0 {
		a.errorf("%s", featureHelp)
		return exitUsage
	}
	switch args[0] {
	case "check":
		return Feature(args, a.env.Getenv, a.env.Stdout, a.env.Stderr)
	case "list":
		return a.featureList(ctx, args[1:])
	case "status":
		return a.featureStatus(ctx, args[1:])
	}
	a.errorf("unknown feature command %q\n\n%s", args[0], featureHelp)
	return exitUsage
}

func (a *app) featureList(ctx context.Context, args []string) int {
	fs := flag.NewFlagSet("feature list", flag.ContinueOnError)
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return code
	}
	if len(pos) != 0 {
		a.errorf("devdeck feature list takes no arguments\n\n%s", featureHelp)
		return exitUsage
	}
	list, err := a.api.features(ctx)
	if err != nil {
		return a.fail(err)
	}
	if len(list.Features) == 0 {
		a.printf("no features yet\n")
	} else {
		tw := tabwriter.NewWriter(a.env.Stdout, 0, 0, 2, ' ', 0)
		_, _ = fmt.Fprintln(tw, "FEATURE\tKIND\tREPOS\tPRS\tSTEPS\tTITLE")
		for _, f := range list.Features {
			note := ""
			if f.Errors > 0 {
				note = fmt.Sprintf("  (%d errors in feature.yaml)", f.Errors)
			}
			_, _ = fmt.Fprintf(tw, "%s/%s\t%s\t%s\t%d\t%d/%d\t%s%s\n", f.Workspace, f.Name, f.Kind, strings.Join(f.Repos, ","), f.PRs, f.StepsDone, f.Steps, f.Title, note)
		}
		_ = tw.Flush()
	}
	for _, p := range list.Problems {
		a.printf("%s: %s\n", p.Workspace, p.Message)
	}
	if len(list.NoPlansRepo) > 0 {
		a.printf("no plans_repo in: %s\n", strings.Join(list.NoPlansRepo, ", "))
	}
	return exitOK
}

func (a *app) featureStatus(ctx context.Context, args []string) int {
	fs := flag.NewFlagSet("feature status", flag.ContinueOnError)
	wsFlag := fs.String("w", "", "workspace id")
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return code
	}
	if len(pos) > 1 {
		a.errorf("devdeck feature status takes one feature name\n\n%s", featureHelp)
		return exitUsage
	}
	list, err := a.api.features(ctx)
	if err != nil {
		return a.fail(err)
	}
	var found []feature.Summary
	for _, f := range list.Features {
		if (*wsFlag == "" || f.Workspace == *wsFlag) && (len(pos) == 0 || f.Name == pos[0]) {
			found = append(found, f)
		}
	}
	switch len(found) {
	case 0:
		a.errorf("devdeck: no such feature: run `devdeck feature list`\n")
		return exitFail
	case 1:
	default:
		var names []string
		for _, f := range found {
			names = append(names, f.Workspace+"/"+f.Name)
		}
		a.errorf("devdeck: which one? %s (give the name, and -w for a workspace)\n", strings.Join(names, ", "))
		return exitUsage
	}
	text, err := a.api.featureStatus(ctx, found[0].Workspace, found[0].Name)
	if err != nil {
		return a.fail(err)
	}
	a.printf("%s", text)
	return exitOK
}
