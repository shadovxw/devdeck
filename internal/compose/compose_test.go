package compose

import (
	"slices"
	"strings"
	"testing"
	"time"
)

func TestArgs(t *testing.T) {
	p := Project{Dir: "/srv/acme", Files: []string{"compose.db.yml", "compose.app.yml"}, EnvFiles: []string{".env", "versions.env"}}
	got := p.Args("ps", "--all")
	want := []string{"compose", "-f", "compose.db.yml", "-f", "compose.app.yml", "--env-file", ".env", "--env-file", "versions.env", "ps", "--all"}
	if !slices.Equal(got, want) {
		t.Errorf("args = %v", got)
	}
	since := time.Date(2026, 10, 22, 3, 30, 0, 5, time.UTC)
	if got := (Project{Files: []string{"c.yml"}}).FollowArgs("api", since); strings.Join(got, " ") != "compose -f c.yml logs --follow --no-color --no-log-prefix --timestamps --since 2026-10-22T03:30:00.000000005Z api" {
		t.Errorf("follow = %v", got)
	}
	if got := (Project{Files: []string{"c.yml"}}).FollowArgs("api", time.Time{}); slices.Contains(got, "--since") {
		t.Errorf("no since means from the start: %v", got)
	}
	if got := p.ViewArgs(); !slices.Equal(got[len(got)-4:], []string{"config", "--format", "json", "--no-interpolate"}) {
		t.Errorf("view = %v", got)
	}
}

func TestParsePS(t *testing.T) {
	line := `{"Name":"acme-api","Service":"api","Image":"acme/api:1.2","State":"running","Health":"healthy","Status":"Up 2 minutes (healthy)","ExitCode":0,"Publishers":[{"URL":"0.0.0.0","TargetPort":8080,"PublishedPort":8081,"Protocol":"tcp"}]}`
	for name, out := range map[string]string{
		"one object per line": line + "\n" + `{"Name":"acme-db","Service":"db","State":"exited","ExitCode":1}` + "\n",
		"an array":            "[" + line + `,{"Name":"acme-db","Service":"db","State":"exited","ExitCode":1}]`,
	} {
		got := ParsePS(out)
		if len(got) != 2 || got[0].Name != "acme-api" || got[0].Image != "acme/api:1.2" || got[0].Health != "healthy" || got[0].Publishers[0].PublishedPort != 8081 || got[1].ExitCode != 1 {
			t.Errorf("%s: %+v", name, got)
		}
	}
	for _, out := range []string{"", "   ", "not json", "[broken"} {
		if got := ParsePS(out); got != nil {
			t.Errorf("ParsePS(%q) = %v", out, got)
		}
	}
}

func TestParseLogLine(t *testing.T) {
	at, text := ParseLogLine("2026-10-22T03:30:00.5Z started  in 3s")
	if !at.Equal(time.Date(2026, 10, 22, 3, 30, 0, 500_000_000, time.UTC)) || text != "started  in 3s" {
		t.Errorf("got %v %q", at, text)
	}
	if _, text := ParseLogLine("2026-10-22T03:30:00Z"); text != "2026-10-22T03:30:00Z" {
		t.Errorf("a line that is only a time has no text to split off, got %q", text)
	}
	before := time.Now()
	at, text = ParseLogLine("no timestamp here")
	if text != "no timestamp here" || at.Before(before) {
		t.Errorf("a line with no time is kept whole and stamped now, got %v %q", at, text)
	}
}

