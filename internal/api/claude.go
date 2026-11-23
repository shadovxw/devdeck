package api

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/labstack/echo/v4"
	"go.yaml.in/yaml/v3"
)

// maxCalls is how many connector requests the audit list keeps.
const maxCalls = 1000

// Call is one request the Claude Code connector made, for the audit list. It holds what
// was asked (the path and query), never the answer and never a request body.
type Call struct {
	ID     int64     `json:"id"`
	At     time.Time `json:"at"`
	Tool   string    `json:"tool,omitempty"`
	Method string    `json:"method"`
	Path   string    `json:"path"`
	Query  string    `json:"query,omitempty"`
	Status int       `json:"status"`
	Bytes  int64     `json:"bytes"`
}

// Claude is what the person controls about Claude Code's access: which areas are on
// (a small YAML file, read at every request) and the audit list of what it asked for.
type Claude struct {
	// Path is the switches file, claude-access.yaml in the data folder.
	Path string
	// DB keeps the audit list. Nil keeps none.
	DB *sql.DB
}

// NewClaude is the access control for a data folder's file and database.
func NewClaude(db *sql.DB, path string) *Claude { return &Claude{Path: path, DB: db} }

// Allowed reports whether an area is on right now.
func (c *Claude) Allowed(area string) bool { return FileAccess(c.Path)(area) }

// AreaState is one switch as the page shows it.
type AreaState struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	On          bool   `json:"on"`
	Default     bool   `json:"default"`
}

// ClaudeState is the whole Claude access page: the switches and when Claude last asked.
type ClaudeState struct {
	Areas []AreaState `json:"areas"`
	// LastCall is when the connector last asked for anything; nil if it never has.
	LastCall *time.Time `json:"last_call,omitempty"`
	// Calls is how many requests the audit list holds.
	Calls int `json:"calls"`
}

// State reads the switches and the audit summary.
func (c *Claude) State() (ClaudeState, error) {
	access := FileAccess(c.Path)
	st := ClaudeState{Areas: make([]AreaState, 0, len(areas))}
	for _, a := range areas {
		st.Areas = append(st.Areas, AreaState{ID: a.ID, Label: a.Label, Description: a.Description, On: access(a.ID), Default: a.Default})
	}
	if c.DB == nil {
		return st, nil
	}
	var last sql.NullString
	if err := c.DB.QueryRow(`SELECT COUNT(*), MAX(at) FROM claude_calls`).Scan(&st.Calls, &last); err != nil {
		return st, err
	}
	if last.Valid {
		if t, err := time.Parse(time.RFC3339Nano, last.String); err == nil {
			st.LastCall = &t
		}
	}
	return st, nil
}

// Set switches areas on or off and keeps the rest as they are. Only known areas are
// accepted. The file is replaced in one step, so a reader never sees half of it.
func (c *Claude) Set(on map[string]bool) error {
	access := FileAccess(c.Path)
	all := map[string]bool{}
	for _, a := range areas {
		all[a.ID] = access(a.ID)
	}
	for id, v := range on {
		if _, ok := areaByID(id); !ok {
			return fmt.Errorf("there is no access area called %q", id)
		}
		all[id] = v
	}
	b, err := yaml.Marshal(all)
	if err != nil {
		return err
	}
	b = append([]byte("# What Claude Code's connector may read from devdeck. Changed on the Claude access page.\n"), b...)
	if err := os.MkdirAll(filepath.Dir(c.Path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(c.Path), ".claude-access-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(b)
	cerr := tmp.Close()
	if werr != nil || cerr != nil {
		_ = os.Remove(tmp.Name())
		if werr != nil {
			return werr
		}
		return cerr
	}
	if err := os.Rename(tmp.Name(), c.Path); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// record notes one connector request and drops the oldest beyond maxCalls. A failure is
// not worth failing the request for, so it is only reported.
func (c *Claude) record(call Call) {
	if c.DB == nil {
		return
	}
	if _, err := c.DB.Exec(`INSERT INTO claude_calls (at, tool, method, path, query, status, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		time.Now().UTC().Format(time.RFC3339Nano), call.Tool, call.Method, call.Path, call.Query, call.Status, call.Bytes); err != nil {
		return
	}
	_, _ = c.DB.Exec(`DELETE FROM claude_calls WHERE id <= (SELECT MAX(id) FROM claude_calls) - ?`, maxCalls)
}

// Calls lists the newest requests first.
func (c *Claude) Calls(limit int) ([]Call, error) {
	out := []Call{}
	if c.DB == nil {
		return out, nil
	}
	rows, err := c.DB.Query(`SELECT id, at, tool, method, path, query, status, bytes FROM claude_calls ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return out, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var call Call
		var at string
		if err := rows.Scan(&call.ID, &at, &call.Tool, &call.Method, &call.Path, &call.Query, &call.Status, &call.Bytes); err != nil {
			return out, err
		}
		call.At, _ = time.Parse(time.RFC3339Nano, at)
		out = append(out, call)
	}
	return out, rows.Err()
}

// Clear empties the audit list.
func (c *Claude) Clear() error {
	if c.DB == nil {
		return nil
	}
	_, err := c.DB.Exec(`DELETE FROM claude_calls`)
	return err
}

// registerClaude adds the routes of the Claude access page. They are not among the
// connector's routes, so Claude can't switch its own access on.
func registerClaude(g *echo.Group, c *Claude) {
	cg := g.Group("/claude", limitBody)
	fail := func(c echo.Context, err error, what string) error {
		c.Logger().Error(oneLine(err))
		return echo.NewHTTPError(http.StatusInternalServerError, what)
	}

	// GET /claude is the page: the switches, and when Claude last asked.
	cg.GET("", func(ctx echo.Context) error {
		st, err := c.State()
		if err != nil {
			return fail(ctx, err, "the Claude access settings couldn't be read")
		}
		return ctx.JSON(http.StatusOK, st)
	})

	// PUT /claude/access switches areas: {"hosts": true, "git": false}. Others stay as they are.
	cg.PUT("/access", func(ctx echo.Context) error {
		var body map[string]bool
		if err := ctx.Bind(&body); err != nil {
			return bindError(err)
		}
		if len(body) == 0 {
			return echo.NewHTTPError(http.StatusBadRequest, "say which areas to switch, for example {\"hosts\": true}")
		}
		for id := range body {
			if _, ok := areaByID(id); !ok {
				return echo.NewHTTPError(http.StatusBadRequest, fmt.Sprintf("there is no access area called %q", id))
			}
		}
		if err := c.Set(body); err != nil {
			return fail(ctx, err, "the Claude access settings couldn't be saved")
		}
		st, err := c.State()
		if err != nil {
			return fail(ctx, err, "the Claude access settings couldn't be read")
		}
		return ctx.JSON(http.StatusOK, st)
	})

	// GET /claude/calls lists what the connector asked for, newest first (limit 100 by default, 1000 at most).
	cg.GET("/calls", func(ctx echo.Context) error {
		limit := 100
		if v := ctx.QueryParam("limit"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 1 || n > maxCalls {
				return echo.NewHTTPError(http.StatusBadRequest, "limit must be a number from 1 to 1000")
			}
			limit = n
		}
		calls, err := c.Calls(limit)
		if err != nil {
			return fail(ctx, err, "the audit list couldn't be read")
		}
		return ctx.JSON(http.StatusOK, calls)
	})

	cg.DELETE("/calls", func(ctx echo.Context) error {
		if err := c.Clear(); err != nil {
			return fail(ctx, err, "the audit list couldn't be cleared")
		}
		return ctx.NoContent(http.StatusNoContent)
	})
}
