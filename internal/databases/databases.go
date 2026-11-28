// Package databases finds a project's databases (dev-plans/2026-11-22-projects §6, PJ6): the
// Postgres, MySQL, Redis or Mongo services in its compose files, and the ones its repos' .env
// files point at. It says who uses each one, whether it answers, and where a repo points at a
// port nothing in the project listens on.
//
// Only names, hosts, ports and database names are read. A password in a URL is cut off as the
// URL is parsed and never kept, logged or returned.
package databases

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"
)

// Engines devdeck knows.
const (
	Postgres = "postgres"
	MySQL    = "mysql"
	Redis    = "redis"
	Mongo    = "mongo"
)

// defaultPorts are each engine's usual port.
var defaultPorts = map[string]int{Postgres: 5432, MySQL: 3306, Redis: 6379, Mongo: 27017}

// Where a database was found.
const (
	FromCompose = "compose"
	FromEnv     = "env"
)

// Database is one database of the project.
type Database struct {
	// ID is the compose service's name, or engine-port for one found only in a .env.
	ID     string `json:"id"`
	Engine string `json:"engine"`
	// From is compose or env; Where says it in words ("infra/docker-compose.yml · db").
	From  string `json:"from"`
	Where string `json:"where"`
	Host  string `json:"host"`
	Port  int    `json:"port"`
	// Name is the database's name, when the compose file or a URL gives it.
	Name string `json:"name,omitempty"`
	// UsedBy are the repos whose .env points at it.
	UsedBy []string `json:"used_by"`
	// Status is up or down for one on this machine, unknown for another host.
	Status string `json:"status"`
}

// Warning is something that doesn't line up, such as a .env pointing at the wrong port.
type Warning struct {
	Repo    string `json:"repo,omitempty"`
	Message string `json:"message"`
}

// Report is what was found.
type Report struct {
	Databases []Database `json:"databases"`
	Warnings  []Warning  `json:"warnings"`
}

// ComposeFile is a compose file of the project: the repo it is in and its path.
type ComposeFile struct {
	Repo string
	Path string
	// Display is how to name it: "infra/docker-compose.yml".
	Display string
}

// EnvFile is a repo's .env, as KEY=VALUE entries (supervisor.LoadEnvFile reads them).
type EnvFile struct {
	Repo    string
	Entries []string
}

// engineOf says which engine an image or a URL scheme is.
func engineOf(s string) string {
	s = strings.ToLower(s)
	switch {
	case strings.Contains(s, "postgis"), strings.HasPrefix(s, "postgres"), strings.Contains(s, "/postgres"), s == "postgresql", strings.HasPrefix(s, "timescale"):
		return Postgres
	case strings.HasPrefix(s, "mysql"), strings.HasPrefix(s, "mariadb"), strings.Contains(s, "/mysql"), strings.Contains(s, "/mariadb"):
		return MySQL
	case strings.HasPrefix(s, "redis"), strings.HasPrefix(s, "valkey"), strings.Contains(s, "/redis"), s == "rediss":
		return Redis
	case strings.HasPrefix(s, "mongo"), strings.Contains(s, "/mongo"):
		return Mongo
	}
	return ""
}

// composeService is the part of a compose service this package reads.
type composeService struct {
	Image       string    `yaml:"image"`
	Ports       []any     `yaml:"ports"`
	Environment yaml.Node `yaml:"environment"`
}

// dbNameKeys are the variables that name the database an image creates.
var dbNameKeys = []string{"POSTGRES_DB", "MYSQL_DATABASE", "MARIADB_DATABASE", "MONGO_INITDB_DATABASE"}

