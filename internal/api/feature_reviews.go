package api

import (
	"errors"
	"net/http"
	"path/filepath"
	"slices"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/feature"
	"github.com/shadovxw/devdeck/internal/review"
)

type reviewStart struct {
	// PR is the PR to review; empty means every PR with a branch that isn't merged or closed.
	PR string `json:"pr"`
	// Tool is the tool to run; empty means every tool that is installed.
	Tool string `json:"tool"`
}

type reviewSkipped struct {
	PR     string `json:"pr"`
	Tool   string `json:"tool"`
	Reason string `json:"reason"`
}

type reviewStarted struct {
	Started []review.Run    `json:"started"`
	Skipped []reviewSkipped `json:"skipped"`
}

// checkoutCommand is the command that makes a read-only plan editable: check its branch out as a worktree.
func checkoutCommand(e feature.Env, name string) string {
	dir := e.Worktrees
	if dir == "" {
		dir = e.PlansRepo + "-wt"
	}
	return `git -C "` + filepath.ToSlash(e.PlansRepo) + `" worktree add "` + filepath.ToSlash(filepath.Join(dir, name)) + `" plan/` + name
}

// chooseTools is the tools a start request means: the one it names, or every installed tool that runs with
// the others (a tool with a limit, like the Claude review, runs only when it is named).
func chooseTools(runner *review.Runner, id string) ([]review.Tool, error) {
	if id != "" {
		t, ok := review.ToolByID(id)
		if !ok {
			return nil, echo.NewHTTPError(http.StatusBadRequest, "devdeck has no such review tool")
		}
		if !runner.Usable(t) {
			return nil, echo.NewHTTPError(http.StatusFailedDependency, t.Name+" isn't installed: "+review.Hint(t.Programs[0]))
		}
		return []review.Tool{t}, nil
	}
	var tools []review.Tool
	for _, t := range review.Tools {
		if runner.Usable(t) && !t.Manual {
			tools = append(tools, t)
		}
	}
	return tools, nil
}

// briefFor is what the Claude review is told about a PR; the other tools are given nothing.
func briefFor(t review.Tool, plan string, pr feature.PR) string {
	if t.ID != "claude" {
		return ""
	}
	return feature.ReviewBrief(plan, pr)
}

// registerFeatureReviews adds the routes that run review tools on a feature's branches. A run checks the
// branch out into a folder of its own, runs the tool there and saves what it said as a file in the plan's
// reviews/ folder, so the plan must be checked out as a worktree (a read-only plan has nowhere to save it).
func registerFeatureReviews(ff *echo.Group, fs *feature.Service, runner *review.Runner, find func(echo.Context) (feature.Env, *feature.Plan, error)) {
	// GET .../reviews lists the runs of this feature (waiting, running and recent), for the page to follow.
	ff.GET("/:workspace/:name/reviews", func(c echo.Context) error {
		_, p, err := find(c)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusOK, map[string]any{"runs": runner.Runs(p.Workspace, p.Name)})
	})

	// POST .../reviews starts review tools: one tool on one PR, or every installed tool on every PR that has a
	// branch. Each starts at once (a few at a time run; the rest wait their turn) and its result is saved in
	// the plan's reviews/ folder.
	ff.POST("/:workspace/:name/reviews", func(c echo.Context) error {
		e, p, err := find(c)
		if err != nil {
			return err
		}
		var body reviewStart
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if p.File == nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "feature.yaml has errors, so its PRs can't be reviewed: fix them first")
		}
		if p.ReadOnly {
			return echo.NewHTTPError(http.StatusConflict, "This plan isn't checked out, and results are saved in the plan's folder. Check it out first: "+checkoutCommand(e, p.Name))
		}
		tools, err := chooseTools(runner, body.Tool)
		if err != nil {
			return err
		}

		ctx := c.Request().Context()
		d := fs.Detail(ctx, e, p, false)
		targets := feature.Reviewable(d.PRs)
		if body.PR != "" {
			i := slices.IndexFunc(d.PRs, func(x feature.PR) bool { return x.ID == body.PR })
			if i < 0 {
				return echo.NewHTTPError(http.StatusNotFound, "no such PR in this feature")
			}
			if pr := d.PRs[i]; pr.Local == nil || !pr.Local.Exists {
				return echo.NewHTTPError(http.StatusConflict, "PR "+pr.ID+" has no branch yet, so there is nothing to review")
			} else if pr.State == feature.StateMerged || pr.State == feature.StateClosed {
				return echo.NewHTTPError(http.StatusConflict, "PR "+pr.ID+" is "+feature.StateWord(pr.State)+", so there is nothing to review")
			}
			targets = []feature.PR{d.PRs[i]}
		}
		if len(targets) == 0 {
			return echo.NewHTTPError(http.StatusConflict, "No PR has a branch that isn't merged or closed, so there is nothing to review")
		}

		// The plan's text goes to the Claude review only, so it is read only when that tool is among those started.
		var plan string
		if slices.ContainsFunc(tools, func(t review.Tool) bool { return t.ID == "claude" }) {
			plan, _ = feature.ReadFile(ctx, fs.Git, e, p, "plan.md")
		}

		out := reviewStarted{Started: []review.Run{}, Skipped: []reviewSkipped{}}
		for _, pr := range targets {
			dir, _, ok := e.RepoDir(pr.Repo)
			if !ok {
				out.Skipped = append(out.Skipped, reviewSkipped{PR: pr.ID, Reason: "the repository's folder isn't on this machine"})
				continue
			}
			set, err := fs.Git.Branches(ctx, dir)
			if err != nil || set.Ref(pr.Branch) == "" {
				out.Skipped = append(out.Skipped, reviewSkipped{PR: pr.ID, Reason: "the branch isn't in the repository"})
				continue
			}
			for _, t := range tools {
				run, err := runner.Start(review.Request{
					Workspace: p.Workspace, Feature: p.Name, PR: pr.ID, Repo: pr.Repo, Tool: t.ID,
					RepoDir: dir, Branch: pr.Branch, Base: pr.Base, Ref: set.Ref(pr.Branch), BaseRef: set.Ref(pr.Base), PlanDir: p.Worktree,
					Brief: briefFor(t, plan, pr),
				})
				switch {
				case errors.Is(err, review.ErrBusy):
					out.Skipped = append(out.Skipped, reviewSkipped{PR: pr.ID, Tool: t.ID, Reason: "already running, or waiting its turn"})
				case err != nil:
					out.Skipped = append(out.Skipped, reviewSkipped{PR: pr.ID, Tool: t.ID, Reason: err.Error()})
				default:
					out.Started = append(out.Started, run)
				}
			}
		}
		return c.JSON(http.StatusAccepted, out)
	})

	// POST .../reviews/:id/cancel stops a run that is waiting or running. Nothing is saved for it.
	ff.POST("/:workspace/:name/reviews/:id/cancel", func(c echo.Context) error {
		_, p, err := find(c)
		if err != nil {
			return err
		}
		if !runner.Cancel(p.Workspace, p.Name, c.Param("id")) {
			return echo.NewHTTPError(http.StatusNotFound, "no such run, or it has ended")
		}
		return c.NoContent(http.StatusNoContent)
	})
}
