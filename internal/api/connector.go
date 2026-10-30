package api

import (
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
	"go.yaml.in/yaml/v3"
)

// ConnectorHeader is sent by `devdeck mcp`, the Claude Code connector, on every request.
// The server holds such a request to the read-only routes below (plan
// 2026-10-30-claude-connector §2), so even a changed connector can't write.
const ConnectorHeader = "X-Devdeck-Client"

// ConnectorClient is the value of ConnectorHeader that names the connector.
const ConnectorClient = "mcp"

// AreaHosts is the access area for remote hosts: what a host shows and what its agent
// answers. It is off until the person switches it on, because a host's log lines leave
// the machine through the tunnel.
const AreaHosts = "hosts"

// maxConnectorTail is the most host log lines the connector gets in one request.
const maxConnectorTail = 200

// connectorRoutes are the paths a connector request may always GET.
//
// A stack's logs are readable (the lines, their histogram and their error groups; what
// is captured and the saved filters are settings and stay out). They are masked when
// they are stored.
var connectorRoutes = regexp.MustCompile(`^/api/v1/(health|runs|doctor|workspaces(/[^/]+(/stacks/[^/]+/logs(/histogram|/groups)?)?)?)$`)

// hostRoutes are the host paths a connector request may GET once AreaHosts is on: the
// list, one host, and, for a host whose tunnel is already open, what its agent says.
var (
	hostViewRoutes = regexp.MustCompile(`^/api/v1/hosts(/[^/]+/[^/]+)?$`)
	hostDataRoutes = regexp.MustCompile(`^/api/v1/hosts/([^/]+)/([^/]+)/(info|stacks/[^/]+/(?:services|compose|logs))$`)
)

// ConnectorPolicy says what the connector may reach beyond its always-open routes.
type ConnectorPolicy struct {
	// Access reports whether an area (AreaHosts) is switched on. Nil means everything
	// switchable is off.
	Access func(area string) bool
	// HostConnected reports whether a host's tunnel is open now. The connector never
	// opens one: the person opens it on the Remote hosts page. Nil means none is.
	HostConnected func(workspace, host string) bool
}

// ConnectorGuard refuses, with 403, a connector request that is not a GET of an allowed
// route. Requests that don't name themselves the connector pass through: the guard
// limits the connector, it does not police other local clients.
func ConnectorGuard(p ConnectorPolicy) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if !strings.EqualFold(req.Header.Get(ConnectorHeader), ConnectorClient) {
				return next(c)
			}
			path := req.URL.Path
			switch {
			case req.Method != http.MethodGet:
				// a write: refused below
			case connectorRoutes.MatchString(path):
				return next(c)
			case hostViewRoutes.MatchString(path) || hostDataRoutes.MatchString(path):
				if p.Access == nil || !p.Access(AreaHosts) {
					return echo.NewHTTPError(http.StatusForbidden, "remote hosts are switched off for Claude: turn them on in devdeck's Claude access setting")
				}
				if m := hostDataRoutes.FindStringSubmatch(path); m != nil {
					if p.HostConnected == nil || !p.HostConnected(m[1], m[2]) {
						return echo.NewHTTPError(http.StatusConflict, "the host isn't connected: open it on the Remote hosts page first, then ask again")
					}
					if strings.HasSuffix(path, "/logs") {
						clampTail(req)
					}
				}
				return next(c)
			}
			return echo.NewHTTPError(http.StatusForbidden, "this isn't available to Claude")
		}
	}
}

// clampTail limits how many lines of a host's logs the connector asks for.
func clampTail(req *http.Request) {
	q := req.URL.Query()
	raw := q.Get("tail")
	if n, err := strconv.Atoi(raw); err == nil {
		if n <= maxConnectorTail {
			return
		}
	} else if raw != "" {
		return // not a number: the handler refuses it
	}
	q.Set("tail", strconv.Itoa(maxConnectorTail))
	req.URL.RawQuery = q.Encode()
}

// FileAccess reads the switches from a YAML file of area: true/false lines, each time it
// is asked, so a change applies at once. A missing or unreadable file means everything
// is off. The Claude access panel writes this file.
func FileAccess(path string) func(area string) bool {
	return func(area string) bool {
		b, err := os.ReadFile(path)
		if err != nil {
			return false
		}
		var on map[string]bool
		if yaml.Unmarshal(b, &on) != nil {
			return false
		}
		return on[area]
	}
}
