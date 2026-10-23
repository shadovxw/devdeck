package api

import (
	"context"
	"errors"
	"net/http"
	"sync"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// repoRow is one workspace repository with its account status.
type repoRow struct {
	Workspace     string `json:"workspace"`
	WorkspaceName string `json:"workspace_name"`
	Repo          string `json:"repo"`
	gitx.RepoStatus
	// Work is where the repository stands; it is left out when the folder isn't a repository.
	Work *gitx.Work `json:"work,omitempty"`
	// Commands are the git commands the page offers (fetch, pull, push), as you would type them.
	Commands map[string]string `json:"commands,omitempty"`
	// Clone is set for a repository whose folder is missing and whose workspace names a remote that can be cloned.
	Clone *cloneInfo `json:"clone,omitempty"`

	// remote is the address the workspace gives, kept out of the JSON.
	remote string
}

// cloneInfo is what the page needs to offer cloning a missing repository.
type cloneInfo struct {
	Remote  string `json:"remote"`
	Command string `json:"command"`
}

type confirmBody struct {
	Confirm bool `json:"confirm"`
}

// localRepos lists the repositories of the user's own workspaces, with their folders.
// Sample workspaces point at made-up folders, so they are left out.
func localRepos(m *workspace.Manager) []repoRow {
	var rows []repoRow
	for _, sum := range m.List() {
		if sum.Source != workspace.SourceLocal {
			continue
		}
		d, err := m.Get(sum.ID)
		if err != nil || d.Workspace == nil {
			continue
		}
		root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
		for _, r := range d.Workspace.Repos {
			dir, ok := workspace.JoinInside(root, r.Path)
			if !ok {
				continue
			}
			rows = append(rows, repoRow{Workspace: sum.ID, WorkspaceName: d.Workspace.Name, Repo: r.ID, RepoStatus: gitx.RepoStatus{Path: dir}, remote: r.Remote})
		}
	}
	return rows
}

// inspectAll looks at every repository, a few at a time.
func inspectAll(ctx context.Context, svc *gitx.Service, rows []repoRow, cfg gitx.Config) {
	var wg sync.WaitGroup
	slots := make(chan struct{}, 6)
	for i := range rows {
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			rows[i].RepoStatus = svc.Git.Inspect(ctx, rows[i].Path, cfg)
			fillWork(ctx, svc, &rows[i])
		}()
	}
	wg.Wait()
}

// fillWork adds where a repository stands and the commands for it, or, for a folder that
// isn't there, how it would be cloned.
func fillWork(ctx context.Context, svc *gitx.Service, row *repoRow) {
	if row.State == gitx.StateMissing {
		if remote, ok := gitx.CloneAddress(row.remote); ok {
			row.Clone = &cloneInfo{Remote: remote, Command: gitx.CloneCommand(remote, row.Path)}
		}
		return
	}
	w, err := svc.Git.Work(ctx, row.Path)
	if err != nil {
		return
	}
	row.Work = &w
	row.Commands = gitx.Commands(row.Path, w)
}

// repoLocks keeps two operations from running in one repository at the same time.
var repoLocks sync.Map

func lockRepo(path string) func() {
	l, _ := repoLocks.LoadOrStore(path, &sync.Mutex{})
	mu := l.(*sync.Mutex)
	mu.Lock()
	return mu.Unlock
}

