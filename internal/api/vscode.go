package api

import (
	"bytes"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"

	"github.com/labstack/echo/v4"

	"github.com/shadovxw/devdeck/internal/vscode"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// vscodeFile is the .code-workspace as the review sheet shows it.
type vscodeFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	// State is new (no file yet), same (the file on disk is this one) or changed (it differs and
	// would be replaced).
	State string `json:"state"`
}

// buildVSCode is the project's .code-workspace and where it goes: in the folder that holds the repos.
func buildVSCode(c echo.Context, d *workspace.Detail) (vscodeFile, bool) {
	if d.Workspace == nil {
		return vscodeFile{}, false
	}
	root := workspace.ResolveRoot(d.Folder, d.Workspace.Root)
	// The file sits next to the repos, so its own folder must be absolute (the data dir may be relative).
	configDir, err := filepath.Abs(d.Folder)
	if err != nil {
		configDir = ""
	}
	in := vscode.Input{Workspace: d.ID, Name: d.Workspace.Name, ConfigDir: configDir,
		// The Host header already passed the loopback check, so this is devdeck's own address.
		SchemaBase: "http://" + c.Request().Host}
	for _, r := range d.Workspace.Repos {
		if _, ok := workspace.JoinInside(root, r.Path); ok {
			in.Repos = append(in.Repos, vscode.Repo{ID: r.ID, Path: filepath.Clean(r.Path)})
		}
	}
	list, _ := projectScripts(d)
	for _, s := range list {
		in.Scripts = append(in.Scripts, vscode.Script{ID: s.ID, Title: s.Title})
	}
	for _, s := range d.Stacks {
		in.Modes = append(in.Modes, s.Name)
	}
	f := vscodeFile{Path: filepath.Join(root, vscode.FileName(d.ID)), Content: string(vscode.Build(in)), State: "new"}
	old, err := os.ReadFile(f.Path)
	switch {
	case err == nil && bytes.Equal(old, []byte(f.Content)):
		f.State = "same"
	case err == nil:
		f.State = "changed"
	case !errors.Is(err, fs.ErrNotExist):
		f.State = "changed" // there is something there we can't read: treat it as one to replace
	}
	return f, true
}

// registerVSCode adds the project's VS Code file (dev-plans/2026-11-22-projects PJ7):
//
//	GET  /workspaces/:id/vscode   the .code-workspace devdeck would write, and how it compares
//	POST /workspaces/:id/vscode   writes it, only with {"confirm": true}
//
// The file goes next to the repos (root/<id>.code-workspace) and is written on this machine only.
func registerVSCode(g *echo.Group, m *workspace.Manager) {
	g.GET("/workspaces/:id/vscode", func(c echo.Context) error {
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		f, ok := buildVSCode(c, d)
		if !ok {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "the project file has problems: fix them first")
		}
		return c.JSON(http.StatusOK, f)
	})

	g.POST("/workspaces/:id/vscode", func(c echo.Context) error {
		var body struct {
			Confirm bool `json:"confirm"`
		}
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		d, err := m.Get(c.Param("id"))
		if err != nil {
			return workspaceError(err)
		}
		if d.Source != workspace.SourceLocal {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "example projects have no folder to write to: add your own project")
		}
		if !body.Confirm {
			return echo.NewHTTPError(http.StatusBadRequest, "this writes a file: send {\"confirm\": true} to go ahead")
		}
		f, ok := buildVSCode(c, d)
		if !ok {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "the project file has problems: fix them first")
		}
		if st, err := os.Stat(filepath.Dir(f.Path)); err != nil || !st.IsDir() {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, "the project's folder isn't there")
		}
		if err := os.WriteFile(f.Path, []byte(f.Content), 0o644); err != nil { //nolint:gosec // a settings file the user opens in VS Code
			return echo.NewHTTPError(http.StatusInternalServerError, "the file couldn't be written")
		}
		f.State = "same"
		return c.JSON(http.StatusOK, f)
	})
}
