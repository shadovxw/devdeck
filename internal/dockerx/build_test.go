package dockerx

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/shadovxw/devdeck/internal/secrets"
)

// repoDir is a repository folder with a Dockerfile and a service folder with its own.
func repoDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	for _, f := range []string{"Dockerfile", "build/Dockerfile", "svc/Dockerfile"} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(dir, f)), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, f), []byte("FROM scratch\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func goodSpec(dir string) Spec {
	return Spec{Dir: dir, Repository: "acme/api", Tag: "1.0.3", Account: Account{ID: "work", Username: "ana-work"}}
}

func TestPlan(t *testing.T) {
	dir := repoDir(t)
	pl, err := goodSpec(dir).plan()
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(pl.args, " ")
	for _, want := range []string{
		"buildx build --progress plain --platform linux/amd64",
		"-f " + filepath.Join(dir, "Dockerfile"),
		"-t acme/api:1.0.3",
		"--push " + dir,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("args are missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "--label") || strings.Contains(got, "--secret") {
		t.Errorf("no revision or secrets were given, but: %s", got)
	}
	if !strings.HasSuffix(got, "--push "+dir) {
		t.Errorf("the context comes last, after --push: %s", got)
	}
}

func TestPlanOptions(t *testing.T) {
	dir := repoDir(t)
	s := goodSpec(dir)
	s.Dockerfile, s.Context = "build/Dockerfile", "svc"
	s.Platforms = []string{"linux/amd64", "linux/arm64"}
	s.Revision = "abc123"
	s.Secrets = []Secret{{ID: "gh_token", Value: secrets.NewValue("ghp_fake_value_1")}, {ID: "npm.token", Value: secrets.NewValue("npm_fake_value_1")}}
	pl, err := s.plan()
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join(pl.args, " ")
	for _, want := range []string{
		"--platform linux/amd64,linux/arm64",
		"-f " + filepath.Join(dir, "build", "Dockerfile"),
		"--label org.opencontainers.image.revision=abc123",
		"--secret id=gh_token,env=DEVDECK_BUILD_SECRET_0",
		"--secret id=npm.token,env=DEVDECK_BUILD_SECRET_1",
		"--push " + filepath.Join(dir, "svc"),
	} {
		if !strings.Contains(got, want) {
			t.Errorf("args are missing %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "ghp_fake") || strings.Contains(got, "npm_fake") {
		t.Errorf("a secret value is on the command line: %s", got)
	}
	if len(pl.env) != 2 || pl.env[0] != "DEVDECK_BUILD_SECRET_0=ghp_fake_value_1" {
		t.Errorf("the values belong in the environment: %v", pl.env)
	}
}

func TestPlanRefusals(t *testing.T) {
	dir := repoDir(t)
	tests := []struct {
		name string
		edit func(*Spec)
		want string
	}{
		{"a tag with a colon", func(s *Spec) { s.Tag = "1.0:latest" }, "isn't a tag"},
		{"an empty tag", func(s *Spec) { s.Tag = "" }, "isn't a tag"},
		{"a tag that starts with a dash", func(s *Spec) { s.Tag = "-x" }, "isn't a tag"},
		{"a tag with a space", func(s *Spec) { s.Tag = "a b" }, "isn't a tag"},
		{"a long tag", func(s *Spec) { s.Tag = strings.Repeat("a", 129) }, "isn't a tag"},
		{"a repository with a tag", func(s *Spec) { s.Repository = "acme/api:1" }, "isn't a Docker Hub repository"},
		{"a repository with no namespace", func(s *Spec) { s.Repository = "api" }, "isn't a Docker Hub repository"},
		{"a repository that starts with an option", func(s *Spec) { s.Repository = "--push/x" }, "isn't a Docker Hub repository"},
		{"no folder", func(s *Spec) { s.Dir = "" }, "folder is missing"},
		{"a folder that isn't there", func(s *Spec) { s.Dir = filepath.Join(dir, "nope") }, "doesn't exist"},
		{"a Dockerfile outside the repo", func(s *Spec) { s.Dockerfile = "../Dockerfile" }, "inside the repository"},
		{"a context outside the repo", func(s *Spec) { s.Context = ".." }, "inside the repository"},
		{"no Dockerfile", func(s *Spec) { s.Dockerfile = "missing/Dockerfile" }, "no Dockerfile"},
		{"a Dockerfile that is a folder", func(s *Spec) { s.Dockerfile = "build" }, "no Dockerfile"},
		{"a context that isn't a folder", func(s *Spec) { s.Context = "Dockerfile" }, "doesn't exist"},
		{"an unknown platform", func(s *Spec) { s.Platforms = []string{"windows/amd64"} }, "platform"},
		{"a bad secret id", func(s *Spec) { s.Secrets = []Secret{{ID: "1x", Value: secrets.NewValue("a-secret-value")}} }, "build secret id"},
		{"a secret with no value", func(s *Spec) { s.Secrets = []Secret{{ID: "gh_token"}} }, "no value"},
		{"a secret twice", func(s *Spec) {
			v := secrets.NewValue("a-secret-value")
			s.Secrets = []Secret{{ID: "gh_token", Value: v}, {ID: "gh_token", Value: v}}
		}, "given twice"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s := goodSpec(dir)
			tc.edit(&s)
			if _, err := s.plan(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("plan = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func fakeBuilder(t *testing.T) *Builder {
	t.Helper()
	t.Setenv("DEVDECK_FAKE_DOCKER", "1")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	user := t.TempDir()
	if err := os.WriteFile(filepath.Join(user, "config.json"), []byte(`{"auths":{"https://index.docker.io/v1/":{"auth":"must-not-be-copied"}},"credsStore":"desktop","currentContext":"desktop-linux"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{"contexts/meta/abc", "cli-plugins"} {
		if err := os.MkdirAll(filepath.Join(user, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(user, "contexts", "meta", "abc", "meta.json"), []byte(`{"Name":"desktop-linux"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	return &Builder{Docker: self, TempDir: t.TempDir(), UserConfig: user, Executable: func() (string, error) { return self, nil }}
}

func collect(into *[]string) func(string) {
	var mu sync.Mutex
	return func(l string) {
		mu.Lock()
		*into = append(*into, l)
		mu.Unlock()
	}
}

func TestBuildRunsDockerWithAPrivateConfig(t *testing.T) {
	b := fakeBuilder(t)
	dir := repoDir(t)
	s := goodSpec(dir)
	s.Revision = "abc123"
	s.Secrets = []Secret{{ID: "gh_token", Value: secrets.NewValue("ghp_fake_value_1")}}

	var lines []string
	if err := b.Build(context.Background(), s, collect(&lines)); err != nil {
		t.Fatalf("Build: %v\n%s", err, strings.Join(lines, "\n"))
	}
	text := strings.Join(lines, "\n")

	for _, want := range []string{
		"ARGS:buildx build --progress plain --platform linux/amd64",
		"-t acme/api:1.0.3",
		"--secret id=gh_token,env=DEVDECK_BUILD_SECRET_0",
		"HELPER: true",
		"ACCOUNT:work/ana-work",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the docker run is missing %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "ghp_fake_value_1") {
		t.Errorf("the secret was printed in the output:\n%s", text)
	}
	if !strings.Contains(text, "ENVVAR:DEVDECK_BUILD_SECRET_0=***") {
		t.Errorf("the secret should reach docker through the environment, masked in the output:\n%s", text)
	}

	// the private config: the helper as the only credential store, the person's context and plugins kept,
	// and none of the person's own logins copied
	var cfg map[string]any
	for _, l := range lines {
		if rest, ok := strings.CutPrefix(l, "CONFIG:"); ok {
			if err := json.Unmarshal([]byte(rest), &cfg); err != nil {
				t.Fatalf("config.json isn't JSON: %v: %s", err, rest)
			}
		}
	}
	if cfg["credsStore"] != "devdeck" || cfg["currentContext"] != "desktop-linux" {
		t.Errorf("config = %v", cfg)
	}
	if _, has := cfg["auths"]; has || strings.Contains(text, "must-not-be-copied") {
		t.Errorf("the person's logins were copied: %v", cfg)
	}
	if dirs, _ := cfg["cliPluginsExtraDirs"].([]any); len(dirs) != 1 || !strings.HasSuffix(filepath.ToSlash(dirs[0].(string)), "cli-plugins") {
		t.Errorf("the plugin folder should be kept: %v", cfg["cliPluginsExtraDirs"])
	}

	// nothing is left behind, and the person's own folder is untouched
	var cfgDir string
	for _, l := range lines {
		if rest, ok := strings.CutPrefix(l, "CONFIGDIR:"); ok {
			cfgDir = rest
		}
	}
	if _, err := os.Stat(cfgDir); !os.IsNotExist(err) {
		t.Errorf("the private config %s was left behind (%v)", cfgDir, err)
	}
	if entries, _ := os.ReadDir(b.TempDir); len(entries) != 0 {
		t.Errorf("%d entries left in the temp folder", len(entries))
	}
	if raw, _ := os.ReadFile(filepath.Join(b.UserConfig, "config.json")); !strings.Contains(string(raw), "must-not-be-copied") {
		t.Error("the person's own docker config was changed")
	}
}

func TestBuildCopiesContexts(t *testing.T) {
	b := fakeBuilder(t)
	// look at the private folder while docker "runs": the fake reports its config only, so
	// check the copy through prepare directly
	cfg, err := b.prepare()
	if err != nil {
		t.Fatal(err)
	}
	defer cfg.cleanup()
	raw, err := os.ReadFile(filepath.Join(cfg.dir, "contexts", "meta", "abc", "meta.json"))
	if err != nil || !strings.Contains(string(raw), "desktop-linux") {
		t.Errorf("the context wasn't copied: %v %s", err, raw)
	}
	name := HelperName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	self, _ := os.Executable()
	h, err := os.Stat(filepath.Join(cfg.bin, name))
	s, _ := os.Stat(self)
	if err != nil || h.Size() != s.Size() {
		t.Errorf("the helper should be devdeck's own program: %v", err)
	}
}

func TestBuildFailures(t *testing.T) {
	tests := []struct {
		name string
		say  string
		want string
	}{
		{"push denied", "denied: requested access to the resource is denied", "can't write to this repository"},
		{"bad login", "unauthorized: incorrect username or password", "refused the username or token"},
		{"docker not running", "error during connect: open //./pipe/dockerDesktopLinuxEngine", "Docker isn't running"},
		{"rate limit", "toomanyrequests: You have reached your pull rate limit", "too many requests"},
		{"anything else", "something odd happened", "exited with code 1"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := fakeBuilder(t)
			t.Setenv("FAKE_DOCKER_EXIT", "1")
			t.Setenv("FAKE_DOCKER_SAY", tc.say)
			var lines []string
			err := b.Build(context.Background(), goodSpec(repoDir(t)), collect(&lines))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Build = %v, want an error containing %q", err, tc.want)
			}
			if !strings.Contains(strings.Join(lines, "\n"), tc.say) {
				t.Errorf("docker's own words should still be in the output: %v", lines)
			}
		})
	}
}

func TestBuildRefusesBadSpecsBeforeRunningAnything(t *testing.T) {
	b := fakeBuilder(t)
	s := goodSpec(repoDir(t))
	s.Tag = "bad tag"
	ran := false
	if err := b.Build(context.Background(), s, func(string) { ran = true }); err == nil || ran {
		t.Errorf("Build = %v (ran %v)", err, ran)
	}
	if entries, _ := os.ReadDir(b.TempDir); len(entries) != 0 {
		t.Error("a refused build made a private config")
	}
}

func TestBuildNoDocker(t *testing.T) {
	b := &Builder{TempDir: t.TempDir()}
	t.Setenv("PATH", t.TempDir()) // no docker here
	if err := b.Build(context.Background(), goodSpec(repoDir(t)), func(string) {}); !errors.Is(err, ErrNoDocker) {
		t.Errorf("Build = %v, want ErrNoDocker", err)
	}
}

func TestBuildOneAtATimePerRepository(t *testing.T) {
	b := fakeBuilder(t)
	t.Setenv("FAKE_DOCKER_WAIT", "1")
	dir := repoDir(t)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	started := make(chan struct{}, 1)
	go func() {
		done <- b.Build(ctx, goodSpec(dir), func(l string) {
			if strings.HasPrefix(l, "ARGS:") {
				select {
				case started <- struct{}{}:
				default:
				}
			}
		})
	}()
	select {
	case <-started:
	case <-time.After(15 * time.Second):
		t.Fatal("the first build never started")
	}

	if err := b.Build(context.Background(), goodSpec(dir), func(string) {}); !errors.Is(err, ErrBusy) {
		t.Errorf("a second build of the same repository = %v, want ErrBusy", err)
	}
	other := goodSpec(dir)
	other.Repository = "acme/other"
	if !b.acquire(other.Repository) {
		t.Error("a different repository should be free")
	}
	b.release(other.Repository)

	cancel()
	select {
	case err := <-done:
		if err == nil || !strings.Contains(err.Error(), "stopped") {
			t.Errorf("a cancelled build = %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("cancelling didn't stop the build")
	}
	if !b.acquire(goodSpec(dir).Repository) {
		t.Error("the repository should be free again after the build ends")
	}
}

func TestBuildTimeout(t *testing.T) {
	b := fakeBuilder(t)
	b.Timeout = 300 * time.Millisecond
	t.Setenv("FAKE_DOCKER_WAIT", "1")
	err := b.Build(context.Background(), goodSpec(repoDir(t)), func(string) {})
	if err == nil || !strings.Contains(err.Error(), "was stopped") {
		t.Errorf("Build = %v, want a timeout message", err)
	}
}

func TestExplain(t *testing.T) {
	if got := explain(nil, 7); !strings.Contains(got, "code 7") {
		t.Errorf("explain = %q", got)
	}
}

// ----- history -----

func historyDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "h.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	raw, err := os.ReadFile("../store/migrations/0003_image_builds.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(string(raw)); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestHistory(t *testing.T) {
	h := &History{DB: historyDB(t)}
	for i, b := range []Build{
		{Workspace: "demo", Repo: "api", Image: "api", Repository: "acme/api", Tag: "1.0.1", OK: true, Account: "work", Seconds: 12.5},
		{Workspace: "demo", Repo: "api", Image: "api", Repository: "acme/api", Tag: "1.0.2", OK: false, Error: "denied", Dirty: true, Revision: "abc"},
		{Workspace: "demo", Repo: "web", Image: "web", Repository: "acme/web", Tag: "2.0", OK: true},
	} {
		b.At = time.Date(2026, 10, 30, 9, i, 0, 0, time.UTC)
		if err := h.Add(b); err != nil {
			t.Fatal(err)
		}
	}
	list, err := h.List(10)
	if err != nil || len(list) != 3 || list[0].Tag != "2.0" || list[2].Tag != "1.0.1" {
		t.Fatalf("List = %+v %v", list, err)
	}
	if list[1].OK || !list[1].Dirty || list[1].Error != "denied" || list[1].Revision != "abc" || list[2].Seconds != 12.5 || list[2].Account != "work" {
		t.Errorf("fields didn't round trip: %+v", list)
	}
	if got, _ := h.List(1); len(got) != 1 || got[0].Tag != "2.0" {
		t.Errorf("limit: %+v", got)
	}
	newest, err := h.Newest()
	if err != nil || newest["demo/api/api"].Tag != "1.0.2" || newest["demo/web/web"].Tag != "2.0" || len(newest) != 2 {
		t.Errorf("Newest = %+v %v", newest, err)
	}
	if err := h.Clear(); err != nil {
		t.Fatal(err)
	}
	if got, _ := h.List(10); len(got) != 0 {
		t.Error("Clear left builds")
	}
}

func TestHistoryKeepsTheNewest(t *testing.T) {
	h := &History{DB: historyDB(t)}
	for i := 0; i < maxBuilds+20; i++ {
		if err := h.Add(Build{Workspace: "w", Repo: "r", Image: "i", Repository: "a/b", Tag: "t", OK: true}); err != nil {
			t.Fatal(err)
		}
	}
	if got, _ := h.List(maxBuilds + 50); len(got) != maxBuilds {
		t.Errorf("%d builds kept, want %d", len(got), maxBuilds)
	}
}

func TestNilHistoryKeepsNothingAndFailsNothing(t *testing.T) {
	var h *History
	if h.Add(Build{}) != nil || h.Clear() != nil {
		t.Error("a nil history should do nothing")
	}
	if got, err := h.List(5); err != nil || len(got) != 0 || got == nil {
		t.Errorf("List = %v %v", got, err)
	}
	if got, err := (&History{}).Newest(); err != nil || len(got) != 0 {
		t.Errorf("Newest = %v %v", got, err)
	}
}
