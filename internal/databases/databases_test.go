package databases

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestEngineOf(t *testing.T) {
	tests := map[string]string{
		"postgres:16": Postgres, "postgis/postgis:16-3.4": Postgres, "postgresql": Postgres,
		"mysql:8": MySQL, "mariadb:11": MySQL,
		"redis:7-alpine": Redis, "valkey/valkey:8": Redis, "rediss": Redis,
		"mongo:7": Mongo, "mongodb": Mongo,
		"nginx:1.27": "", "acme/api:1.2": "",
	}
	for in, want := range tests {
		if got := engineOf(lastPart(in)); got != want {
			t.Errorf("engineOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPublished(t *testing.T) {
	tests := []struct {
		name  string
		ports []any
		want  int
	}{
		{"same port", []any{"5432:5432"}, 5432},
		{"another host port", []any{"5433:5432"}, 5433},
		{"bound to loopback", []any{"127.0.0.1:5434:5432"}, 5434},
		{"long form", []any{map[string]any{"target": 5432, "published": "5435"}}, 5435},
		{"only the target", []any{"5432"}, 5432},
		{"none: the engine's own", nil, 5432},
		{"another service's port is ignored", []any{"8080:80"}, 5432},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := published(tc.ports, 5432); got != tc.want {
				t.Errorf("published = %d, want %d", got, tc.want)
			}
		})
	}
}

func TestParseURLDropsTheUserAndPassword(t *testing.T) {
	tests := []struct {
		raw  string
		want ref
		ok   bool
	}{
		{"postgres://app:s3cret@localhost:5433/shop?sslmode=disable", ref{engine: Postgres, host: "localhost", port: 5433, name: "shop"}, true},
		{"postgresql://db.example.com/orders", ref{engine: Postgres, host: "db.example.com", port: 5432, name: "orders"}, true},
		{"mysql://root:pw@127.0.0.1/app", ref{engine: MySQL, host: "127.0.0.1", port: 3306, name: "app"}, true},
		{"redis://:pw@localhost:6380/2", ref{engine: Redis, host: "localhost", port: 6380}, true},
		{"mongodb+srv://u:p@cluster.example.com/main", ref{engine: Mongo, host: "cluster.example.com", port: 27017, name: "main"}, true},
		{"${DATABASE_URL}", ref{}, false},
		{"https://example.com", ref{}, false},
		{"not a url", ref{}, false},
	}
	for _, tc := range tests {
		got, ok := parseURL(tc.raw)
		if ok != tc.ok || got != tc.want {
			t.Errorf("parseURL(%q) = %+v %v, want %+v %v", tc.raw, got, ok, tc.want, tc.ok)
		}
	}
}

func writeFile(t *testing.T, dir, name, text string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(text), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const composeYAML = `services:
  db:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: shop
      POSTGRES_PASSWORD: s3cret
  cache:
    image: redis:7
    ports:
      - "6379:6379"
  web:
    image: nginx
`

// up says postgres on 5432 answers and nothing else does.
func up(_ context.Context, port int) bool { return port == 5432 }

func TestFind(t *testing.T) {
	dir := t.TempDir()
	compose := []ComposeFile{{Repo: "infra", Path: writeFile(t, dir, "docker-compose.yml", composeYAML), Display: "infra/docker-compose.yml"}}
	env := []EnvFile{
		{Repo: "api", Entries: []string{"DATABASE_URL=postgres://app:s3cret@localhost:5432/shop", "REDIS_URL=redis://localhost:6379"}},
		{Repo: "worker", Entries: []string{"DATABASE_URL=postgres://app:s3cret@127.0.0.1:5432/shop"}},
		{Repo: "reports", Entries: []string{"PGHOST=localhost", "PGPORT=5433", "PGDATABASE=reports", "PGPASSWORD=s3cret"}},
		{Repo: "billing", Entries: []string{"BILLING_DB_URL=postgres://u:s3cret@db.example.com/billing"}},
	}
	rep := Find(context.Background(), compose, env, up)

	got := map[string]Database{}
	for _, d := range rep.Databases {
		got[d.ID] = d
	}
	tests := []struct {
		id     string
		engine string
		port   int
		name   string
		usedBy []string
		status string
	}{
		{"db", Postgres, 5432, "shop", []string{"api", "worker"}, "up"}, // shared by two repos
		{"cache", Redis, 6379, "", []string{"api"}, "down"},
		{"postgres-5433", Postgres, 5433, "reports", []string{"reports"}, "down"}, // installed on this machine
		{"postgres-db.example.com", Postgres, 5432, "billing", []string{"billing"}, "unknown"},
	}
	for _, tc := range tests {
		d, ok := got[tc.id]
		if !ok {
			t.Errorf("%s wasn't found (found %v)", tc.id, rep.Databases)
			continue
		}
		if d.Engine != tc.engine || d.Port != tc.port || d.Name != tc.name || !reflect.DeepEqual(d.UsedBy, tc.usedBy) || d.Status != tc.status {
			t.Errorf("%s = %+v", tc.id, d)
		}
	}
	if len(rep.Databases) != 4 {
		t.Errorf("found %d databases, want 4 (nginx isn't one)", len(rep.Databases))
	}
	if len(rep.Warnings) != 1 || !strings.Contains(rep.Warnings[0].Message, `points at port 5433, but the compose postgres "db" listens on 5432`) {
		t.Errorf("warnings = %+v", rep.Warnings)
	}

	out, _ := json.Marshal(rep)
	for _, secret := range []string{"s3cret", "app:", "u:"} {
		if strings.Contains(string(out), secret) {
			t.Errorf("the report holds %q: %s", secret, out)
		}
	}
}

func TestFindWithNothing(t *testing.T) {
	rep := Find(context.Background(), nil, []EnvFile{{Repo: "cli", Entries: []string{"LOG_LEVEL=debug"}}}, up)
	if len(rep.Databases) != 0 || len(rep.Warnings) != 0 {
		t.Errorf("rep = %+v, want nothing", rep)
	}
	bad := Find(context.Background(), []ComposeFile{{Repo: "infra", Path: filepath.Join(t.TempDir(), "missing.yml"), Display: "infra/missing.yml"}}, nil, up)
	if len(bad.Warnings) != 1 || !strings.Contains(bad.Warnings[0].Message, "infra/missing.yml couldn't be read") {
		t.Errorf("a missing compose file = %+v", bad.Warnings)
	}
}
