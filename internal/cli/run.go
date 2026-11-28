package cli

import (
	"context"
	"errors"
	"flag"
	"net/http"
	"net/url"
	"time"

	"github.com/shadovxw/devdeck/internal/scripts"
)

// scriptRow is the part of GET /workspaces/:id/scripts that `run` needs.
type scriptRow struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Writes bool   `json:"writes"`
}

func scriptsPath(ws string) string { return "/api/v1/workspaces/" + url.PathEscape(ws) + "/scripts" }

// run is `devdeck run <script> [-w ws] [--yes]` (dev-plans/2026-11-22-projects PJ7): it runs one
// of the project's scripts through the server and prints each repo's result. VS Code's tasks
// call it. A script that can change files asks first, unless --yes.
func (a *app) run(ctx context.Context, args []string) int {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	wsFlag := fs.String("w", "", "workspace id")
	yes := fs.Bool("yes", false, "don't ask before a script that can change files")
	pos, code, ok := a.flags(fs, args)
	if !ok {
		return code
	}
	if len(pos) != 1 {
		a.errorf("devdeck run needs exactly one script id\n\n%s", usage)
		return exitUsage
	}
	ws, code, ok := a.workspace(ctx, *wsFlag)
	if !ok {
		return code
	}

	var list []scriptRow
	if err := a.api.do(ctx, http.MethodGet, scriptsPath(ws), http.StatusOK, &list); err != nil {
		return a.fail(err)
	}
	var s *scriptRow
	for i := range list {
		if list[i].ID == pos[0] {
			s = &list[i]
		}
	}
	if s == nil {
		a.errorf("devdeck: %s has no script %q\n", ws, pos[0])
		for _, r := range list {
			a.errorf("  %s\n", r.ID)
		}
		return exitFail
	}
	if s.Writes && !*yes && !a.confirm(s.Title+" can change your files. Go ahead?") {
		a.printf("not run\n")
		return exitFail
	}

	var r scripts.Run
	body := map[string]bool{"confirm": s.Writes}
	if err := a.api.send(ctx, http.MethodPost, scriptsPath(ws)+"/"+url.PathEscape(s.ID)+"/run", body, http.StatusAccepted, &r); err != nil {
		return a.fail(err)
	}
	a.printf("%s in %s\n", s.Title, ws)
	return a.followScript(ctx, r.ID)
}

// followScript prints each repo once it has finished, then the end state.
func (a *app) followScript(ctx context.Context, id string) int {
	shown := map[string]bool{}
	for {
		var r scripts.Run
		if err := a.api.do(ctx, http.MethodGet, "/api/v1/script-runs/"+url.PathEscape(id), http.StatusOK, &r); err != nil {
			var ae *apiError
			if errors.As(err, &ae) && ae.Status == http.StatusNotFound {
				a.errorf("devdeck: the run is gone (the server may have restarted)\n")
				return exitFail
			}
			return a.fail(err)
		}
		for _, repo := range r.Repos {
			if shown[repo.Repo] || repo.State == scripts.StateWaiting || repo.State == scripts.StateRunning {
				continue
			}
			shown[repo.Repo] = true
			line := "  " + repo.Repo + "  " + repo.State
			if repo.Reason != "" {
				line += "  " + oneLine(repo.Reason)
			}
			a.printf("%s\n", line)
			if repo.State == scripts.StateFailed {
				for _, st := range repo.Steps {
					if st.State == scripts.StateFailed && st.Output != "" {
						a.printf("      %s: %s\n", st.Label, oneLine(st.Output))
					}
				}
			}
		}
		if r.Finished != nil {
			if r.State == scripts.StateFailed {
				a.errorf("devdeck: %s failed\n", r.Title)
				return exitFail
			}
			a.printf("%s: %s\n", r.Title, r.State)
			return exitOK
		}
		select {
		case <-ctx.Done():
			a.printf("\nstill running in the background\n")
			return exitStop
		case <-time.After(a.env.Poll):
		}
	}
}
