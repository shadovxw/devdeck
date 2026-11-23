package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/labstack/echo/v4"
)

// The themes a person makes on the Appearance page are kept here so the browser and the desktop
// window show the same ones. A theme is colours only, and every colour is checked on the way in.
const (
	maxThemes    = 30
	maxThemeName = 40
	// activeKey is how the theme in use was kept before there was a mode: one id. It is still read, so a
	// person who chose a theme then is not sent back to Paper, and it is dropped the first time a mode is saved.
	activeKey = "theme.active"
	modeKey   = "theme.mode"
	lightKey  = "theme.light"
	darkKey   = "theme.dark"
)

// builtInThemes are the themes that ship with devdeck; they live in the web app and are never stored.
var builtInThemes = map[string]bool{"paper": true, "paper-dark": true}

// themeColorKeys are the colours a theme may set (web/src/theme/types.ts): the ten roles, and the
// Advanced tokens that a role does not set but a person may.
var themeColorKeys = map[string]bool{
	"background": true, "cards": true, "controls": true, "text": true, "primary": true,
	"selected": true, "success": true, "warning": true, "error": true, "neutral": true,
	"--ink-2": true, "--ink-3": true, "--fill-hover": true, "--fill-press": true, "--inset": true,
	"--primary-hover": true, "--on-primary": true, "--link": true, "--focus": true, "--serious": true,
	"--strip-ok": true, "--strip-idle": true, "--strip-off": true, "--strip-bad": true,
	"--sidebar": true, "--sidebar-foreground": true, "--sidebar-primary": true,
	"--sidebar-primary-foreground": true, "--sidebar-accent": true, "--sidebar-accent-foreground": true,
	"--sidebar-ring": true,
}

var (
	themeID  = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,39}$`)
	hexColor = regexp.MustCompile(`^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$`)
)

// Theme is a theme as the page saves it: the colours that differ from its base.
type Theme struct {
	Schema int               `json:"schema"`
	ID     string            `json:"id"`
	Name   string            `json:"name"`
	Base   string            `json:"base"`
	Colors map[string]string `json:"colors"`
}

// Appearance is everything the Appearance page loads: the themes, and which is in use.
type Appearance struct {
	Themes []Theme `json:"themes"`
	// Mode is "light", "dark" or "system" (follow the OS), or empty when no mode has been saved yet.
	Mode string `json:"mode"`
	// Light and Dark are the themes used in light and dark mode: "paper", "paper-dark" or the id of one of
	// Themes, or empty when none has been saved yet.
	Light string `json:"light"`
	Dark  string `json:"dark"`
	// Active is the one theme that was kept before modes existed ("paper" when there was none).
	Active string `json:"active"`
}

// Themes keeps the themes in the database.
type Themes struct{ DB *sql.DB }

// NewThemes is the theme storage for a database.
func NewThemes(db *sql.DB) *Themes { return &Themes{DB: db} }

// themeProblem is a refusal with the reason in plain words.
type themeProblem string

func (p themeProblem) Error() string { return string(p) }

// clean checks a theme and returns it with its colours in the form the page uses: six digits, lower case.
func (t Theme) clean() (Theme, error) {
	if t.Schema != 1 {
		return t, themeProblem("this theme is from a different version of devdeck")
	}
	if !themeID.MatchString(t.ID) || builtInThemes[t.ID] {
		return t, themeProblem("a theme id is lower case letters, digits and dashes, and not paper or paper-dark")
	}
	t.Name = strings.TrimSpace(t.Name)
	if t.Name == "" || utf8.RuneCountInString(t.Name) > maxThemeName {
		return t, themeProblem("a theme needs a name of 1 to 40 characters")
	}
	if !builtInThemes[t.Base] {
		return t, themeProblem("the theme's base must be paper or paper-dark")
	}
	colors := make(map[string]string, len(t.Colors))
	for role, c := range t.Colors {
		if !themeColorKeys[role] {
			continue // unknown colours are dropped, as the page does
		}
		if !hexColor.MatchString(c) {
			return t, themeProblem("the colour for " + role + " must be a hex colour like #0b3d91")
		}
		colors[role] = normalizeHex(c)
	}
	t.Colors = colors
	return t, nil
}

// normalizeHex is "#ABC" as "#aabbcc".
func normalizeHex(c string) string {
	c = strings.ToLower(c)
	if len(c) == 4 {
		return "#" + strings.Repeat(string(c[1]), 2) + strings.Repeat(string(c[2]), 2) + strings.Repeat(string(c[3]), 2)
	}
	return c
}

// Load reads every theme and which one is in use.
func (s *Themes) Load() (Appearance, error) {
	out := Appearance{Themes: []Theme{}, Active: "paper"}
	rows, err := s.DB.Query(`SELECT id, name, base, colors FROM themes ORDER BY updated_at, id`)
	if err != nil {
		return out, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var t Theme
		var colors string
		if err := rows.Scan(&t.ID, &t.Name, &t.Base, &colors); err != nil {
			return out, err
		}
		t.Schema = 1
		if json.Unmarshal([]byte(colors), &t.Colors) != nil || t.Colors == nil {
			t.Colors = map[string]string{}
		}
		out.Themes = append(out.Themes, t)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	var err2 error
	if out.Active, err2 = s.setting(activeKey, "paper", out.Themes); err2 != nil {
		return out, err2
	}
	if out.Light, err2 = s.setting(lightKey, "", out.Themes); err2 != nil {
		return out, err2
	}
	if out.Dark, err2 = s.setting(darkKey, "", out.Themes); err2 != nil {
		return out, err2
	}
	var mode string
	switch err := s.DB.QueryRow(`SELECT value FROM settings WHERE key = ?`, modeKey).Scan(&mode); {
	case errors.Is(err, sql.ErrNoRows):
	case err != nil:
		return out, err
	case validMode[mode]:
		out.Mode = mode
	}
	return out, nil
}

var validMode = map[string]bool{"light": true, "dark": true, "system": true}

// setting reads a theme id kept in settings. An id that is no longer a theme reads as the fallback.
func (s *Themes) setting(key, fallback string, themes []Theme) (string, error) {
	var id string
	switch err := s.DB.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&id); {
	case errors.Is(err, sql.ErrNoRows):
		return fallback, nil
	case err != nil:
		return fallback, err
	case s.known(id, themes):
		return id, nil
	}
	return fallback, nil
}

func (s *Themes) known(id string, themes []Theme) bool {
	if builtInThemes[id] {
		return true
	}
	for _, t := range themes {
		if t.ID == id {
			return true
		}
	}
	return false
}

// count is how many themes are kept, not counting the one with this id (a replacement adds none).
func (s *Themes) count(except string) (int, error) {
	var n int
	err := s.DB.QueryRow(`SELECT COUNT(*) FROM themes WHERE id <> ?`, except).Scan(&n)
	return n, err
}

// Save adds a theme or replaces the one with its id.
func (s *Themes) Save(t Theme) error {
	n, err := s.count(t.ID)
	if err != nil {
		return err
	}
	if n >= maxThemes {
		return themeProblem("at most 30 themes can be kept; delete one first")
	}
	colors, err := json.Marshal(t.Colors)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO themes (id, name, base, colors) VALUES (?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET name = excluded.name, base = excluded.base, colors = excluded.colors,
		updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, t.ID, t.Name, t.Base, string(colors))
	return err
}

// Delete removes a theme; where it was the one in use (for a mode, or the one kept before modes), nothing is
// chosen for that any more and the page falls back to Paper. It reports whether there was one.
func (s *Themes) Delete(id string) (bool, error) {
	res, err := s.DB.Exec(`DELETE FROM themes WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	_, err = s.DB.Exec(`DELETE FROM settings WHERE key IN (?, ?, ?) AND value = ?`, activeKey, lightKey, darkKey, id)
	return n > 0, err
}

