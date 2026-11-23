package api

import (
	"net/http"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// UISnapshot is where the person is in devdeck's window: the page, its filters and the
// error it shows. The web app sends it when that changes. It is built from the same
// non-secret fields the page shows, held in memory only, and gone when devdeck quits.
type UISnapshot struct {
	// Route is the path of the page, such as /logs.
	Route string `json:"route"`
	// Label is the page's name in the sidebar.
	Label string `json:"label,omitempty"`
	// Params are the page's address parameters (its filters and selection).
	Params map[string]string `json:"params,omitempty"`
	// Notice is the text of the error or alert the page shows, if any.
	Notice string `json:"notice,omitempty"`
	// At is when the app reported it; set by the server.
	At *time.Time `json:"at,omitempty"`
}

// Limits on what a snapshot may hold, so the page can't make devdeck keep a lot.
const (
	maxRoute   = 200
	maxLabel   = 100
	maxParams  = 20
	maxParamK  = 50
	maxParamV  = 300
	maxNotice  = 500
	uiStateMax = 8 << 10
)

type uiState struct {
	mu   sync.Mutex
	snap UISnapshot
}

func (s *UISnapshot) check() string {
	switch {
	case s.Route == "" || len(s.Route) > maxRoute || s.Route[0] != '/':
		return "route must be a path that starts with /, at most 200 characters"
	case len(s.Label) > maxLabel:
		return "label is too long"
	case len(s.Params) > maxParams:
		return "too many params"
	case len(s.Notice) > maxNotice:
		return "notice is too long"
	}
	for k, v := range s.Params {
		if len(k) > maxParamK || len(v) > maxParamV {
			return "a param is too long"
		}
	}
	return ""
}

// registerUIState adds PUT /ui/state (the page reports) and GET /ui/state (the page's
// current state; the connector reads it when the ui area is on).
func registerUIState(g *echo.Group) {
	st := &uiState{}
	ug := g.Group("/ui", limitBody)
	ug.PUT("/state", func(c echo.Context) error {
		var s UISnapshot
		if err := c.Bind(&s); err != nil {
			return bindError(err)
		}
		if msg := s.check(); msg != "" {
			return echo.NewHTTPError(http.StatusBadRequest, msg)
		}
		now := time.Now().UTC()
		s.At = &now
		st.mu.Lock()
		st.snap = s
		st.mu.Unlock()
		return c.NoContent(http.StatusNoContent)
	})
	ug.GET("/state", func(c echo.Context) error {
		st.mu.Lock()
		s := st.snap
		st.mu.Unlock()
		return c.JSON(http.StatusOK, s)
	})
}