// The shape `docker compose config --format json --no-interpolate` prints, with the
// variations Compose versions have used.
const configJSON = `{
  "name": "acme",
  "services": {
    "postgres": {
      "image": "acme/postgres:dev",
      "build": {"context": ".", "dockerfile": "db/Dockerfile"},
      "container_name": "acme-postgres",
      "environment": {"POSTGRES_PASSWORD": "${POSTGRES_PASSWORD}", "POSTGRES_USER": "${POSTGRES_USER}"},
      "healthcheck": {"test": ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"], "interval": "10s", "timeout": "5s", "retries": 5},
      "ports": [{"mode": "ingress", "target": 5432, "published": "5432", "protocol": "tcp"}],
      "volumes": [{"type": "volume", "source": "pg-data", "target": "/var/lib/postgresql/data"}],
      "restart": "unless-stopped"
    },
    "api": {
      "image": "${API_IMAGE}",
      "depends_on": {"postgres": {"condition": "service_healthy", "required": true}, "nats": {"required": true}},
      "environment": ["SMTP_PASSWORD=written-in-the-file", "LOG_LEVEL"],
      "ports": ["${API_PORT:-8081}:8081"],
      "volumes": ["./config/api.toml:/etc/api.toml:ro", {"type": "bind", "source": "./ssh/key", "target": "/key", "read_only": true}]
    },
    "worker": {
      "image": "acme/worker:1",
      "depends_on": ["api"],
      "ports": [{"target": 9000, "protocol": "udp", "host_ip": "127.0.0.1", "published": "9000"}],
      "healthcheck": {"disable": true}
    }
  }
}`

func TestParseView(t *testing.T) {
	v, err := ParseView([]byte(configJSON))
	if err != nil {
		t.Fatal(err)
	}
	if v.Name != "acme" || len(v.Services) != 3 || v.Services[0].Name != "api" || v.Services[2].Name != "worker" {
		t.Fatalf("view = %+v", v)
	}
	api, pg, worker := v.Services[0], v.Services[1], v.Services[2]

	if api.Image != "${API_IMAGE}" || api.Build {
		t.Errorf("api image = %q build %v", api.Image, api.Build)
	}
	if !slices.Equal(api.Env, []string{"LOG_LEVEL", "SMTP_PASSWORD"}) {
		t.Errorf("api env = %v", api.Env)
	}
	if len(api.DependsOn) != 2 || api.DependsOn[0] != (Dependency{"nats", "service_started"}) || api.DependsOn[1] != (Dependency{"postgres", "service_healthy"}) {
		t.Errorf("api depends_on = %v", api.DependsOn)
	}
	if !slices.Equal(api.Ports, []string{"${API_PORT:-8081}:8081"}) || !slices.Equal(api.Volumes, []string{"./config/api.toml:/etc/api.toml:ro", "./ssh/key:/key:ro"}) {
		t.Errorf("api ports %v volumes %v", api.Ports, api.Volumes)
	}

	if !pg.Build || pg.ContainerName != "acme-postgres" || pg.Restart != "unless-stopped" {
		t.Errorf("postgres = %+v", pg)
	}
	if pg.Healthcheck == nil || pg.Healthcheck.Test != "pg_isready -U ${POSTGRES_USER}" || pg.Healthcheck.Interval != "10s" || pg.Healthcheck.Retries != 5 {
		t.Errorf("postgres healthcheck = %+v", pg.Healthcheck)
	}
	if !slices.Equal(pg.Ports, []string{"5432:5432"}) || !slices.Equal(pg.Volumes, []string{"pg-data:/var/lib/postgresql/data"}) {
		t.Errorf("postgres ports %v volumes %v", pg.Ports, pg.Volumes)
	}

	if len(worker.DependsOn) != 1 || worker.DependsOn[0] != (Dependency{"api", "service_started"}) {
		t.Errorf("worker depends_on = %v", worker.DependsOn)
	}
	if !slices.Equal(worker.Ports, []string{"127.0.0.1:9000:9000/udp"}) || worker.Healthcheck == nil || !worker.Healthcheck.Disabled {
		t.Errorf("worker = %+v", worker)
	}
	if worker.Env == nil || worker.Volumes == nil {
		t.Error("empty lists are [] in JSON, not null")
	}
}

func TestParseViewNeverKeepsAValue(t *testing.T) {
	v, err := ParseView([]byte(configJSON))
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range v.Services {
		for _, e := range s.Env {
			if strings.Contains(e, "=") || strings.Contains(e, "written-in-the-file") {
				t.Errorf("%s: an environment value was kept: %q", s.Name, e)
			}
		}
	}
	if _, err := ParseView([]byte("not json")); err == nil {
		t.Error("output that isn't JSON must be an error")
	}
}
