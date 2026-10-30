package api

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/labstack/echo/v4"
)

// ConnectorHeader is sent by `devdeck mcp`, the Claude Code connector, on every request.
// The server holds such a request to the read-only routes below (plan
// 2026-10-30-claude-connector §2), so even a changed connector can't write.
const ConnectorHeader = "X-Devdeck-Client"

// ConnectorClient is the value of ConnectorHeader that names the connector.
const ConnectorClient = "mcp"

// connectorRoutes are the only paths a connector request may GET.
//
// A stack's logs are readable (the lines, their histogram and their error groups; what
// is captured and the saved filters are settings and stay out). They are masked when
// they are stored.
var connectorRoutes = regexp.MustCompile(`^/api/v1/(health|runs|doctor|workspaces(/[^/]+(/stacks/[^/]+/logs(/histogram|/groups)?)?)?)$`)

// ConnectorGuard refuses, with 403, a connector request that is not a GET of a route
// in connectorRoutes. Requests that don't name themselves the connector pass through:
// the guard limits the connector, it does not police other local clients.
func ConnectorGuard() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if !strings.EqualFold(req.Header.Get(ConnectorHeader), ConnectorClient) {
				return next(c)
			}
			if req.Method != http.MethodGet || !connectorRoutes.MatchString(req.URL.Path) {
				return echo.NewHTTPError(http.StatusForbidden, "this isn't available to Claude")
			}
			return next(c)
		}
	}
}
