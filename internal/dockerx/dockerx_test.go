package dockerx

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/shadovxw/devdeck/internal/secrets"
)

// TestMain lets the test program stand in for docker: when DEVDECK_FAKE_DOCKER is set it
// behaves as `docker buildx build ...` would, so a build can be run without Docker.
func TestMain(m *testing.M) {
	if os.Getenv("DEVDECK_FAKE_DOCKER") == "1" {
		fakeDocker()
		return
	}
	os.Exit(m.Run())
}

func fakeDocker() {
	fmt.Println("ARGS:" + strings.Join(os.Args[1:], " "))
	cfg := os.Getenv("DOCKER_CONFIG")
	raw, _ := os.ReadFile(filepath.Join(cfg, "config.json"))
	fmt.Println("CONFIG:" + string(raw))
	name := HelperName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	_, err := os.Stat(filepath.Join(cfg, "bin", name))
	fmt.Println("HELPER:", err == nil)
	fmt.Println("PATHFIRST:" + strings.Split(os.Getenv("PATH"), string(filepath.ListSeparator))[0])
	fmt.Println("CONFIGDIR:" + cfg)
	fmt.Println("ACCOUNT:" + os.Getenv(EnvAccount) + "/" + os.Getenv(EnvUsername))
	for _, e := range os.Environ() {
		if strings.HasPrefix(e, "DEVDECK_BUILD_SECRET_") {
			fmt.Println("ENVVAR:" + e) // a real docker would hand it to BuildKit, not print it
		}
	}
	if os.Getenv("FAKE_DOCKER_WAIT") != "" {
		time.Sleep(10 * time.Second)
	}
	if say := os.Getenv("FAKE_DOCKER_SAY"); say != "" {
		fmt.Fprintln(os.Stderr, say)
	}
	if os.Getenv("FAKE_DOCKER_EXIT") != "" {
		os.Exit(1)
	}
	os.Exit(0)
}

// memSecrets is an in-memory keyring.
type memSecrets struct {
	mu sync.Mutex
	m  map[string]string
}

func newMem(kv ...string) *memSecrets {
	s := &memSecrets{m: map[string]string{}}
	for i := 0; i+1 < len(kv); i += 2 {
		s.m[kv[i]] = kv[i+1]
	}
	return s
}

func (s *memSecrets) Get(name string) (secrets.Value, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[name]
	if !ok {
		return secrets.Value{}, fmt.Errorf("%s: %w", name, secrets.ErrNotFound)
	}
	return secrets.NewValue(v), nil
}

func (s *memSecrets) Set(name string, v secrets.Value) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[name] = v.Reveal()
	return nil
}

func (s *memSecrets) Delete(name string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, name)
	return nil
}

func (s *memSecrets) has(name string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.m[name]
	return ok
}

// ----- accounts -----

