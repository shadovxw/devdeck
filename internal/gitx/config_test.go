package gitx

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func sample() Config {
	return Config{
		Version: 1,
		Connections: []Connection{
			{ID: "personal", User: "me-personal", Name: "Me Personal", Email: "me@example.com"},
			{ID: "office", User: "office-dev", Name: "Me Office", Email: "me@office.example"},
		},
		Rules: []Rule{
			{Match: "github.com/me-personal/*", Connection: "personal"},
			{Match: "github.com/acme/*", Connection: "office"},
		},
	}
}

func TestValidate(t *testing.T) {
	if err := sample().Validate(); err != nil {
		t.Fatal(err)
	}
	if err := (Config{}).Validate(); err != nil {
		t.Errorf("an empty configuration is fine: %v", err)
	}
	mutate := func(f func(*Config)) Config {
		c := sample()
		f(&c)
		return c
	}
	tests := map[string]struct {
		cfg  Config
		want string
	}{
		"a bad id":         {mutate(func(c *Config) { c.Connections[0].ID = "Personal One" }), "id must be"},
		"a repeated id":    {mutate(func(c *Config) { c.Connections[1].ID = "personal" }), "listed twice"},
		"a bad user":       {mutate(func(c *Config) { c.Connections[0].User = "-bad-" }), "isn't a GitHub username"},
		"a user with room": {mutate(func(c *Config) { c.Connections[0].User = "a b" }), "isn't a GitHub username"},
		"a long name":      {mutate(func(c *Config) { c.Connections[0].Name = strings.Repeat("n", 101) }), "name must be"},
		"a name with eol":  {mutate(func(c *Config) { c.Connections[0].Name = "a\nb" }), "name must be"},
		"a bad email":      {mutate(func(c *Config) { c.Connections[0].Email = "not an email" }), "isn't an email"},
		"a bad pattern":    {mutate(func(c *Config) { c.Rules[0].Match = "github.com" }), "isn't a pattern"},
		"an unknown conn":  {mutate(func(c *Config) { c.Rules[0].Connection = "nobody" }), "no connection"},
		"too many rules":   {mutate(func(c *Config) { c.Rules = make([]Rule, maxRules+1) }), "at most"},
	}
	for name, tc := range tests {
		if err := tc.cfg.Validate(); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Errorf("%s: err = %v, want it to mention %q", name, err, tc.want)
		}
	}
}

func TestConnectionFor(t *testing.T) {
	cfg := sample()
	tests := []struct {
		name string
		rm   Remote
		want string
	}{
		{"by rule", Remote{Host: "github.com", Owner: "acme", Repo: "api"}, "office"},
		{"by the other rule", Remote{Host: "github.com", Owner: "me-personal", Repo: "devdeck"}, "personal"},
		{"a user in the address beats the rule", Remote{Host: "github.com", Owner: "acme", Repo: "api", User: "ME-PERSONAL"}, "personal"},
		{"a user that is no connection is ignored", Remote{Host: "github.com", Owner: "acme", Repo: "api", User: "stranger"}, "office"},
		{"a user with no rule for the repo still picks its connection", Remote{Host: "github.com", Owner: "elsewhere", Repo: "x", User: "office-dev"}, "office"},
		{"nothing matches", Remote{Host: "github.com", Owner: "elsewhere", Repo: "x"}, ""},
	}
	for _, tc := range tests {
		got, ok := cfg.ConnectionFor(tc.rm)
		if got.ID != tc.want || ok != (tc.want != "") {
			t.Errorf("%s: got %q, %v", tc.name, got.ID, ok)
		}
	}
	if _, ok := cfg.Connection("office"); !ok {
		t.Error("Connection by id")
	}
	if _, ok := cfg.ByUser("OFFICE-DEV"); !ok {
		t.Error("ByUser ignores case")
	}
}

func TestStoreRoundTripAndFile(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	s := &Store{Dir: dir}
	if c, err := s.Load(); err != nil || len(c.Connections) != 0 || c.Version != 1 {
		t.Fatalf("a missing file is an empty configuration: %+v, %v", c, err)
	}
	if err := s.Save(sample()); err != nil {
		t.Fatal(err)
	}
	got, err := s.Load()
	if err != nil || len(got.Connections) != 2 || got.Rules[1].Match != "github.com/acme/*" || got.Connections[1].Email != "me@office.example" {
		t.Fatalf("loaded %+v, %v", got, err)
	}
	if runtime.GOOS != "windows" {
		if info, _ := os.Stat(filepath.Join(dir, FileName)); info.Mode().Perm() != 0o600 {
			t.Errorf("the file should be private to this user, mode %v", info.Mode().Perm())
		}
	}
	if left, _ := filepath.Glob(filepath.Join(dir, ".git-accounts-*")); len(left) != 0 {
		t.Errorf("temporary files left behind: %v", left)
	}
	// an invalid configuration is refused and the file stays as it was
	bad := sample()
	bad.Rules[0].Connection = "nobody"
	if err := s.Save(bad); err == nil {
		t.Error("an invalid configuration was saved")
	}
	if again, _ := s.Load(); len(again.Rules) != 2 || again.Rules[0].Connection != "personal" {
		t.Errorf("the file changed: %+v", again)
	}
}

func TestStoreReadsStrictly(t *testing.T) {
	dir := t.TempDir()
	s := &Store{Dir: dir}
	path := filepath.Join(dir, FileName)
	for name, content := range map[string]string{
		"an unknown key": "version: 1\nconnections:\n  - id: a\n    gh_user: a\n    colour: red\n",
		"not yaml":       "connections: [",
		"too large":      strings.Repeat("#", maxFileBytes+1),
	} {
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Load(); err == nil {
			t.Errorf("%s: should be an error", name)
		}
	}
	if err := os.WriteFile(path, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	if c, err := s.Load(); err != nil || c.Version != 1 {
		t.Errorf("an empty file: %+v %v", c, err)
	}
}