// FromComposeFile reads the database services of one compose file: their engine (from the
// image), the port published on this machine, and the database name.
func FromComposeFile(f ComposeFile) ([]Database, error) {
	raw, err := os.ReadFile(f.Path)
	if err != nil {
		return nil, fmt.Errorf("%s couldn't be read", f.Display)
	}
	var doc struct {
		Services map[string]composeService `yaml:"services"`
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("%s isn't valid YAML", f.Display)
	}
	var out []Database
	for name, s := range doc.Services {
		engine := engineOf(lastPart(s.Image))
		if engine == "" {
			continue
		}
		d := Database{ID: name, Engine: engine, From: FromCompose, Where: f.Display + " · " + name, Host: "127.0.0.1", Port: published(s.Ports, defaultPorts[engine])}
		env := envMap(s.Environment)
		for _, k := range dbNameKeys {
			if v := env[k]; v != "" && !strings.Contains(v, "${") {
				d.Name = v
			}
		}
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

// lastPart is the image without its registry: "docker.io/library/postgres:16" → "postgres:16".
func lastPart(image string) string {
	if i := strings.LastIndex(image, "/"); i >= 0 {
		return image[i+1:]
	}
	return image
}

var portSpec = regexp.MustCompile(`^(?:\[?[0-9a-fA-F.:]*\]?:)?(\d+)(?:-\d+)?:(\d+)(?:/tcp)?$`)

// published is the host port that maps to the engine's port: "5433:5432", "127.0.0.1:5433:5432",
// or the long form {published, target}. Without a published port, the engine's own.
func published(ports []any, target int) int {
	for _, p := range ports {
		switch v := p.(type) {
		case string:
			if m := portSpec.FindStringSubmatch(v); m != nil {
				if t, _ := strconv.Atoi(m[2]); t == target {
					n, _ := strconv.Atoi(m[1])
					return n
				}
			}
		case int:
			if v == target {
				return v
			}
		case map[string]any:
			t, _ := strconv.Atoi(fmt.Sprint(v["target"]))
			if t == target {
				if n, err := strconv.Atoi(fmt.Sprint(v["published"])); err == nil {
					return n
				}
			}
		}
	}
	return target
}

// envMap reads a compose service's environment in either shape (a map, or a KEY=VALUE list).
func envMap(n yaml.Node) map[string]string {
	out := map[string]string{}
	switch n.Kind {
	case yaml.MappingNode:
		for i := 0; i+1 < len(n.Content); i += 2 {
			out[n.Content[i].Value] = n.Content[i+1].Value
		}
	case yaml.SequenceNode:
		for _, item := range n.Content {
			if k, v, ok := strings.Cut(item.Value, "="); ok {
				out[k] = v
			}
		}
	}
	return out
}

// ref is where a .env points: an engine, a host and port, a database name. Never a password.
type ref struct {
	key    string
	engine string
	host   string
	port   int
	name   string
}

var urlKey = regexp.MustCompile(`(?i)^(?:[A-Z0-9_]*_)?(DATABASE|DB|POSTGRES|PG|MYSQL|REDIS|MONGO|MONGODB)_(URL|URI|DSN)$|^(DATABASE_URL|REDIS_URL|MONGO_URL|MONGODB_URI)$`)

// refsOf reads where a repo's .env points: database URLs (DATABASE_URL, REDIS_URL, *_DB_URL…)
// and the PGHOST / PGPORT / PGDATABASE set. The user name and password are never kept.
func refsOf(entries []string) []ref {
	env := map[string]string{}
	for _, e := range entries {
		if k, v, ok := strings.Cut(e, "="); ok {
			env[k] = v
		}
	}
	var out []ref
	keys := make([]string, 0, len(env))
	for k := range env {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		if !urlKey.MatchString(k) {
			continue
		}
		if r, ok := parseURL(env[k]); ok {
			r.key = k
			out = append(out, r)
		}
	}
	if host := env["PGHOST"]; host != "" {
		port, err := strconv.Atoi(env["PGPORT"])
		if err != nil {
			port = defaultPorts[Postgres]
		}
		out = append(out, ref{key: "PGHOST", engine: Postgres, host: host, port: port, name: env["PGDATABASE"]})
	}
	return out
}

// parseURL reads a database URL's engine, host, port and database name. The user and password
// are dropped here and go no further.
func parseURL(raw string) (ref, bool) {
	if raw == "" || strings.Contains(raw, "${") {
		return ref{}, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return ref{}, false
	}
	engine := engineOf(strings.TrimSuffix(u.Scheme, "+srv"))
	if engine == "" {
		return ref{}, false
	}
	u.User = nil // never kept
	port, err := strconv.Atoi(u.Port())
	if err != nil {
		port = defaultPorts[engine]
	}
	name := strings.TrimPrefix(u.Path, "/")
	if engine == Redis {
		name = "" // a Redis path is a database number, not a name
	}
	return ref{engine: engine, host: u.Hostname(), port: port, name: name}, true
}

// local is whether a host is this machine.
func local(host string) bool {
	switch strings.ToLower(host) {
	case "localhost", "127.0.0.1", "::1", "0.0.0.0", "host.docker.internal":
		return true
	}
	return false
}

// Dial checks whether something listens on a port of this machine.
type Dial func(ctx context.Context, port int) bool

// TCPDial tries to connect to 127.0.0.1:port for a short moment.
func TCPDial(ctx context.Context, port int) bool {
	d := net.Dialer{Timeout: 300 * time.Millisecond}
	c, err := d.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		return false
	}
	_ = c.Close()
	return true
}

// Find puts it together: the compose databases, then each repo's references matched to them
// (same engine and port on this machine). A reference to this machine that matches none becomes
// its own database (installed locally), with a warning when a compose database of the same engine
// listens on another port. A reference to another host is listed, but not checked.
func Find(ctx context.Context, compose []ComposeFile, env []EnvFile, dial Dial) Report {
	rep := Report{Databases: []Database{}, Warnings: []Warning{}}
	for _, f := range compose {
		dbs, err := FromComposeFile(f)
		if err != nil {
			rep.Warnings = append(rep.Warnings, Warning{Repo: f.Repo, Message: err.Error()})
			continue
		}
		rep.Databases = append(rep.Databases, dbs...)
	}
	composeCount := len(rep.Databases)

	for _, f := range env {
		for _, r := range refsOf(f.Entries) {
			i := match(rep.Databases, r)
			if i < 0 {
				d := Database{ID: fmt.Sprintf("%s-%d", r.engine, r.port), Engine: r.engine, From: FromEnv, Host: r.host, Port: r.port, Name: r.name}
				if local(r.host) {
					d.Host = "127.0.0.1"
					d.Where = "installed on this machine (" + f.Repo + "'s " + r.key + ")"
					for _, c := range rep.Databases[:composeCount] {
						if c.Engine == r.engine && c.Port != r.port {
							rep.Warnings = append(rep.Warnings, Warning{Repo: f.Repo, Message: fmt.Sprintf("%s's %s points at port %d, but the compose %s %q listens on %d.", f.Repo, r.key, r.port, r.engine, c.ID, c.Port)})
						}
					}
				} else {
					d.ID = fmt.Sprintf("%s-%s", r.engine, r.host)
					d.Where = "on " + r.host + " (" + f.Repo + "'s " + r.key + ")"
				}
				rep.Databases = append(rep.Databases, d)
				i = len(rep.Databases) - 1
			}
			db := &rep.Databases[i]
			if !contains(db.UsedBy, f.Repo) {
				db.UsedBy = append(db.UsedBy, f.Repo)
			}
			if db.Name == "" {
				db.Name = r.name
			}
		}
	}

	for i := range rep.Databases {
		d := &rep.Databases[i]
		if d.UsedBy == nil {
			d.UsedBy = []string{}
		}
		switch {
		case !local(d.Host):
			d.Status = "unknown"
		case dial != nil && dial(ctx, d.Port):
			d.Status = "up"
		default:
			d.Status = "down"
		}
	}
	return rep
}

// match finds the database a reference points at: the same engine on the same host and port.
func match(dbs []Database, r ref) int {
	for i, d := range dbs {
		sameHost := d.Host == r.host || (local(d.Host) && local(r.host))
		if d.Engine == r.engine && d.Port == r.port && sameHost {
			return i
		}
	}
	return -1
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
