package agent

import (
	"bytes"
	"context"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

const (
	aliceToken = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	bobToken   = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

func writeTokenFile(t *testing.T, dir, name, token string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, []byte(token+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTokenConfigChecks(t *testing.T) {
	base := func() Config {
		return Config{Listen: DefaultListen, Stacks: []Stack{{ID: "apps", Dir: "/srv/acme", Files: []string{"c.yml"}}}}
	}
	ok := base()
	ok.Tokens = []TokenFile{{Name: "alice", File: "/etc/devdeck/alice"}, {Name: "bob", File: "/etc/devdeck/bob"}}
	if err := ok.Validate(); err != nil {
		t.Errorf("named tokens with no token_file: %v", err)
	}
	both := ok
	both.TokenFile = "/etc/devdeck/token"
	if err := both.Validate(); err != nil {
		t.Errorf("token_file and named tokens together: %v", err)
	}

	tests := []struct {
		name string
		edit func(*Config)
		want string
	}{
		{"no token at all", func(c *Config) {}, "token_file or tokens"},
		{"a bad name", func(c *Config) { c.Tokens = []TokenFile{{Name: "Alice", File: "/x"}} }, "the name must be"},
		{"no name", func(c *Config) { c.Tokens = []TokenFile{{File: "/x"}} }, "the name must be"},
		{"the reserved name", func(c *Config) { c.Tokens = []TokenFile{{Name: "shared", File: "/x"}} }, "name of token_file"},
		{"a name twice", func(c *Config) { c.Tokens = []TokenFile{{Name: "alice", File: "/x"}, {Name: "alice", File: "/y"}} }, "used twice"},
		{"no file", func(c *Config) { c.Tokens = []TokenFile{{Name: "alice"}} }, "file is required"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := base()
			tc.edit(&c)
			if err := c.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Validate = %v, want an error containing %q", err, tc.want)
			}
		})
	}
}

func TestReadTokens(t *testing.T) {
	dir := t.TempDir()
	cfg := Config{
		TokenFile: writeTokenFile(t, dir, "shared", testToken),
		Tokens:    []TokenFile{{Name: "alice", File: writeTokenFile(t, dir, "alice", aliceToken)}, {Name: "bob", File: writeTokenFile(t, dir, "bob", bobToken)}},
	}
	got, err := ReadTokens(cfg)
	if err != nil || len(got) != 3 || got[0].Name != SharedToken || got[1].Name != "alice" || got[2].Name != "bob" || string(got[1].Value) != aliceToken {
		t.Fatalf("ReadTokens = %+v, %v", got, err)
	}

	only, err := ReadTokens(Config{Tokens: cfg.Tokens})
	if err != nil || len(only) != 2 || only[0].Name != "alice" {
		t.Errorf("named tokens alone = %+v, %v", only, err)
	}

	same := cfg
	same.Tokens = []TokenFile{{Name: "alice", File: writeTokenFile(t, dir, "alice2", testToken)}}
	if _, err := ReadTokens(same); err == nil || !strings.Contains(err.Error(), `"alice" is the same token as "shared"`) {
		t.Errorf("two names with one token: %v", err)
	}
	short := Config{Tokens: []TokenFile{{Name: "carol", File: writeTokenFile(t, dir, "carol", "short")}}}
	if _, err := ReadTokens(short); err == nil || !strings.Contains(err.Error(), `token "carol"`) || !strings.Contains(err.Error(), "too short") {
		t.Errorf("a short token names whose it is: %v", err)
	}
	if _, err := ReadTokens(Config{Tokens: []TokenFile{{Name: "dave", File: filepath.Join(dir, "none")}}}); err == nil || !strings.Contains(err.Error(), `token "dave"`) {
		t.Errorf("a missing file: %v", err)
	}
	if runtime.GOOS != "windows" {
		open := filepath.Join(dir, "open")
		if err := os.WriteFile(open, []byte(bobToken), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadTokens(Config{Tokens: []TokenFile{{Name: "erin", File: open}}}); err == nil || !strings.Contains(err.Error(), "600") {
			t.Errorf("a token anyone can read: %v", err)
		}
	}
}

func TestEachPersonSignsInWithTheirOwnToken(t *testing.T) {
	var buf bytes.Buffer
	a := New(sampleConfig(), []byte(testToken), &fakeRunner{}, zerolog.New(&buf), "1")
	a.AddTokens(Token{Name: "alice", Value: []byte(aliceToken)}, Token{Name: "bob", Value: []byte(bobToken)})
	h := a.Handler()

	for _, tok := range []string{testToken, aliceToken, bobToken} {
		if rec := request(h, http.MethodGet, "/v1/info", tok); rec.Code != http.StatusOK {
			t.Errorf("a configured token = %d", rec.Code)
		}
	}
	for _, tok := range []string{"", strings.Repeat("c", 64), aliceToken[:63], aliceToken + "x"} {
		if rec := request(h, http.MethodGet, "/v1/info", tok); rec.Code != http.StatusUnauthorized {
			t.Errorf("token %q = %d, want 401", tok, rec.Code)
		}
	}

	// the audit line says whose token it was, and never the token
	log := buf.String()
	for _, want := range []string{`"by":"shared"`, `"by":"alice"`, `"by":"bob"`, `"by":""`} {
		if !strings.Contains(log, want) {
			t.Errorf("the audit log is missing %s:\n%s", want, log)
		}
	}
	for _, tok := range []string{testToken, aliceToken, bobToken} {
		if strings.Contains(log, tok) {
			t.Errorf("a token is in the log: %s", log)
		}
	}
}

func TestAWriteSaysWhoDidIt(t *testing.T) {
	var buf bytes.Buffer
	f := newWriteFake()
	a := New(sampleConfig(), nil, f, zerolog.New(&buf), "1")
	a.AddTokens(Token{Name: "alice", Value: []byte(aliceToken)})
	rec := request(a.Handler(), http.MethodPost, "/v1/stacks/apps/services/api/restart", aliceToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("= %d %s", rec.Code, rec.Body)
	}
	var write string
	for _, l := range strings.Split(buf.String(), "\n") {
		if strings.Contains(l, `"message":"write"`) {
			write = l
		}
	}
	for _, want := range []string{`"by":"alice"`, `"action":"restart"`, `"service":"api"`, `"stack":"apps"`} {
		if !strings.Contains(write, want) {
			t.Errorf("the write's audit line is missing %s: %q", want, write)
		}
	}
}

func TestAnAgentWithNoTokenLetsNobodyIn(t *testing.T) {
	a := New(sampleConfig(), nil, &fakeRunner{}, zerolog.Nop(), "1")
	for _, tok := range []string{"", testToken, "x"} {
		if rec := request(a.Handler(), http.MethodGet, "/v1/info", tok); rec.Code != http.StatusUnauthorized {
			t.Errorf("token %q = %d, want 401", tok, rec.Code)
		}
	}
}

func TestAgentCheckListsTheTokens(t *testing.T) {
	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "agent.yaml")
	body := "listen: 127.0.0.1:7071\ntokens:\n  - {name: alice, file: " + filepath.ToSlash(writeTokenFile(t, dir, "alice", aliceToken)) + "}\n  - {name: bob, file: " + filepath.ToSlash(writeTokenFile(t, dir, "bob", bobToken)) + "}\nstacks:\n  - id: apps\n    dir: " + filepath.ToSlash(dir) + "\n    files: [compose.yml]\n"
	if runtime.GOOS == "windows" {
		body = strings.ReplaceAll(body, "dir: C:", "dir: C:") // absolute Windows paths are accepted by the check
	}
	if err := os.WriteFile(cfgPath, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	var out, errw bytes.Buffer
	code := Command(context.Background(), []string{"check", "--config", cfgPath}, &out, &errw, "1")
	if code != 0 || !strings.Contains(out.String(), "tokens: alice, bob") || strings.Contains(out.String(), aliceToken) {
		t.Errorf("check = %d\n%s%s", code, out.String(), errw.String())
	}
}