func TestAccountChecks(t *testing.T) {
	ok := Account{ID: "acme-bot", Username: "acme", Namespaces: []string{"acme-labs"}}
	if err := ok.Check(); err != nil {
		t.Fatalf("a good account: %v", err)
	}
	tests := []struct {
		name string
		edit func(*Account)
		want string
	}{
		{"bad id", func(a *Account) { a.ID = "Acme" }, "the id must be"},
		{"empty id", func(a *Account) { a.ID = "" }, "the id must be"},
		{"bad username", func(a *Account) { a.Username = "Acme Corp" }, "username"},
		{"another registry", func(a *Account) { a.Registry = "ghcr.io" }, "only docker.io"},
		{"bad namespace", func(a *Account) { a.Namespaces = []string{"ACME"} }, "isn't a Docker Hub namespace"},
		{"namespace twice", func(a *Account) { a.Namespaces = []string{"x1", "x1"} }, "listed twice"},
		{"too many namespaces", func(a *Account) {
			a.Namespaces = nil
			for i := 0; i < maxNamespaces+1; i++ {
				a.Namespaces = append(a.Namespaces, fmt.Sprintf("ns%d", i))
			}
		}, "at most"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := ok
			tc.edit(&a)
			if err := a.Check(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Check = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func TestMatchByNamespace(t *testing.T) {
	cfg := Config{Accounts: []Account{
		{ID: "me", Username: "ana"},
		{ID: "work", Username: "ana-work", Namespaces: []string{"acme", "acme-labs"}},
		{ID: "other", Username: "bob", Namespaces: []string{"acme"}},
	}}
	ids := func(as []Account) string {
		var out []string
		for _, a := range as {
			out = append(out, a.ID)
		}
		return strings.Join(out, ",")
	}
	for repo, want := range map[string]string{
		"ana/tool":      "me",
		"ana-work/x":    "work",
		"acme/api":      "work,other",
		"acme-labs/api": "work",
		"nobody/api":    "",
	} {
		if got := ids(cfg.Match(repo)); got != want {
			t.Errorf("Match(%q) = %q, want %q", repo, got, want)
		}
	}
	if Namespace("acme/api") != "acme" || Namespace("x") != "x" {
		t.Error("Namespace")
	}
	if !cfg.Accounts[1].Owns("acme-labs") || cfg.Accounts[0].Owns("acme") {
		t.Error("Owns")
	}
}

func TestConfigChecks(t *testing.T) {
	a := func(id string) Account { return Account{ID: id, Username: "user-" + id} }
	if err := (Config{Accounts: []Account{a("one"), a("two")}, BuildSecrets: []string{"gh-token", "npm_token"}}).Check(); err != nil {
		t.Errorf("a good config: %v", err)
	}
	bad := map[string]Config{
		"a duplicate id":     {Accounts: []Account{a("one"), a("one")}},
		"a bad account":      {Accounts: []Account{{ID: "x", Username: "A"}}},
		"a bad secret name":  {BuildSecrets: []string{"Bad Name"}},
		"a duplicate secret": {BuildSecrets: []string{"a1", "a1"}},
		"too many accounts":  {Accounts: manyAccounts(maxAccounts + 1)},
		"too many secrets":   {BuildSecrets: manyNames(maxBuildSecrets + 1)},
	}
	for name, c := range bad {
		if err := c.Check(); err == nil {
			t.Errorf("%s: Check passed", name)
		}
	}
}

func manyAccounts(n int) []Account {
	var out []Account
	for i := 0; i < n; i++ {
		out = append(out, Account{ID: fmt.Sprintf("a%d", i), Username: fmt.Sprintf("user%d", i)})
	}
	return out
}

func manyNames(n int) []string {
	var out []string
	for i := 0; i < n; i++ {
		out = append(out, fmt.Sprintf("s%d", i))
	}
	return out
}

func TestStore(t *testing.T) {
	dir := t.TempDir()
	st := Store{Path: filepath.Join(dir, "sub", "docker-accounts.yaml")}

	c, err := st.Load()
	if err != nil || len(c.Accounts) != 0 || c.Accounts == nil || c.BuildSecrets == nil {
		t.Fatalf("a missing file is no accounts: %+v %v", c, err)
	}

	want := Config{Accounts: []Account{{ID: "work", Username: "ana-work", Namespaces: []string{"acme"}}}, BuildSecrets: []string{"npm-token"}}
	if err := st.Save(want); err != nil {
		t.Fatal(err)
	}
	got, err := st.Load()
	if err != nil || len(got.Accounts) != 1 || got.Accounts[0].Username != "ana-work" || got.Accounts[0].Namespaces[0] != "acme" || got.BuildSecrets[0] != "npm-token" {
		t.Fatalf("round trip: %+v %v", got, err)
	}
	raw, _ := os.ReadFile(st.Path)
	if !strings.Contains(string(raw), "never here") {
		t.Errorf("the file should say tokens aren't in it: %s", raw)
	}
	if entries, _ := os.ReadDir(filepath.Dir(st.Path)); len(entries) != 1 {
		t.Errorf("only the accounts file should be there, got %d entries", len(entries))
	}

	if err := st.Save(Config{Accounts: []Account{{ID: "BAD", Username: "x"}}}); err == nil {
		t.Error("an invalid config was saved")
	}
	if after, _ := os.ReadFile(st.Path); string(after) != string(raw) {
		t.Error("a refused save changed the file")
	}

	for name, body := range map[string]string{
		"an unknown field": "accounts: []\ntoken: abc\n",
		"not YAML":         "accounts: [",
		"an invalid entry": "accounts:\n  - id: X\n    username: y\n",
	} {
		if err := os.WriteFile(st.Path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := st.Load(); err == nil {
			t.Errorf("%s: Load passed", name)
		}
	}
	if err := os.WriteFile(st.Path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if c, err := st.Load(); err != nil || len(c.Accounts) != 0 {
		t.Errorf("an empty file is no accounts: %+v %v", c, err)
	}
}

// ----- Docker Hub -----

func hubServer(t *testing.T, h http.HandlerFunc) (*Hub, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	return &Hub{Base: srv.URL}, srv
}

func TestHubLogin(t *testing.T) {
	var got map[string]string
	hub, _ := hubServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/users/login" || r.Method != http.MethodPost {
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		if got["password"] != "good-token-123" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"token":"jwt-abc"}`))
	})
	jwt, err := hub.Login(context.Background(), "ana", "good-token-123")
	if err != nil || jwt != "jwt-abc" || got["username"] != "ana" {
		t.Errorf("Login = %q, %v (sent %v)", jwt, err, got)
	}
	if _, err := hub.Login(context.Background(), "ana", "wrong"); !errors.Is(err, ErrRefused) {
		t.Errorf("a refused token: %v, want ErrRefused", err)
	}
}

func TestHubLoginOtherFailures(t *testing.T) {
	for name, h := range map[string]http.HandlerFunc{
		"a server error":     func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
		"no token in answer": func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{}`)) },
		"not JSON":           func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`<html>`)) },
	} {
		hub, _ := hubServer(t, h)
		if _, err := hub.Login(context.Background(), "ana", "tok-12345"); err == nil || errors.Is(err, ErrRefused) {
			t.Errorf("%s: err = %v, want a failure that isn't a refusal", name, err)
		}
	}
	hub, srv := hubServer(t, func(http.ResponseWriter, *http.Request) {})
	srv.Close()
	if _, err := hub.Login(context.Background(), "ana", "tok-12345"); err == nil || !strings.Contains(err.Error(), "can't reach Docker Hub") {
		t.Errorf("an unreachable Hub: %v", err)
	}
}

