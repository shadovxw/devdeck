package api

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/rs/zerolog"

	"github.com/shadovxw/devdeck/internal/dockerx"
	"github.com/shadovxw/devdeck/internal/events"
	"github.com/shadovxw/devdeck/internal/secrets"
	"github.com/shadovxw/devdeck/internal/store"
	"github.com/shadovxw/devdeck/internal/workspace"
	"github.com/shadovxw/devdeck/sdk"
)

// keyring is an in-memory keychain.
type keyring struct {
	mu sync.Mutex
	m  map[string]string
}

func (k *keyring) Get(name string) (secrets.Value, error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	v, ok := k.m[name]
	if !ok {
		return secrets.Value{}, fmt.Errorf("%s: %w", name, secrets.ErrNotFound)
	}
	return secrets.NewValue(v), nil
}

func (k *keyring) Set(name string, v secrets.Value) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.m[name] = v.Reveal()
	return nil
}

func (k *keyring) Delete(name string) error {
	k.mu.Lock()
	defer k.mu.Unlock()
	delete(k.m, name)
	return nil
}

// fakeDockerScript writes a program that stands in for docker: it prints how it was called
// and the first build secret, and fails when FAKE_FAIL is set.
func fakeDockerScript(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if runtime.GOOS == "windows" {
		p := filepath.Join(dir, "docker.cmd")
		body := "@echo off\r\necho building %*\r\necho value %DEVDECK_BUILD_SECRET_0%\r\nif \"%FAKE_FAIL%\"==\"1\" (echo denied: requested access to the resource is denied 1>&2 & exit /b 1)\r\nexit /b 0\r\n"
		if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	p := filepath.Join(dir, "docker")
	body := "#!/bin/sh\necho \"building $*\"\necho \"value $DEVDECK_BUILD_SECRET_0\"\nif [ \"$FAKE_FAIL\" = 1 ]; then echo 'denied: requested access to the resource is denied' >&2; exit 1; fi\nexit 0\n"
	if err := os.WriteFile(p, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return p
}

type dockerEnv struct {
	h       http.Handler
	svc     *dockerx.Service
	keys    *keyring
	workDir string // the folder that holds the repositories
}

// dockerServer is a server with a workspace "demo" (repos api, web and ghost, the last not on
// this machine), Docker accounts in an in-memory keychain, a fake Docker Hub and a fake docker.
func dockerServer(t *testing.T) *dockerEnv {
	t.Helper()
	dir := t.TempDir()
	work := filepath.Join(dir, "code")
	for _, r := range []string{"api", "web"} {
		if err := os.MkdirAll(filepath.Join(work, r), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(work, r, "Dockerfile"), []byte("FROM scratch\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	hub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v2/users/login":
			var in map[string]string
			_ = json.NewDecoder(r.Body).Decode(&in)
			if in["password"] == "dckr_pat_revoked_value" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`{"token":"jwt"}`))
		case strings.HasPrefix(r.URL.Path, "/v2/user/orgs"):
			_, _ = w.Write([]byte(`{"results":[{"orgname":"acme"}]}`))
		case r.URL.Path == "/v2/repositories/acme/demo-api/tags/1.0/":
			_, _ = w.Write([]byte(`{"name":"1.0"}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(hub.Close)

	db, err := store.Open(context.Background(), filepath.Join(dir, "state.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	keys := &keyring{m: map[string]string{}}
	self, _ := os.Executable()
	svc := &dockerx.Service{
		Store:   dockerx.Store{Path: filepath.Join(dir, "docker-accounts.yaml")},
		Secrets: keys,
		Hub:     &dockerx.Hub{Base: hub.URL},
		Builder: &dockerx.Builder{Docker: fakeDockerScript(t), TempDir: dir, UserConfig: filepath.Join(dir, "nodocker"), Executable: func() (string, error) { return self, nil }},
		History: &dockerx.History{DB: db.DB},
	}

	m := &workspace.Manager{Dir: filepath.Join(dir, "workspaces"), ExamplesDir: "../../examples/workspaces"}
	yaml := fmt.Sprintf(`version: 1
name: demo
root: %s
repos:
  - id: api
    path: api
    images:
      - id: api
        repository: acme/demo-api
        secrets:
          - id: npm_token
            from: keyring
            name: npm-token
      - id: worker
        repository: other/demo-worker
  - id: web
    path: web
    images:
      - id: web
        repository: acme/demo-web
  - id: ghost
    path: ghost
    images:
      - id: ghost
        repository: acme/demo-ghost
        secrets:
          - id: gh_token
            from: github
`, filepath.ToSlash(work))
	if _, issues, err := m.Create(yaml); err != nil {
		t.Fatalf("Create: %v %v", err, issues)
	}

	guard, err := NewGuard("127.0.0.1:7070", nil)
	if err != nil {
		t.Fatal(err)
	}
	bus := events.NewBus()
	e := echo.New()
	Register(e, Deps{
		Version: "test", Bus: bus, Guard: guard, Hub: NewHub(bus, guard.OriginHosts(), zerolog.Nop()),
		Plugins: sdk.NewRegistry(), Workspaces: m, Docker: svc, Claude: NewClaude(db.DB, filepath.Join(dir, "claude-access.yaml")),
	})
	return &dockerEnv{h: e, svc: svc, keys: keys, workDir: work}
}

func (d *dockerEnv) call(method, path, body string) *httptest.ResponseRecorder {
	return callAPI(d.h, method, path, body, nil)
}

// addAccount saves an account and its token through the API.
func (d *dockerEnv) addAccount(t *testing.T, id, user, token string, namespaces ...string) {
	t.Helper()
	ns, _ := json.Marshal(namespaces)
	if rec := d.call(http.MethodPut, "/api/v1/docker/accounts/"+id, fmt.Sprintf(`{"username":%q,"namespaces":%s}`, user, ns)); rec.Code != http.StatusOK {
		t.Fatalf("PUT account = %d: %s", rec.Code, rec.Body)
	}
	if token != "" {
		if rec := d.call(http.MethodPut, "/api/v1/docker/accounts/"+id+"/token", fmt.Sprintf(`{"token":%q}`, token)); rec.Code != http.StatusNoContent {
			t.Fatalf("PUT token = %d: %s", rec.Code, rec.Body)
		}
	}
}

type buildResult struct {
	lines []string
	done  map[string]any
}

// build runs a build and reads the stream. A refusal comes back as the recorder alone.
func (d *dockerEnv) build(ws, repo, image, body string) (*httptest.ResponseRecorder, buildResult) {
	rec := d.call(http.MethodPost, fmt.Sprintf("/api/v1/images/%s/%s/%s/build", ws, repo, image), body)
	var res buildResult
	if rec.Code != http.StatusOK {
		return rec, res
	}
	sc := bufio.NewScanner(rec.Body)
	for sc.Scan() {
		var v map[string]any
		if json.Unmarshal(sc.Bytes(), &v) != nil {
			continue
		}
		if v["done"] == true {
			res.done = v
		} else if l, ok := v["line"].(string); ok {
			res.lines = append(res.lines, l)
		}
	}
	return rec, res
}

func TestDockerAccountsAndTokens(t *testing.T) {
	d := dockerServer(t)

	var o dockerx.Overview
	rec := d.call(http.MethodGet, "/api/v1/docker", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &o) != nil || len(o.Accounts) != 0 {
		t.Fatalf("empty: %d %s", rec.Code, rec.Body)
	}

	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	rec = d.call(http.MethodGet, "/api/v1/docker", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &o)
	if len(o.Accounts) != 1 || !o.Accounts[0].TokenSet || o.Accounts[0].Namespaces[0] != "acme" || o.Accounts[0].Registry != "docker.io" {
		t.Errorf("accounts = %+v", o.Accounts)
	}
	if strings.Contains(rec.Body.String(), "dckr_pat_fake_value") {
		t.Errorf("the token is in the answer: %s", rec.Body)
	}

	for name, tc := range map[string]struct{ method, path, body string }{
		"a bad id":        {http.MethodPut, "/api/v1/docker/accounts/Bad", `{"username":"x1"}`},
		"a bad username":  {http.MethodPut, "/api/v1/docker/accounts/ok", `{"username":"A B"}`},
		"a bad namespace": {http.MethodPut, "/api/v1/docker/accounts/ok", `{"username":"abc","namespaces":["A"]}`},
		"a short token":   {http.MethodPut, "/api/v1/docker/accounts/work/token", `{"token":"x"}`},
	} {
		if rec := d.call(tc.method, tc.path, tc.body); rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("%s = %d, want 422: %s", name, rec.Code, rec.Body)
		}
	}
	if rec := d.call(http.MethodPut, "/api/v1/docker/accounts/work", `{`); rec.Code != http.StatusBadRequest {
		t.Errorf("not JSON = %d, want 400", rec.Code)
	}
	if rec := d.call(http.MethodPut, "/api/v1/docker/accounts/ghost/token", `{"token":"dckr_pat_fake_value"}`); rec.Code != http.StatusNotFound {
		t.Errorf("a token for no account = %d, want 404", rec.Code)
	}

	// check: who it is, and what it can use
	rec = d.call(http.MethodPost, "/api/v1/docker/accounts/work/check", "")
	var res dockerx.CheckResult
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &res) != nil || res.Username != "ana-work" || strings.Join(res.Namespaces, ",") != "ana-work,acme" {
		t.Errorf("check = %d %s", rec.Code, rec.Body)
	}
	d.addAccount(t, "revoked", "bob", "dckr_pat_revoked_value")
	if rec := d.call(http.MethodPost, "/api/v1/docker/accounts/revoked/check", ""); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "refused") {
		t.Errorf("a refused token = %d %s, want 502 saying so", rec.Code, rec.Body)
	}
	d.addAccount(t, "notoken", "carol", "")
	if rec := d.call(http.MethodPost, "/api/v1/docker/accounts/notoken/check", ""); rec.Code != http.StatusConflict {
		t.Errorf("check without a token = %d, want 409", rec.Code)
	}
	if rec := d.call(http.MethodPost, "/api/v1/docker/accounts/ghost/check", ""); rec.Code != http.StatusNotFound {
		t.Errorf("check(ghost) = %d, want 404", rec.Code)
	}

	if rec := d.call(http.MethodDelete, "/api/v1/docker/accounts/work/token", ""); rec.Code != http.StatusNoContent {
		t.Errorf("DELETE token = %d", rec.Code)
	}
	if rec := d.call(http.MethodDelete, "/api/v1/docker/accounts/work", ""); rec.Code != http.StatusNoContent {
		t.Errorf("DELETE account = %d", rec.Code)
	}
	if rec := d.call(http.MethodDelete, "/api/v1/docker/accounts/work", ""); rec.Code != http.StatusNotFound {
		t.Errorf("DELETE again = %d, want 404", rec.Code)
	}
}

func TestDockerBuildSecrets(t *testing.T) {
	d := dockerServer(t)
	if rec := d.call(http.MethodPut, "/api/v1/docker/secrets/BadName", `{"value":"some-secret-value"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a bad name = %d, want 422", rec.Code)
	}
	if rec := d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"x"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("a short value = %d, want 422", rec.Code)
	}
	if rec := d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"npm_fake_value_1"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("PUT = %d: %s", rec.Code, rec.Body)
	}
	rec := d.call(http.MethodGet, "/api/v1/docker", "")
	if !strings.Contains(rec.Body.String(), `"name":"npm-token","value_set":true`) || strings.Contains(rec.Body.String(), "npm_fake") {
		t.Errorf("the secret shows by name only: %s", rec.Body)
	}
	if rec := d.call(http.MethodDelete, "/api/v1/docker/secrets/npm-token", ""); rec.Code != http.StatusNoContent {
		t.Errorf("DELETE = %d", rec.Code)
	}
	if rec := d.call(http.MethodDelete, "/api/v1/docker/secrets/npm-token", ""); rec.Code != http.StatusNotFound {
		t.Errorf("DELETE again = %d, want 404", rec.Code)
	}
}

func TestImagesList(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")

	var rows []imageRow
	rec := d.call(http.MethodGet, "/api/v1/images", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &rows) != nil || len(rows) != 4 {
		t.Fatalf("images = %d %s", rec.Code, rec.Body)
	}
	by := map[string]imageRow{}
	for _, r := range rows {
		by[r.Image] = r
	}

	api := by["api"]
	if api.Repository != "acme/demo-api" || api.Account != "work" || api.Problem != "" || api.Dockerfile != "Dockerfile" || api.Context != "." || api.Platforms[0] != "linux/amd64" || api.FolderMissing {
		t.Errorf("api = %+v", api)
	}
	if len(api.Secrets) != 1 || api.Secrets[0].Name != "npm-token" || !strings.Contains(api.Secrets[0].Problem, "no value is saved") {
		t.Errorf("a keyring secret that isn't saved should say so: %+v", api.Secrets)
	}
	if w := by["worker"]; w.Account != "" || !strings.Contains(w.Problem, `owns the namespace "other"`) {
		t.Errorf("worker = %+v: no account owns its namespace", w)
	}
	if g := by["ghost"]; !g.FolderMissing {
		t.Errorf("ghost = %+v: its folder isn't on this machine", g)
	}

	d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"npm_fake_value_1"}`)
	rec = d.call(http.MethodGet, "/api/v1/images", "")
	rows = nil
	_ = json.Unmarshal(rec.Body.Bytes(), &rows)
	for _, r := range rows {
		if r.Image == "api" && r.Secrets[0].Problem != "" {
			t.Errorf("once saved, the secret has no problem: %+v", r.Secrets)
		}
	}

	// the sample workspace has images too, but is never listed: its folders aren't real
	for _, r := range rows {
		if r.Workspace == "acme-shop" {
			t.Error("a sample workspace's images were listed")
		}
	}
}

func TestBuildAndPush(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"npm_fake_value_1"}`)

	rec, res := d.build("demo", "api", "api", `{"tag":"1.0.1"}`)
	if rec.Code != http.StatusOK || res.done == nil || res.done["ok"] != true {
		t.Fatalf("build = %d, done %v, lines %v", rec.Code, res.done, res.lines)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/x-ndjson" {
		t.Errorf("Content-Type = %q", ct)
	}
	out := strings.Join(res.lines, "\n")
	for _, want := range []string{"-t acme/demo-api:1.0.1", "--secret id=npm_token,env=DEVDECK_BUILD_SECRET_0", "--push", "value ***"} {
		if !strings.Contains(out, want) {
			t.Errorf("the output is missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "npm_fake_value_1") || strings.Contains(rec.Body.String(), "dckr_pat_fake_value") {
		t.Errorf("a secret reached the page:\n%s", rec.Body)
	}

	// the history has it, and the images list shows it as the last build
	var hist []dockerx.Build
	_ = json.Unmarshal(d.call(http.MethodGet, "/api/v1/images/builds", "").Body.Bytes(), &hist)
	if len(hist) != 1 || hist[0].Tag != "1.0.1" || !hist[0].OK || hist[0].Account != "work" || hist[0].Repository != "acme/demo-api" || hist[0].Image != "api" {
		t.Errorf("history = %+v", hist)
	}
	var rows []imageRow
	_ = json.Unmarshal(d.call(http.MethodGet, "/api/v1/images", "").Body.Bytes(), &rows)
	for _, r := range rows {
		if r.Image == "api" && (r.Last == nil || r.Last.Tag != "1.0.1") {
			t.Errorf("the last build should show: %+v", r.Last)
		}
	}

	if rec := d.call(http.MethodDelete, "/api/v1/images/builds", ""); rec.Code != http.StatusNoContent {
		t.Errorf("clear history = %d", rec.Code)
	}
	if rec := d.call(http.MethodGet, "/api/v1/images/builds?limit=0", ""); rec.Code != http.StatusBadRequest {
		t.Errorf("limit=0 = %d, want 400", rec.Code)
	}
}

func TestBuildRefusesAnExistingTagUnlessTold(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"npm_fake_value_1"}`)

	rec, _ := d.build("demo", "api", "api", `{"tag":"1.0"}`)
	var v map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &v)
	if rec.Code != http.StatusConflict || v["exists"] != true || !strings.Contains(v["message"].(string), "acme/demo-api:1.0 already exists") {
		t.Fatalf("an existing tag = %d %s", rec.Code, rec.Body)
	}
	if hist, _ := d.svc.History.List(5); len(hist) != 0 {
		t.Error("a refused build was noted in the history")
	}
	rec, res := d.build("demo", "api", "api", `{"tag":"1.0","overwrite":true}`)
	if rec.Code != http.StatusOK || res.done["ok"] != true {
		t.Errorf("overwrite = %d %v", rec.Code, res.done)
	}
}

func TestBuildPushesAnywayWhenDockerHubCantBeAsked(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	d.call(http.MethodPut, "/api/v1/docker/secrets/npm-token", `{"value":"npm_fake_value_1"}`)
	d.svc.Hub = &dockerx.Hub{Base: "http://127.0.0.1:1"} // nothing there

	_, res := d.build("demo", "api", "api", `{"tag":"2.0"}`)
	if res.done["ok"] != true || len(res.lines) == 0 || !strings.Contains(res.lines[0], "couldn't check whether the tag already exists") {
		t.Errorf("the page should be told the check was skipped: %v %v", res.lines, res.done)
	}
}

func TestBuildFailureIsReportedAndNoted(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	t.Setenv("FAKE_FAIL", "1")

	rec, res := d.build("demo", "web", "web", `{"tag":"3.0"}`)
	if rec.Code != http.StatusOK || res.done["ok"] != false || !strings.Contains(res.done["error"].(string), "can't write to this repository") {
		t.Fatalf("a failed push = %d %v", rec.Code, res.done)
	}
	hist, _ := d.svc.History.List(5)
	if len(hist) != 1 || hist[0].OK || !strings.Contains(hist[0].Error, "can't write") {
		t.Errorf("history = %+v", hist)
	}
}

func TestBuildRefusals(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")

	tests := []struct {
		name, ws, repo, image, body string
		want                        int
		msg                         string
	}{
		{"a tag with a colon", "demo", "web", "web", `{"tag":"1.0:x"}`, http.StatusBadRequest, "the tag can have"},
		{"no tag", "demo", "web", "web", `{}`, http.StatusBadRequest, "the tag can have"},
		{"not JSON", "demo", "web", "web", `{`, http.StatusBadRequest, ""},
		{"an unknown workspace", "ghost", "web", "web", `{"tag":"1"}`, http.StatusNotFound, "no such workspace"},
		{"an unknown repository", "demo", "nope", "web", `{"tag":"1"}`, http.StatusNotFound, "no such repository"},
		{"an unknown image", "demo", "web", "nope", `{"tag":"1"}`, http.StatusNotFound, "no such image"},
		{"a sample workspace", "acme-shop", "api", "api", `{"tag":"1"}`, http.StatusForbidden, "sample workspace"},
		{"no account owns it", "demo", "api", "worker", `{"tag":"1"}`, http.StatusConflict, "add one on the Docker Hub page"},
		{"a keyring secret nobody saved", "demo", "api", "api", `{"tag":"1"}`, http.StatusConflict, "no value saved"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			rec, _ := d.build(tc.ws, tc.repo, tc.image, tc.body)
			if rec.Code != tc.want || !strings.Contains(rec.Body.String(), tc.msg) {
				t.Errorf("= %d %s, want %d containing %q", rec.Code, rec.Body, tc.want, tc.msg)
			}
		})
	}
	if hist, _ := d.svc.History.List(5); len(hist) != 0 {
		t.Errorf("refusals were noted as builds: %+v", hist)
	}
}

func TestBuildAmbiguousNamespace(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	d.addAccount(t, "other", "bob", "dckr_pat_other_value", "acme")
	rec, _ := d.build("demo", "web", "web", `{"tag":"1"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "several Docker accounts own the namespace") || !strings.Contains(rec.Body.String(), "work, other") {
		t.Errorf("= %d %s", rec.Code, rec.Body)
	}
}

func TestBuildNeedsTheRightAccount(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "", "acme") // no token yet
	rec, _ := d.build("demo", "web", "web", `{"tag":"1"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "no token is saved") {
		t.Errorf("= %d %s", rec.Code, rec.Body)
	}
}

func TestBuildGitHubSecretNeedsAnAccountRule(t *testing.T) {
	d := dockerServer(t)
	d.addAccount(t, "work", "ana-work", "dckr_pat_fake_value", "acme")
	// ghost's folder isn't on this machine, and there are no git accounts in this server
	rec, _ := d.build("demo", "ghost", "ghost", `{"tag":"1","overwrite":true}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "gh_token") || !strings.Contains(rec.Body.String(), "GitHub accounts aren't available") {
		t.Errorf("= %d %s", rec.Code, rec.Body)
	}
}

func TestConnectorCantUseDockerRoutes(t *testing.T) {
	d := dockerServer(t)
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/v1/docker", ""},
		{http.MethodPut, "/api/v1/docker/accounts/x1", `{"username":"abc"}`},
		{http.MethodGet, "/api/v1/images", ""},
		{http.MethodPost, "/api/v1/images/demo/web/web/build", `{"tag":"1"}`},
	} {
		if rec := callAPI(d.h, tc.method, tc.path, tc.body, asClaude); rec.Code != http.StatusForbidden {
			t.Errorf("%s %s as Claude = %d, want 403", tc.method, tc.path, rec.Code)
		}
	}
}

func TestEditAWorkspace(t *testing.T) {
	d := dockerServer(t)
	var file struct {
		YAML string `json:"yaml"`
	}
	rec := d.call(http.MethodGet, "/api/v1/workspaces/demo/file", "")
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &file) != nil || !strings.Contains(file.YAML, "name: demo") {
		t.Fatalf("GET file = %d %s", rec.Code, rec.Body)
	}
	if rec := d.call(http.MethodGet, "/api/v1/workspaces/ghost/file", ""); rec.Code != http.StatusNotFound {
		t.Errorf("file of no workspace = %d, want 404", rec.Code)
	}

	put := func(id, yaml string) *httptest.ResponseRecorder {
		b, _ := json.Marshal(map[string]string{"yaml": yaml})
		return d.call(http.MethodPut, "/api/v1/workspaces/"+id, string(b))
	}
	edited := strings.Replace(file.YAML, "repository: acme/demo-web", "repository: acme/demo-web2", 1)
	if rec := put("demo", edited); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"id":"demo"`) {
		t.Fatalf("PUT = %d %s", rec.Code, rec.Body)
	}
	rec = d.call(http.MethodGet, "/api/v1/workspaces/demo/file", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &file)
	if !strings.Contains(file.YAML, "acme/demo-web2") {
		t.Errorf("the edit wasn't saved: %s", file.YAML)
	}

	if rec := put("demo", "version: 1\nname: demo\nroot: ~/x\nrepos: nope\n"); rec.Code != http.StatusUnprocessableEntity || !strings.Contains(rec.Body.String(), `"issues"`) {
		t.Errorf("invalid = %d %s, want 422 with issues", rec.Code, rec.Body)
	}
	if rec := put("demo", strings.Replace(file.YAML, "name: demo", "name: renamed", 1)); rec.Code != http.StatusConflict {
		t.Errorf("a rename = %d, want 409", rec.Code)
	}
	if rec := put("acme-shop", file.YAML); rec.Code != http.StatusForbidden {
		t.Errorf("a sample = %d, want 403", rec.Code)
	}
	if rec := put("ghost", file.YAML); rec.Code != http.StatusNotFound {
		t.Errorf("unknown = %d, want 404", rec.Code)
	}
	if rec := d.call(http.MethodPut, "/api/v1/workspaces/demo", `{`); rec.Code != http.StatusBadRequest {
		t.Errorf("not JSON = %d, want 400", rec.Code)
	}
}