// Use is the mode and the themes for light and dark.
type Use struct {
	Mode  string `json:"mode"`
	Light string `json:"light"`
	Dark  string `json:"dark"`
}

// exists reports whether an id is a built-in theme or one that is kept.
func (s *Themes) exists(id string) (bool, error) {
	if builtInThemes[id] {
		return true, nil
	}
	var found string
	err := s.DB.QueryRow(`SELECT id FROM themes WHERE id = ?`, id).Scan(&found)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// SetUse chooses the mode and the theme for each of light and dark: a built-in theme, or one that is kept.
// It replaces the single theme that was kept before modes existed.
func (s *Themes) SetUse(u Use) error {
	if !validMode[u.Mode] {
		return themeProblem("the mode must be light, dark or system")
	}
	for _, id := range []string{u.Light, u.Dark} {
		ok, err := s.exists(id)
		if err != nil {
			return err
		}
		if !ok {
			return themeProblem("there is no theme called " + id)
		}
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for key, value := range map[string]string{modeKey: u.Mode, lightKey: u.Light, darkKey: u.Dark} {
		if _, err := tx.Exec(`INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`, key, value); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM settings WHERE key = ?`, activeKey); err != nil {
		return err
	}
	return tx.Commit()
}

// registerThemes adds the Appearance page's routes. They are not among the connector's allowed routes:
// Claude Code has no reason to read or change how devdeck looks.
func registerThemes(g *echo.Group, s *Themes) {
	ag := g.Group("/appearance", limitBody)
	fail := func(c echo.Context, err error) error {
		var p themeProblem
		if errors.As(err, &p) {
			return echo.NewHTTPError(http.StatusUnprocessableEntity, p.Error())
		}
		c.Logger().Error(oneLine(err))
		return echo.NewHTTPError(http.StatusInternalServerError, "the themes couldn't be saved")
	}

	// GET /appearance is the themes and which one is in use.
	ag.GET("", func(c echo.Context) error {
		a, err := s.Load()
		if err != nil {
			c.Logger().Error(oneLine(err))
			return echo.NewHTTPError(http.StatusInternalServerError, "the themes couldn't be read")
		}
		return c.JSON(http.StatusOK, a)
	})

	// PUT /appearance/themes/:id adds a theme or replaces it. The id in the address and in the body must agree.
	ag.PUT("/themes/:id", func(c echo.Context) error {
		var t Theme
		if err := c.Bind(&t); err != nil {
			return bindError(err)
		}
		if t.ID != c.Param("id") {
			return echo.NewHTTPError(http.StatusBadRequest, "the theme's id must be the one in the address")
		}
		t, err := t.clean()
		if err == nil {
			err = s.Save(t)
		}
		if err != nil {
			return fail(c, err)
		}
		return c.JSON(http.StatusOK, t)
	})

	ag.DELETE("/themes/:id", func(c echo.Context) error {
		found, err := s.Delete(c.Param("id"))
		if err != nil {
			return fail(c, err)
		}
		if !found {
			return echo.NewHTTPError(http.StatusNotFound, "no such theme")
		}
		return c.NoContent(http.StatusNoContent)
	})

	// PUT /appearance/use chooses the mode and the theme for light and for dark:
	// {"mode": "system", "light": "paper", "dark": "paper-dark"}.
	ag.PUT("/use", func(c echo.Context) error {
		var body Use
		if err := c.Bind(&body); err != nil {
			return bindError(err)
		}
		if err := s.SetUse(body); err != nil {
			return fail(c, err)
		}
		return c.NoContent(http.StatusNoContent)
	})
}
