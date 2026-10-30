package api

import (
	"errors"
	"io/fs"
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

// ToolHeader names the connector's tool behind a request, for the audit list.
const ToolHeader = "X-Devdeck-Tool"

// maxConnectorTail is the most host log lines the connector gets in one request.
const maxConnectorTail = 200

// An access area is a part of what devdeck knows that the person can switch off for
// Claude (the Claude access page). Which are on is kept in claude-access.yaml.
const (
	AreaWorkspaces = "workspaces"
	AreaLogs       = "logs"
	AreaGit        = "git"
	AreaHosts      = "hosts"
	AreaUI         = "ui"
)

// areaInfo says what a switch is for, in the words the page shows.
type areaInfo struct {
	ID          string
	Label       string
	Description string
	// Default is whether the area is on when nobody has said. Remote hosts are off: their
	// log lines leave the host through a tunnel, so the person chooses.
	Default bool
}

var areas = []areaInfo{
	{AreaWorkspaces, "Workspaces and stacks", "Workspaces and their files, what is running, the YAML check and the Doctor.", true},
	{AreaLogs, "Logs", "The stored output of your stacks, with secrets already masked.", true},
	{AreaGit, "Git accounts", "Which GitHub accounts are signed in, commit names and emails, each repository's account. Never tokens.", true},
	{AreaHosts, "Remote hosts", "Containers, configuration and recent log lines of remote hosts, only while their tunnel is open. Lines are masked, but host logs are raw.", false},
	{AreaUI, "What's on your screen", "Which page, filters and error message devdeck is showing right now.", true},
}

func areaByID(id string) (areaInfo, bool) {
	for _, a := range areas {
		if a.ID == id {
			return a, true
		}
	}
	return areaInfo{}, false
}

// DefaultAccess is what an area is set to when nobody has said.
func DefaultAccess(area string) bool {
	a, _ := areaByID(area)
	return a.Default
}

// A route is a path the connector may GET, and the area that has to be on for it.
type route struct {
	re   *regexp.Regexp
	area string // "" means always
}

var connectorRoutes = []route{
	{regexp.MustCompile(`^/api/v1/health$`), ""},
	{regexp.MustCompile(`^/api/v1/(runs|doctor|workspaces(/[^/]+)?)$`), AreaWorkspaces},
	// A stack's logs: the lines, their histogram and their error groups. What is captured
	// and the saved filters are settings and stay out. Lines are masked when stored.
	{regexp.MustCompile(`^/api/v1/workspaces/[^/]+/stacks/[^/]+/logs(/histogram|/groups)?$`), AreaLogs},
	{regexp.MustCompile(`^/api/v1/git(/repos)?$`), AreaGit},
	{regexp.MustCompile(`^/api/v1/ui/state$`), AreaUI},
	{regexp.MustCompile(`^/api/v1/hosts(/[^/]+/[^/]+)?$`), AreaHosts},
}

// hostDataRoutes are what a host's agent says, for a host whose tunnel is already open.
var hostDataRoutes = regexp.MustCompile(`^/api/v1/hosts/([^/]+)/([^/]+)/(info|stacks/[^/]+/(?:services|compose|logs))$`)

// validatePath checks YAML text and saves nothing, so the connector may POST it (the one
// write-shaped request it gets). It belongs to the workspaces area.
const validatePath = "/api/v1/workspaces/validate"

// ConnectorPolicy says what the connector may reach and where to note what it did.
type ConnectorPolicy struct {
	// Access reports whether an area is switched on. Nil means DefaultAccess.
	Access func(area string) bool
	// HostConnected reports whether a host's tunnel is open now. The connector never
	// opens one: the person opens it on the Remote hosts page. Nil means none is.
	HostConnected func(workspace, host string) bool
	// Record is told about every connector request, allowed or not. Nil records nothing.
	Record func(Call)
}

// ConnectorGuard refuses, with 403, a connector request that is not a GET of an allowed
// route (or the YAML check), and notes every one for the audit list. Requests that don't
// name themselves the connector pass through: the guard limits the connector, it does not
// police other local clients.
func ConnectorGuard(p ConnectorPolicy) echo.MiddlewareFunc {
	access := p.Access
	if access == nil {
		access = DefaultAccess
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			req := c.Request()
			if !strings.EqualFold(req.Header.Get(ConnectorHeader), ConnectorClient) {
				return next(c)
			}
			call := Call{Tool: toolName(req.Header.Get(ToolHeader)), Method: req.Method, Path: req.URL.Path, Query: req.URL.RawQuery}

			err := p.decide(c, access)
			if err == nil {
				err = next(c)
			}
			if err != nil {
				c.Error(err) // writes the answer, so its status is known
			}
			if p.Record != nil {
				call.Status, call.Bytes = c.Response().Status, c.Response().Size
				p.Record(call)
			}
			return nil
		}
	}
}

// decide is nil when the request may go on, or the refusal to send.
func (p ConnectorPolicy) decide(c echo.Context, access func(string) bool) error {
	req := c.Request()
	path := req.URL.Path
	refuse := func(code int, msg string) error { return echo.NewHTTPError(code, msg) }
	off := func(area string) error {
		a, _ := areaByID(area)
		return refuse(http.StatusForbidden, a.Label+" are switched off for Claude: turn them on in devdeck's Claude access setting")
	}

	if req.Method == http.MethodPost && path == validatePath {
		if !access(AreaWorkspaces) {
			return off(AreaWorkspaces)
		}
		return nil
	}
	if req.Method != http.MethodGet {
		return refuse(http.StatusForbidden, "this isn't available to Claude")
	}
	area, ok := "", false
	for _, r := range connectorRoutes {
		if r.re.MatchString(path) {
			area, ok = r.area, true
			break
		}
	}
	m := hostDataRoutes.FindStringSubmatch(path)
	switch {
	case m != nil:
		area = AreaHosts
	case !ok:
		return refuse(http.StatusForbidden, "this isn't available to Claude")
	}
	if area != "" && !access(area) {
		return off(area)
	}
	if m != nil {
		if p.HostConnected == nil || !p.HostConnected(m[1], m[2]) {
			return refuse(http.StatusConflict, "the host isn't connected: open it on the Remote hosts page first, then ask again")
		}
		if strings.HasSuffix(path, "/logs") {
			clampTail(req)
		}
	}
	return nil
}

var toolPattern = regexp.MustCompile(`^[a-z_]{1,40}$`)

// toolName is the connector's tool as the audit list shows it, or "" for anything odd.
func toolName(v string) string {
	if toolPattern.MatchString(v) {
		return v
	}
	return ""
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
// is asked, so a change applies at once. With no file, or an area the file doesn't
// mention, the area is at DefaultAccess; a file that can't be read or understood switches
// everything off. The Claude access page writes this file.
func FileAccess(path string) func(area string) bool {
	return func(area string) bool {
		b, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			return DefaultAccess(area)
		}
		if err != nil {
			return false
		}
		var on map[string]bool
		if yaml.Unmarshal(b, &on) != nil {
			return false
		}
		if v, set := on[area]; set {
			return v
		}
		return DefaultAccess(area)
	}
}