// registerGit adds the routes for git accounts: who gh is signed in as, the connections
// and rules, the credential helper setup, and each repository's account and identity.
// Tokens never pass through here: only gh and git's own answer ever see one.
func registerGit(g *echo.Group, svc *gitx.Service, m *workspace.Manager) {
	gg := g.Group("/git", limitBody)

	fail := func(c echo.Context, err error, what string) error {
		c.Logger().Error(oneLine(err))
		return echo.NewHTTPError(http.StatusInternalServerError, what)
	}

	// GET /git is the Connections page: gh's accounts, the connections and the rules.
	gg.GET("", func(c echo.Context) error {
		o, err := svc.Overview(c.Request().Context())
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		return c.JSON(http.StatusOK, o)
	})

	// PUT /git/config replaces the connections and the rules. It is checked first.
	gg.PUT("/config", func(c echo.Context) error {
		var cfg gitx.Config
		if err := c.Bind(&cfg); err != nil {
			return bindError(err)
		}
		if err := svc.Store.Save(cfg); err != nil {
			if verr := cfg.Validate(); verr != nil {
				return echo.NewHTTPError(http.StatusUnprocessableEntity, verr.Error())
			}
			return fail(c, err, "the git accounts couldn't be saved")
		}
		o, err := svc.Overview(c.Request().Context())
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		return c.JSON(http.StatusOK, o)
	})

	// POST /git/connections/:id/check asks GitHub, as that account, who it is, what its token may do and which organisations it is in.
	gg.POST("/connections/:id/check", func(c echo.Context) error {
		cfg, err := svc.Store.Load()
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		cn, ok := cfg.Connection(c.Param("id"))
		if !ok {
			return echo.NewHTTPError(http.StatusNotFound, "no such connection")
		}
		res, err := svc.GH.Check(c.Request().Context(), cn.User)
		switch {
		case errors.Is(err, gitx.ErrNoGH):
			return echo.NewHTTPError(http.StatusFailedDependency, err.Error())
		case err != nil:
			return echo.NewHTTPError(http.StatusBadGateway, err.Error())
		}
		return c.JSON(http.StatusOK, res)
	})

	// GET /git/match?remote=<address> says which connection a repository address would use.
	gg.GET("/match", func(c echo.Context) error {
		rm, ok := gitx.ParseRemote(c.QueryParam("remote"))
		if !ok {
			return echo.NewHTTPError(http.StatusBadRequest, "that isn't a repository address")
		}
		cfg, err := svc.Store.Load()
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		cn, found := cfg.ConnectionFor(rm)
		if !found {
			return c.JSON(http.StatusOK, map[string]any{"matched": false})
		}
		return c.JSON(http.StatusOK, map[string]any{"matched": true, "connection": cn.ID})
	})

	// GET /git/setup shows what the credential helper setup would change; POST .../apply and
	// .../undo do it, and only with {"confirm": true}.
	gg.GET("/setup", func(c echo.Context) error {
		st, err := svc.Setup.Preview(c.Request().Context())
		if err != nil {
			return fail(c, err, "the git settings couldn't be read")
		}
		return c.JSON(http.StatusOK, st)
	})
	setup := func(apply bool) echo.HandlerFunc {
		return func(c echo.Context) error {
			var body confirmBody
			if err := c.Bind(&body); err != nil {
				return bindError(err)
			}
			if !body.Confirm {
				return echo.NewHTTPError(http.StatusBadRequest, "this changes your global git settings: send {\"confirm\": true} to go ahead")
			}
			var err error
			if apply {
				err = svc.Setup.Apply(c.Request().Context())
			} else {
				err = svc.Setup.Undo(c.Request().Context())
			}
			if errors.Is(err, gitx.ErrNothingToUndo) {
				return echo.NewHTTPError(http.StatusConflict, err.Error())
			}
			if err != nil {
				return fail(c, err, "the git settings couldn't be changed")
			}
			st, err := svc.Setup.Preview(c.Request().Context())
			if err != nil {
				return fail(c, err, "the git settings couldn't be read")
			}
			return c.JSON(http.StatusOK, st)
		}
	}
	gg.POST("/setup/apply", setup(true))
	gg.POST("/setup/undo", setup(false))

	// GET /git/repos lists the repositories of the user's workspaces with their account and identity.
	gg.GET("/repos", func(c echo.Context) error {
		cfg, err := svc.Store.Load()
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		rows := localRepos(m)
		inspectAll(c.Request().Context(), svc, rows, cfg)
		if rows == nil {
			rows = []repoRow{}
		}
		return c.JSON(http.StatusOK, rows)
	})

	// POST /git/repos/identity writes the account's name and email into one repository's own git config.
	gg.POST("/repos/identity", func(c echo.Context) error {
		var body struct {
			Workspace string `json:"workspace"`
			Repo      string `json:"repo"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		cfg, err := svc.Store.Load()
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		for _, row := range localRepos(m) {
			if row.Workspace != body.Workspace || row.Repo != body.Repo {
				continue
			}
			st := svc.Git.Inspect(c.Request().Context(), row.Path, cfg)
			cn, ok := cfg.Connection(st.Connection)
			if !ok {
				return echo.NewHTTPError(http.StatusUnprocessableEntity, "no account is set for this repository: add a rule for it first")
			}
			if err := svc.Git.ApplyIdentity(c.Request().Context(), row.Path, cn); err != nil {
				return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
			}
			row.RepoStatus = svc.Git.Inspect(c.Request().Context(), row.Path, cfg)
			return c.JSON(http.StatusOK, row)
		}
		return echo.NewHTTPError(http.StatusNotFound, "no such repository")
	})

	// POST /git/repos/op runs fetch, pull, push or clone in one repository. Everything but fetch
	// changes files or the remote, so it needs {"confirm": true}. It never forces a push.
	gg.POST("/repos/op", func(c echo.Context) error {
		var body struct {
			Workspace string `json:"workspace"`
			Repo      string `json:"repo"`
			Op        string `json:"op"`
			Confirm   bool   `json:"confirm"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if body.Op != gitx.OpFetch && body.Op != gitx.OpPull && body.Op != gitx.OpPush && body.Op != opClone {
			return echo.NewHTTPError(http.StatusBadRequest, "the operation must be fetch, pull, push or clone")
		}
		if body.Op != gitx.OpFetch && !body.Confirm {
			return echo.NewHTTPError(http.StatusBadRequest, "this changes your files or the remote: send {\"confirm\": true} to go ahead")
		}
		cfg, err := svc.Store.Load()
		if err != nil {
			return fail(c, err, "the git accounts couldn't be read")
		}
		var row *repoRow
		rows := localRepos(m)
		for i := range rows {
			if rows[i].Workspace == body.Workspace && rows[i].Repo == body.Repo {
				row = &rows[i]
			}
		}
		if row == nil {
			return echo.NewHTTPError(http.StatusNotFound, "no such repository")
		}
		ctx := c.Request().Context()
		defer lockRepo(row.Path)()

		output, err := runRepoOp(ctx, svc, cfg, row, body.Op)
		if err != nil {
			return err
		}
		row.RepoStatus = svc.Git.Inspect(ctx, row.Path, cfg)
		fillWork(ctx, svc, row)
		return c.JSON(http.StatusOK, map[string]any{"output": output, "repo": row})
	})
}

const opClone = "clone"

// runRepoOp runs one operation and turns a refusal or a git failure into an HTTP error.
func runRepoOp(ctx context.Context, svc *gitx.Service, cfg gitx.Config, row *repoRow, name string) (string, error) {
	if name == opClone {
		remote, ok := gitx.CloneAddress(row.remote)
		if !ok {
			return "", echo.NewHTTPError(http.StatusUnprocessableEntity, "the workspace gives no https github.com address for this repository")
		}
		var cn *gitx.Connection
		if rm, ok := gitx.ParseRemote(remote); ok {
			if found, ok := cfg.ConnectionFor(rm); ok {
				cn = &found
			}
		}
		out, err := svc.Git.Clone(ctx, remote, row.Path, cn)
		if err != nil {
			return "", echo.NewHTTPError(http.StatusBadGateway, err.Error())
		}
		return out, nil
	}
	w, err := svc.Git.Work(ctx, row.Path)
	if err != nil {
		return "", echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
	}
	op, err := gitx.Plan(name, row.Path, w)
	if err != nil {
		return "", echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
	}
	out, err := svc.Git.Run(ctx, row.Path, op)
	if err != nil {
		return "", echo.NewHTTPError(http.StatusBadGateway, err.Error())
	}
	return out, nil
}