func TestHubNamespaces(t *testing.T) {
	hub, _ := hubServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "JWT jwt-abc" {
			t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
		}
		_, _ = w.Write([]byte(`{"results":[{"orgname":"acme"},{"orgname":"Bad Org"},{"orgname":"acme-labs"}]}`))
	})
	got := hub.Namespaces(context.Background(), "jwt-abc", "ana")
	if strings.Join(got, ",") != "ana,acme,acme-labs" {
		t.Errorf("Namespaces = %v", got)
	}
	failing, _ := hubServer(t, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) })
	if got := failing.Namespaces(context.Background(), "jwt", "ana"); len(got) != 1 || got[0] != "ana" {
		t.Errorf("when Docker Hub won't say, only the username: %v", got)
	}
}

func TestHubTagExists(t *testing.T) {
	hub, _ := hubServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v2/repositories/acme/api/tags/1.0.0/":
			_, _ = w.Write([]byte(`{"name":"1.0.0"}`))
		case "/v2/repositories/acme/api/tags/2.0.0/":
			w.WriteHeader(http.StatusNotFound)
		default:
			w.WriteHeader(http.StatusBadGateway)
		}
	})
	ctx := context.Background()
	if ok, err := hub.TagExists(ctx, "j", "acme/api", "1.0.0"); !ok || err != nil {
		t.Errorf("an existing tag: %v %v", ok, err)
	}
	if ok, err := hub.TagExists(ctx, "j", "acme/api", "2.0.0"); ok || err != nil {
		t.Errorf("a new tag: %v %v", ok, err)
	}
	if _, err := hub.TagExists(ctx, "j", "acme/api", "3.0.0"); err == nil {
		t.Error("a bad gateway should be an error, not 'no such tag'")
	}
	if _, err := hub.TagExists(ctx, "j", "../etc", "1"); err == nil {
		t.Error("a bad repository was sent to Docker Hub")
	}
}

// ----- the credential helper -----

func TestCredentialHelper(t *testing.T) {
	sec := newMem(SecretName("work"), "dckr_pat_fake_value")
	env := map[string]string{EnvAccount: "work", EnvUsername: "ana-work"}
	getenv := func(k string) string { return env[k] }
	run := func(args []string, in string) (int, string) {
		var out bytes.Buffer
		code := CredentialCommand(args, strings.NewReader(in), &out, getenv, sec)
		return code, out.String()
	}

	for _, server := range []string{"https://index.docker.io/v1/", "index.docker.io", "docker.io", "registry-1.docker.io"} {
		code, out := run([]string{"get"}, server+"\n")
		var v map[string]string
		if code != 0 || json.Unmarshal([]byte(out), &v) != nil || v["Username"] != "ana-work" || v["Secret"] != "dckr_pat_fake_value" || v["ServerURL"] != server {
			t.Errorf("get %s = %d %q", server, code, out)
		}
	}
	for _, server := range []string{"ghcr.io", "https://registry.example.com/v2/", "evil.docker.io.example.com", ""} {
		if code, out := run([]string{"get"}, server); code != 1 || out != notFound {
			t.Errorf("get %q = %d %q, want not found", server, code, out)
		}
	}
	if code, out := run([]string{"list"}, ""); code != 0 || out != "{}" {
		t.Errorf("list = %d %q", code, out)
	}
	for _, verb := range []string{"store", "erase"} {
		if code, out := run([]string{verb}, `{"ServerURL":"x","Secret":"y"}`); code != 0 || out != "" {
			t.Errorf("%s = %d %q", verb, code, out)
		}
	}
	if code, _ := run(nil, ""); code != 1 {
		t.Error("no verb should fail")
	}
	if code, _ := run([]string{"frobnicate"}, ""); code != 1 {
		t.Error("an unknown verb should fail")
	}

	// no account, or no token: not found, and docker goes without
	env[EnvAccount] = ""
	if code, out := run([]string{"get"}, "docker.io"); code != 1 || out != notFound {
		t.Errorf("without an account: %d %q", code, out)
	}
	env[EnvAccount] = "gone"
	if code, out := run([]string{"get"}, "docker.io"); code != 1 || out != notFound {
		t.Errorf("without a token: %d %q", code, out)
	}
}

