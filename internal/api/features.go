package api

import (
	"errors"
	"net/http"
	"sort"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/feature"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// featuresResponse is the Features page's list: every plan in the plans repository of each of
// the user's workspaces that has one.
type featuresResponse struct {
	Features []feature.Summary `json:"features"`
	// Problems are workspaces whose plans repository couldn't be read.
	Problems []featureProblem `json:"problems"`
	// NoPlansRepo are the user's workspaces with no plans_repo, so the page can say how to set one.
	NoPlansRepo []string `json:"no_plans_repo"`
}

type featureProblem struct {
	Workspace string `json:"workspace"`
	Message   string `json:"message"`
}

type featureFileResponse struct {
	Path string `json:"path"`
	Text string `json:"text"`
}

// registerFeatures adds the routes for features: a plan is a branch plan/<name> of a workspace's plans
// repository, and its PRs are read from git and GitHub. Everything here only reads.
func registerFeatures(g *echo.Group, m *workspace.Manager, svc *gitx.Service) {
	fs := &feature.Service{
		Git: svc.Git,
		// The account a repository's rule picks, as on the Repositories page.
		Account: func(rm gitx.Remote) string {
			cfg, err := svc.Store.Load()
			if err != nil {
				return ""
			}
			if cn, ok := cfg.ConnectionFor(rm); ok {
				return cn.User
			}
			return ""
		},
	}
	if svc.GH != nil {
		fs.GH = svc.GH
	}
	ff := g.Group("/features", limitBody)

	// env finds a workspace of the user's own and its plans repository. A sample workspace has none.
	env := func(id string) (feature.Env, error) {
		d, err := m.Get(id)
		if err != nil || d.Source != workspace.SourceLocal {
			return feature.Env{}, echo.NewHTTPError(http.StatusNotFound, "no such workspace")
		}
		e, ok := feature.EnvOf(d.ID, d.Folder, d.Workspace)
		if !ok {
			return feature.Env{}, echo.NewHTTPError(http.StatusNotFound, "this workspace has no plans_repo")
		}
		return e, nil
	}
	plans := func(c echo.Context, e feature.Env) ([]feature.Plan, error) {
		list, err := feature.LoadPlans(c.Request().Context(), fs.Git, e)
		if errors.Is(err, feature.ErrNoPlansRepo) {
			return nil, echo.NewHTTPError(http.StatusFailedDependency, err.Error())
		}
		if err != nil {
			c.Logger().Error(oneLine(err))
			return nil, echo.NewHTTPError(http.StatusInternalServerError, "the plans couldn't be read")
		}
		return list, nil
	}
	find := func(c echo.Context) (feature.Env, *feature.Plan, error) {
		e, err := env(c.Param("workspace"))
		if err != nil {
			return e, nil, err
		}
		list, err := plans(c, e)
		if err != nil {
			return e, nil, err
		}
		for i := range list {
			if list[i].Name == c.Param("name") {
				return e, &list[i], nil
			}
		}
		return e, nil, echo.NewHTTPError(http.StatusNotFound, "no such feature")
	}

	// GET /features lists the features. It reads git only, so it is quick.
	ff.GET("", func(c echo.Context) error {
		out := featuresResponse{Features: []feature.Summary{}, Problems: []featureProblem{}, NoPlansRepo: []string{}}
		for _, sum := range m.List() {
			if sum.Source != workspace.SourceLocal {
				continue
			}
			e, err := env(sum.ID)
			if err != nil {
				out.NoPlansRepo = append(out.NoPlansRepo, sum.ID)
				continue
			}
			list, err := feature.LoadPlans(c.Request().Context(), fs.Git, e)
			if err != nil {
				out.Problems = append(out.Problems, featureProblem{Workspace: sum.ID, Message: err.Error()})
				continue
			}
			for i := range list {
				out.Features = append(out.Features, feature.SummaryOf(&list[i]))
			}
		}
		sort.SliceStable(out.Features, func(i, j int) bool {
			a, b := out.Features[i], out.Features[j]
			return a.Workspace < b.Workspace || a.Workspace == b.Workspace && a.Name < b.Name
		})
		return c.JSON(http.StatusOK, out)
	})

	// GET /features/:workspace/:name is one feature with its live state. ?refresh=1 skips the
	// minute's cache of the GitHub answers.
	ff.GET("/:workspace/:name", func(c echo.Context) error {
		e, p, err := find(c)
		if err != nil {
			return err
		}
		return c.JSON(http.StatusOK, fs.Detail(c.Request().Context(), e, p, c.QueryParam("refresh") == "1"))
	})

	// GET /features/:workspace/:name/status is the same feature as plain text for a terminal: what
	// `devdeck feature status` prints and the page's Terminal tab shows.
	ff.GET("/:workspace/:name/status", func(c echo.Context) error {
		e, p, err := find(c)
		if err != nil {
			return err
		}
		return c.String(http.StatusOK, feature.Render(fs.Detail(c.Request().Context(), e, p, c.QueryParam("refresh") == "1")))
	})

	// GET /features/:workspace/:name/files/* is one file of the plan, as text.
	ff.GET("/:workspace/:name/files/*", func(c echo.Context) error {
		e, p, err := find(c)
		if err != nil {
			return err
		}
		rel := c.Param("*")
		text, err := feature.ReadFile(c.Request().Context(), fs.Git, e, p, rel)
		if err != nil {
			return echo.NewHTTPError(http.StatusNotFound, "no such file in this plan")
		}
		return c.JSON(http.StatusOK, featureFileResponse{Path: rel, Text: text})
	})
}
