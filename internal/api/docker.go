package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/dockerx"
	"github.com/shadovxw/devdeck/internal/gitx"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// buildLimit bounds one build and push, the same as the builder's own limit.
const buildLimit = 30 * time.Minute

// dockerFail turns what went wrong with an account into an answer for the page.
func dockerFail(c echo.Context, err error, what string) error {
	var none *dockerx.NoAccountError
	var amb *dockerx.AmbiguousError
	switch {
	case errors.Is(err, dockerx.ErrNoSuchAccount), errors.Is(err, dockerx.ErrNoSuchSecret):
		return echo.NewHTTPError(http.StatusNotFound, err.Error())
	case errors.Is(err, dockerx.ErrNoToken), errors.Is(err, dockerx.ErrRefused), errors.As(err, &none), errors.As(err, &amb):
		return echo.NewHTTPError(http.StatusConflict, err.Error())
	}
	c.Logger().Error(oneLine(err))
	return echo.NewHTTPError(http.StatusInternalServerError, what)
}

// registerDocker adds the routes for Docker Hub accounts, build secrets, and building and
// pushing images. git may be nil: then secrets taken from a GitHub account and each
// repository's commit aren't available.
func registerDocker(g *echo.Group, svc *dockerx.Service, m *workspace.Manager, git *gitx.Service) {
	dg := g.Group("/docker", limitBody)

	// GET /docker is the Docker Hub page: the accounts (tokens never), the build secrets (names only).
	dg.GET("", func(c echo.Context) error {
		o, err := svc.Overview()
		if err != nil {
			return dockerFail(c, err, "the Docker accounts couldn't be read")
		}
		return c.JSON(http.StatusOK, o)
	})

	// PUT /docker/accounts/:id adds an account or changes its username and namespaces. The token is separate.
	dg.PUT("/accounts/:id", func(c echo.Context) error {
		var body struct {
			Username   string   `json:"username"`
			Namespaces []string `json:"namespaces"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		a := dockerx.Account{ID: c.Param("id"), Username: body.Username, Namespaces: body.Namespaces}
		if err := a.Check(); err != nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		if err := svc.SaveAccount(a); err != nil {
			return dockerFail(c, err, "the account couldn't be saved")
		}
		o, err := svc.Overview()
		if err != nil {
			return dockerFail(c, err, "the Docker accounts couldn't be read")
		}
		return c.JSON(http.StatusOK, o)
	})
	dg.DELETE("/accounts/:id", func(c echo.Context) error {
		if err := svc.DeleteAccount(c.Param("id")); err != nil {
			return dockerFail(c, err, "the account couldn't be removed")
		}
		return c.NoContent(http.StatusNoContent)
	})

	// PUT .../token saves the account's personal access token in the OS keychain. It is never sent back.
	dg.PUT("/accounts/:id/token", func(c echo.Context) error {
		var body struct {
			Token string `json:"token"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if err := svc.SetToken(c.Param("id"), body.Token); err != nil {
			if errors.Is(err, dockerx.ErrNoSuchAccount) {
				return dockerFail(c, err, "")
			}
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		return c.NoContent(http.StatusNoContent)
	})
	dg.DELETE("/accounts/:id/token", func(c echo.Context) error {
		if err := svc.DeleteToken(c.Param("id")); err != nil {
			return dockerFail(c, err, "the token couldn't be removed")
		}
		return c.NoContent(http.StatusNoContent)
	})

	// POST .../check signs in to Docker Hub with the account and says who it is.
	dg.POST("/accounts/:id/check", func(c echo.Context) error {
		ctx, cancel := context.WithTimeout(c.Request().Context(), 30*time.Second)
		defer cancel()
		res, err := svc.Check(ctx, c.Param("id"))
		if errors.Is(err, dockerx.ErrNoSuchAccount) || errors.Is(err, dockerx.ErrNoToken) {
			return dockerFail(c, err, "")
		}
		if err != nil {
			return echo.NewHTTPError(http.StatusBadGateway, err.Error())
		}
		return c.JSON(http.StatusOK, res)
	})

	// PUT /docker/secrets/:name saves a named build secret in the OS keychain. It is never sent back.
	dg.PUT("/secrets/:name", func(c echo.Context) error {
		var body struct {
			Value string `json:"value"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if err := svc.SetBuildSecret(c.Param("name"), body.Value); err != nil {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, err.Error())
		}
		return c.NoContent(http.StatusNoContent)
	})
	dg.DELETE("/secrets/:name", func(c echo.Context) error {
		if err := svc.DeleteBuildSecret(c.Param("name")); err != nil {
			return dockerFail(c, err, "the secret couldn't be removed")
		}
		return c.NoContent(http.StatusNoContent)
	})

	registerImages(g, svc, m, git)
}

// ----- images -----

// imageTarget is one image of one repository of one of the user's workspaces.
type imageTarget struct {
	ws, wsName string
	repo       workspace.Repo
	image      workspace.Image
	dir        string
}

func findImage(m *workspace.Manager, ws, repoID, imageID string) (*imageTarget, error) {
	d, err := m.Get(ws)
	switch {
	case errors.Is(err, workspace.ErrNotFound):
		return nil, echo.NewHTTPError(http.StatusNotFound, "no such workspace")
	case err != nil:
		return nil, echo.NewHTTPError(http.StatusInternalServerError, "the workspace couldn't be read")
	case d.Source != workspace.SourceLocal:
		return nil, echo.NewHTTPError(http.StatusForbidden, "images of a sample workspace can't be built: its folders are only illustrations")
	case d.Workspace == nil:
		return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, "this workspace has errors: fix them first")
	}
	root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
	for _, r := range d.Workspace.Repos {
		if r.ID != repoID {
			continue
		}
		dir, ok := workspace.JoinInside(root, r.Path)
		if !ok {
			return nil, echo.NewHTTPError(http.StatusUnprocessableEntity, "the repository's folder is outside the workspace root")
		}
		for _, im := range r.Images {
			if im.ID == imageID {
				return &imageTarget{ws: ws, wsName: d.Workspace.Name, repo: r, image: im, dir: dir}, nil
			}
		}
		return nil, echo.NewHTTPError(http.StatusNotFound, "no such image in this repository")
	}
	return nil, echo.NewHTTPError(http.StatusNotFound, "no such repository in this workspace")
}

// githubToken is the token of the GitHub account devdeck's rules pick for the repository in
// dir, the same account git uses to push. The token is held by the caller only.
func githubToken(ctx context.Context, git *gitx.Service, dir string) (string, error) {
	if git == nil {
		return "", errors.New("GitHub accounts aren't available")
	}
	cfg, err := git.Store.Load()
	if err != nil {
		return "", errors.New("the git accounts couldn't be read")
	}
	st := git.Git.Inspect(ctx, dir, cfg)
	if st.Connection == "" {
		return "", fmt.Errorf("no GitHub account rule matches this repository's remote (%s): add a rule on the Connections page", orNoRemote(st.Remote))
	}
	for _, cn := range cfg.Connections {
		if cn.ID == st.Connection {
			return git.GH.Token(ctx, cn.User)
		}
	}
	return "", fmt.Errorf("the connection %q isn't set up", st.Connection)
}

func orNoRemote(r string) string {
	if r == "" {
		return "it has no remote"
	}
	return r
}

// buildSecrets reads the values of an image's build secrets, each from where the workspace
// says: the repository's GitHub account, or a named secret in the keychain.
func buildSecrets(ctx context.Context, svc *dockerx.Service, git *gitx.Service, t *imageTarget) ([]dockerx.Secret, error) {
	var out []dockerx.Secret
	for _, s := range t.image.Secrets {
		switch s.From {
		case workspace.SecretFromGitHub:
			tok, err := githubToken(ctx, git, t.dir)
			if err != nil {
				return nil, fmt.Errorf("the build secret %q: %w", s.ID, err)
			}
			out = append(out, dockerx.Secret{ID: s.ID, Value: secrets.NewValue(tok)})
		case workspace.SecretFromKeyring:
			name := s.Name
			if name == "" {
				name = s.ID
			}
			v, err := svc.BuildSecret(name)
			if err != nil {
				return nil, err
			}
			out = append(out, dockerx.Secret{ID: s.ID, Value: v})
		default:
			return nil, fmt.Errorf("the build secret %q comes from %q, which devdeck doesn't know", s.ID, s.From)
		}
	}
	return out, nil
}

// imageSecretRow is a build secret as the Images page shows it: where it comes from, and
// what, if anything, stops it being found. Never a value.
type imageSecretRow struct {
	ID      string `json:"id"`
	From    string `json:"from"`
	Name    string `json:"name,omitempty"`
	Problem string `json:"problem,omitempty"`
}

// imageRow is one image on the Images page.
type imageRow struct {
	Workspace     string           `json:"workspace"`
	WorkspaceName string           `json:"workspace_name"`
	Repo          string           `json:"repo"`
	Image         string           `json:"image"`
	Repository    string           `json:"repository"`
	Dockerfile    string           `json:"dockerfile"`
	Context       string           `json:"context"`
	Platforms     []string         `json:"platforms"`
	Path          string           `json:"path"`
	Secrets       []imageSecretRow `json:"secrets"`
	// Account is the Docker account that would push it; Problem says why none can.
	Account string `json:"account,omitempty"`
	Problem string `json:"problem,omitempty"`
	// Git is where the repository stands: the branch, the commit, whether it has uncommitted changes.
	Branch string `json:"branch,omitempty"`
	Commit string `json:"commit,omitempty"`
	Dirty  bool   `json:"dirty"`
	// FolderMissing is true when the repository isn't on this machine.
	FolderMissing bool           `json:"folder_missing"`
	Last          *dockerx.Build `json:"last,omitempty"`
}

func registerImages(g *echo.Group, svc *dockerx.Service, m *workspace.Manager, git *gitx.Service) {
	ig := g.Group("/images", limitBody)

	// GET /images lists the images of the user's workspaces: the account that would push each,
	// where its repository stands, and how the last build went.
	ig.GET("", func(c echo.Context) error {
		rows := imageRows(c.Request().Context(), svc, m, git)
		return c.JSON(http.StatusOK, rows)
	})

	// GET /images/builds is the history of finished builds, newest first.
	ig.GET("/builds", func(c echo.Context) error {
		limit := 50
		if v := c.QueryParam("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > 500 {
				return echo.NewHTTPError(http.StatusBadRequest, "limit must be a number from 1 to 500")
			}
			limit = n
		}
		list, err := svc.History.List(limit)
		if err != nil {
			return dockerFail(c, err, "the build history couldn't be read")
		}
		return c.JSON(http.StatusOK, list)
	})
	ig.DELETE("/builds", func(c echo.Context) error {
		if err := svc.History.Clear(); err != nil {
			return dockerFail(c, err, "the build history couldn't be cleared")
		}
		return c.NoContent(http.StatusNoContent)
	})

	// POST /images/:ws/:repo/:image/build builds the image and pushes it as <repository>:<tag>.
	// A refusal (no account, a tag that exists, a secret that can't be found) is an error status;
	// once docker starts, the output streams back as newline-delimited JSON ({"line"} per line,
	// then {"done":true,"ok":...,"error":...}). The build runs to its end even if the page goes away.
	ig.POST("/:ws/:repo/:image/build", func(c echo.Context) error {
		var body struct {
			Tag       string `json:"tag"`
			Overwrite bool   `json:"overwrite"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if !dockerx.ValidTag(body.Tag) {
			return echo.NewHTTPError(http.StatusBadRequest, "the tag can have letters, digits, dots, dashes and underscores, and at most 128 characters")
		}
		t, err := findImage(m, c.Param("ws"), c.Param("repo"), c.Param("image"))
		if err != nil {
			return err
		}
		ctx := c.Request().Context()
		acct, err := svc.Resolve(t.image.Repository, t.image.Account)
		if err != nil {
			return dockerFail(c, err, "the Docker account couldn't be chosen")
		}
		sec, err := buildSecrets(ctx, svc, git, t)
		if err != nil {
			return echo.NewHTTPError(http.StatusConflict, err.Error())
		}

		var note string
		if !body.Overwrite {
			cctx, cancel := context.WithTimeout(ctx, 30*time.Second)
			exists, err := svc.TagExists(cctx, acct, t.image.Repository, body.Tag)
			cancel()
			switch {
			case err != nil:
				note = "devdeck couldn't check whether the tag already exists on Docker Hub (" + err.Error() + "), so it will push anyway."
			case exists:
				return c.JSON(http.StatusConflict, map[string]any{
					"message": t.image.Repository + ":" + body.Tag + " already exists on Docker Hub: building pushes over it.",
					"exists":  true,
				})
			}
		}

		revision, dirty := repoHead(ctx, git, t.dir)
		started := time.Now()
		w := c.Response()
		w.Header().Set(echo.HeaderContentType, "application/x-ndjson")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		w.Flush()
		var mu sync.Mutex
		enc := json.NewEncoder(w)
		send := func(v any) {
			mu.Lock()
			defer mu.Unlock()
			_ = enc.Encode(v)
			w.Flush()
		}
		if note != "" {
			send(map[string]string{"line": note})
		}

		bctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), buildLimit)
		defer cancel()
		berr := svc.Builder.Build(bctx, dockerx.Spec{
			Dir: t.dir, Repository: t.image.Repository, Tag: body.Tag,
			Dockerfile: t.image.Dockerfile, Context: t.image.Context, Platforms: t.image.Platforms,
			Revision: revision, Account: acct, Secrets: sec,
		}, func(line string) { send(map[string]string{"line": line}) })

		rec := dockerx.Build{
			At: started, Workspace: t.ws, Repo: t.repo.ID, Image: t.image.ID, Repository: t.image.Repository, Tag: body.Tag,
			Revision: revision, Dirty: dirty, Account: acct.ID, OK: berr == nil, Seconds: time.Since(started).Seconds(),
		}
		if berr != nil {
			rec.Error = berr.Error()
		}
		if err := svc.History.Add(rec); err != nil {
			c.Logger().Error(oneLine(err))
		}
		done := map[string]any{"done": true, "ok": berr == nil}
		if berr != nil {
			done["error"] = berr.Error()
		}
		send(done)
		return nil
	})
}

// repoHead is the commit a repository has checked out, and whether it has uncommitted changes.
func repoHead(ctx context.Context, git *gitx.Service, dir string) (commit string, dirty bool) {
	if git == nil {
		return "", false
	}
	commit, _ = git.Git.Head(ctx, dir)
	if w, err := git.Git.Work(ctx, dir); err == nil {
		dirty = w.Changed > 0
	}
	return commit, dirty
}

// imageRows lists every image of the user's workspaces. The repositories are looked at a few at a time.
func imageRows(ctx context.Context, svc *dockerx.Service, m *workspace.Manager, git *gitx.Service) []imageRow {
	rows := []imageRow{}
	newest, _ := svc.History.Newest()
	overview, _ := svc.Overview()
	haveSecret := map[string]bool{}
	for _, s := range overview.BuildSecrets {
		haveSecret[s.Name] = s.ValueSet
	}

	type repoKey struct{ ws, repo string }
	type stand struct {
		branch, commit string
		dirty, missing bool
		rule           bool // a GitHub account rule matches its remote
		remote         string
	}
	var keys []repoKey
	dirs := map[repoKey]string{}
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
			if !ok || len(r.Images) == 0 {
				continue
			}
			k := repoKey{sum.ID, r.ID}
			keys = append(keys, k)
			dirs[k] = dir
			for _, im := range r.Images {
				row := imageRow{
					Workspace: sum.ID, WorkspaceName: d.Workspace.Name, Repo: r.ID, Image: im.ID, Repository: im.Repository,
					Dockerfile: orStr(im.Dockerfile, "Dockerfile"), Context: orStr(im.Context, "."), Platforms: im.Platforms, Path: dir,
					Secrets: []imageSecretRow{},
				}
				if len(row.Platforms) == 0 {
					row.Platforms = []string{"linux/amd64"}
				}
				if a, err := svc.Resolve(im.Repository, im.Account); err != nil {
					row.Problem = err.Error()
				} else {
					row.Account = a.ID
				}
				for _, s := range im.Secrets {
					sr := imageSecretRow{ID: s.ID, From: s.From, Name: s.Name}
					if s.From == workspace.SecretFromKeyring {
						name := orStr(s.Name, s.ID)
						sr.Name = name
						if !haveSecret[name] {
							sr.Problem = "no value is saved under the name " + name + ": save it on the Docker Hub page"
						}
					}
					row.Secrets = append(row.Secrets, sr)
				}
				if b, ok := newest[sum.ID+"/"+r.ID+"/"+im.ID]; ok {
					row.Last = &b
				}
				rows = append(rows, row)
			}
		}
	}

	// Where each repository stands, once per repository, a few at a time.
	var cfg gitx.Config
	if git != nil {
		cfg, _ = git.Store.Load()
	}
	stands := map[repoKey]stand{}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, 6)
	for _, k := range keys {
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			s := stand{}
			dir := dirs[k]
			if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
				s.missing = true
			} else if git != nil {
				if w, err := git.Git.Work(ctx, dir); err == nil {
					s.branch, s.dirty = w.Branch, w.Changed > 0
				}
				s.commit, _ = git.Git.Head(ctx, dir)
				st := git.Git.Inspect(ctx, dir, cfg)
				s.rule, s.remote = st.Connection != "", st.Remote
			}
			mu.Lock()
			stands[k] = s
			mu.Unlock()
		}()
	}
	wg.Wait()
	for i := range rows {
		s := stands[repoKey{rows[i].Workspace, rows[i].Repo}]
		rows[i].Branch, rows[i].Commit, rows[i].Dirty, rows[i].FolderMissing = s.branch, s.commit, s.dirty, s.missing
		for j := range rows[i].Secrets {
			if rows[i].Secrets[j].From == workspace.SecretFromGitHub && git != nil && !s.missing && !s.rule {
				rows[i].Secrets[j].Problem = "no GitHub account rule matches this repository's remote (" + orNoRemote(s.remote) + "): add a rule on the Connections page"
			}
		}
	}
	return rows
}

func orStr(v, def string) string {
	if v == "" {
		return def
	}
	return v
}