// ----- the service -----

func newService(t *testing.T, sec secrets.Store) *Service {
	t.Helper()
	dir := t.TempDir()
	return &Service{Store: Store{Path: filepath.Join(dir, "docker-accounts.yaml")}, Secrets: sec, Hub: &Hub{}, Builder: &Builder{}, History: &History{}}
}

func TestServiceAccountsAndTokens(t *testing.T) {
	sec := newMem()
	s := newService(t, sec)
	if err := s.SaveAccount(Account{ID: "work", Username: "ana-work", Namespaces: []string{"acme"}}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveAccount(Account{ID: "work", Username: "ana-work2"}); err != nil { // replaces
		t.Fatal(err)
	}
	if err := s.SaveAccount(Account{ID: "BAD", Username: "x"}); err == nil {
		t.Error("a bad account was saved")
	}
	o, err := s.Overview()
	if err != nil || len(o.Accounts) != 1 || o.Accounts[0].Username != "ana-work2" || o.Accounts[0].TokenSet || o.Accounts[0].Registry != HubRegistry {
		t.Fatalf("Overview = %+v %v", o, err)
	}

	if err := s.SetToken("work", "short"); err == nil {
		t.Error("a token that is too short was saved")
	}
	if err := s.SetToken("work", "has a space in it"); err == nil {
		t.Error("a token with spaces was saved")
	}
	if err := s.SetToken("ghost", "dckr_pat_fake_value"); !errors.Is(err, ErrNoSuchAccount) {
		t.Errorf("a token for no account: %v", err)
	}
	if err := s.SetToken("work", "dckr_pat_fake_value"); err != nil {
		t.Fatal(err)
	}
	o, _ = s.Overview()
	if !o.Accounts[0].TokenSet {
		t.Error("the token should show as saved")
	}
	if b, _ := json.Marshal(o); strings.Contains(string(b), "dckr_pat") {
		t.Errorf("the token is in the overview: %s", b)
	}
	if err := s.DeleteToken("work"); err != nil || sec.has(SecretName("work")) {
		t.Errorf("DeleteToken: %v", err)
	}
	if err := s.DeleteToken("ghost"); !errors.Is(err, ErrNoSuchAccount) {
		t.Errorf("DeleteToken(ghost) = %v", err)
	}

	_ = s.SetToken("work", "dckr_pat_fake_value")
	if err := s.DeleteAccount("work"); err != nil || sec.has(SecretName("work")) {
		t.Errorf("DeleteAccount: %v (the token should go too)", err)
	}
	if err := s.DeleteAccount("work"); !errors.Is(err, ErrNoSuchAccount) {
		t.Errorf("DeleteAccount twice = %v", err)
	}
}

func TestServiceResolve(t *testing.T) {
	sec := newMem(SecretName("work"), "dckr_pat_work_value", SecretName("me"), "dckr_pat_me_value", SecretName("other"), "dckr_pat_other_value")
	s := newService(t, sec)
	for _, a := range []Account{
		{ID: "me", Username: "ana"},
		{ID: "work", Username: "ana-work", Namespaces: []string{"acme"}},
		{ID: "other", Username: "bob", Namespaces: []string{"acme"}},
		{ID: "notoken", Username: "carol"},
	} {
		if err := s.SaveAccount(a); err != nil {
			t.Fatal(err)
		}
	}
	if a, err := s.Resolve("ana/tool", ""); err != nil || a.ID != "me" {
		t.Errorf("by username: %+v %v", a, err)
	}
	if a, err := s.Resolve("acme/api", "work"); err != nil || a.ID != "work" {
		t.Errorf("named: %+v %v", a, err)
	}

	var none *NoAccountError
	if _, err := s.Resolve("nobody/api", ""); !errors.As(err, &none) || none.Namespace != "nobody" || !strings.Contains(err.Error(), "add one on the Docker Hub page") {
		t.Errorf("no account: %v", err)
	}
	var amb *AmbiguousError
	if _, err := s.Resolve("acme/api", ""); !errors.As(err, &amb) || strings.Join(amb.IDs, ",") != "work,other" || !strings.Contains(err.Error(), "account:") {
		t.Errorf("ambiguous: %v", err)
	}
	if _, err := s.Resolve("carol/x", ""); !errors.Is(err, ErrNoToken) {
		t.Errorf("no token: %v", err)
	}
	if _, err := s.Resolve("acme/api", "ghost"); err == nil || !strings.Contains(err.Error(), "isn't on this machine") {
		t.Errorf("a named account that isn't there: %v", err)
	}
}

func TestServiceBuildSecrets(t *testing.T) {
	sec := newMem()
	s := newService(t, sec)
	if err := s.SetBuildSecret("Bad Name", "some-secret-value"); err == nil {
		t.Error("a bad name was saved")
	}
	if err := s.SetBuildSecret("npm-token", "x"); err == nil {
		t.Error("a short value was saved")
	}
	if err := s.SetBuildSecret("npm-token", "npm_fake_value_1"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetBuildSecret("npm-token", "npm_fake_value_2"); err != nil { // replaces, listed once
		t.Fatal(err)
	}
	o, _ := s.Overview()
	if len(o.BuildSecrets) != 1 || o.BuildSecrets[0].Name != "npm-token" || !o.BuildSecrets[0].ValueSet {
		t.Errorf("Overview = %+v", o.BuildSecrets)
	}
	if b, _ := json.Marshal(o); strings.Contains(string(b), "npm_fake") {
		t.Errorf("a value is in the overview: %s", b)
	}
	if v, err := s.BuildSecret("npm-token"); err != nil || v.Reveal() != "npm_fake_value_2" {
		t.Errorf("BuildSecret: %v", err)
	}
	if _, err := s.BuildSecret("missing"); err == nil || !strings.Contains(err.Error(), "no value saved") {
		t.Errorf("a missing secret: %v", err)
	}
	if err := s.DeleteBuildSecret("npm-token"); err != nil || sec.has(BuildSecretName("npm-token")) {
		t.Errorf("DeleteBuildSecret: %v", err)
	}
	if err := s.DeleteBuildSecret("npm-token"); !errors.Is(err, ErrNoSuchSecret) {
		t.Errorf("twice: %v", err)
	}
}

func TestServiceCheckAndTagExists(t *testing.T) {
	sec := newMem()
	s := newService(t, sec)
	hub, _ := hubServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v2/users/login":
			_, _ = w.Write([]byte(`{"token":"jwt"}`))
		case strings.HasPrefix(r.URL.Path, "/v2/user/orgs"):
			_, _ = w.Write([]byte(`{"results":[{"orgname":"acme"}]}`))
		case r.URL.Path == "/v2/repositories/acme/api/tags/1.0/":
			_, _ = w.Write([]byte(`{}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	s.Hub = hub
	_ = s.SaveAccount(Account{ID: "work", Username: "ana-work"})

	if _, err := s.Check(context.Background(), "work"); !errors.Is(err, ErrNoToken) {
		t.Errorf("Check without a token: %v", err)
	}
	if _, err := s.Check(context.Background(), "ghost"); !errors.Is(err, ErrNoSuchAccount) {
		t.Errorf("Check(ghost): %v", err)
	}
	_ = s.SetToken("work", "dckr_pat_fake_value")
	res, err := s.Check(context.Background(), "work")
	if err != nil || res.Username != "ana-work" || strings.Join(res.Namespaces, ",") != "ana-work,acme" {
		t.Errorf("Check = %+v %v", res, err)
	}
	a := Account{ID: "work", Username: "ana-work"}
	if ok, err := s.TagExists(context.Background(), a, "acme/api", "1.0"); !ok || err != nil {
		t.Errorf("TagExists = %v %v", ok, err)
	}
	if ok, err := s.TagExists(context.Background(), a, "acme/api", "2.0"); ok || err != nil {
		t.Errorf("TagExists(new) = %v %v", ok, err)
	}
}
