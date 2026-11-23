package api

import (
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"
)

// Guard rejects requests that did not come from devdeck's own UI (plan §6.1).
// It protects against DNS rebinding (checks Host) and cross-site requests from
// other web pages (checks Origin). It covers HTTP and the WebSocket upgrade.
type Guard struct {
	hosts   map[string]struct{}
	origins map[string]struct{}
}

// NewGuard builds a guard for a server listening on addr. extraOrigins are
// additional allowed browser origins such as the Vite dev server.
func NewGuard(addr string, extraOrigins []string) (*Guard, error) {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, err
	}
	g := &Guard{hosts: map[string]struct{}{}, origins: map[string]struct{}{}}
	for _, name := range []string{"localhost", "127.0.0.1", "[::1]"} {
		hostport := name + ":" + port
		g.hosts[hostport] = struct{}{}
		g.origins["http://"+hostport] = struct{}{}
	}
	for _, o := range extraOrigins {
		g.origins[strings.ToLower(strings.TrimRight(o, "/"))] = struct{}{}
	}
	return g, nil
}

// Middleware returns the Echo middleware. A missing Origin is allowed (curl,
// the CLI, same-origin GETs); browsers always send it on cross-site and
// WebSocket requests.
func (g *Guard) Middleware() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if _, ok := g.hosts[strings.ToLower(req.Host)]; !ok {
				return echo.NewHTTPError(http.StatusForbidden, "host not allowed")
			}
			if origin := req.Header.Get("Origin"); origin != "" && !g.originAllowed(origin) {
				return echo.NewHTTPError(http.StatusForbidden, "origin not allowed")
			}
			return next(c)
		}
	}
}

// OriginHosts lists the host:port part of every allowed origin, in the form
// the WebSocket library expects for its origin patterns.
func (g *Guard) OriginHosts() []string {
	hosts := make([]string, 0, len(g.origins))
	for o := range g.origins {
		if u, err := url.Parse(o); err == nil && u.Host != "" {
			hosts = append(hosts, u.Host)
		}
	}
	return hosts
}

func (g *Guard) originAllowed(origin string) bool {
	if _, ok := g.origins[strings.ToLower(strings.TrimRight(origin, "/"))]; ok {
		return true
	}
	// Normalise through url.Parse so "HTTP://127.0.0.1:7070" and similar match.
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	_, ok := g.origins[strings.ToLower(u.Scheme+"://"+u.Host)]
	return ok
}
