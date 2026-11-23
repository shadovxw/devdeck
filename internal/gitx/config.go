package gitx

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"go.yaml.in/yaml/v3"
)

// FileName is the file in devdeck's data folder that holds the connections and rules.
const FileName = "git-accounts.yaml"

// Limits keep the file small enough to read and edit by hand.
const (
	maxConnections = 50
	maxRules       = 200
	maxFileBytes   = 256 << 10
)

// Connection stands for one GitHub account that gh is signed in to, with the commit
// identity to use for its repositories.
type Connection struct {
	ID string `yaml:"id" json:"id"`
	// User is the gh account (its GitHub login).
	User  string `yaml:"gh_user" json:"gh_user"`
	Name  string `yaml:"name,omitempty" json:"name,omitempty"`
	Email string `yaml:"email,omitempty" json:"email,omitempty"`
}

// Config is what devdeck knows about git accounts.
type Config struct {
	Version     int          `yaml:"version" json:"version"`
	Connections []Connection `yaml:"connections" json:"connections"`
	Rules       []Rule       `yaml:"rules" json:"rules"`
}

var (
	idPattern   = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
	userPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$`)
	emailRE     = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// Validate reports why a configuration can't be saved, in plain words.
func (c Config) Validate() error {
	if len(c.Connections) > maxConnections || len(c.Rules) > maxRules {
		return fmt.Errorf("at most %d connections and %d rules", maxConnections, maxRules)
	}
	ids := map[string]bool{}
	for i, cn := range c.Connections {
		switch {
		case !idPattern.MatchString(cn.ID):
			return fmt.Errorf("connection %d: id must be lowercase letters, digits and dashes, starting with a letter", i+1)
		case ids[cn.ID]:
			return fmt.Errorf("connection %q is listed twice", cn.ID)
		case !userPattern.MatchString(cn.User):
			return fmt.Errorf("connection %q: %q isn't a GitHub username", cn.ID, cn.User)
		case len(cn.Name) > 100 || strings.ContainsAny(cn.Name, "\r\n"):
			return fmt.Errorf("connection %q: the name must be one line of up to 100 characters", cn.ID)
		case cn.Email != "" && (!emailRE.MatchString(cn.Email) || len(cn.Email) > 200):
			return fmt.Errorf("connection %q: %q isn't an email address", cn.ID, cn.Email)
		}
		ids[cn.ID] = true
	}
	for i, r := range c.Rules {
		switch {
		case !ValidMatch(r.Match):
			return fmt.Errorf("rule %d: %q isn't a pattern; write github.com/<owner>/<repo>, github.com/<owner>/* or github.com/*", i+1, r.Match)
		case !ids[r.Connection]:
			return fmt.Errorf("rule %d: there is no connection %q", i+1, r.Connection)
		}
	}
	return nil
}

// Connection finds a connection by id.
func (c Config) Connection(id string) (Connection, bool) {
	for _, cn := range c.Connections {
		if cn.ID == id {
			return cn, true
		}
	}
	return Connection{}, false
}

// ByUser finds the connection of a gh account, ignoring case (GitHub logins are case blind).
func (c Config) ByUser(user string) (Connection, bool) {
	for _, cn := range c.Connections {
		if strings.EqualFold(cn.User, user) {
			return cn, true
		}
	}
	return Connection{}, false
}

// ConnectionFor picks the connection for a repository address: a username written in
// the address that names a connection, else the best rule.
func (c Config) ConnectionFor(rm Remote) (Connection, bool) {
	if rm.User != "" {
		if cn, ok := c.ByUser(rm.User); ok {
			return cn, true
		}
	}
	if r, ok := Choose(c.Rules, rm); ok {
		return c.Connection(r.Connection)
	}
	return Connection{}, false
}

// Store keeps the configuration in a file in dir.
type Store struct {
	Dir string
	mu  sync.Mutex
}

func (s *Store) path() string { return filepath.Join(s.Dir, FileName) }

// Load reads the file. A missing file is an empty configuration. The file is read
// strictly: a key it doesn't know is an error, so a typo isn't silently dropped.
func (s *Store) Load() (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

func (s *Store) load() (Config, error) {
	data, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		return Config{Version: 1}, nil
	}
	if err != nil {
		return Config{}, err
	}
	if len(data) > maxFileBytes {
		return Config{}, fmt.Errorf("%s is too large", FileName)
	}
	var c Config
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&c); err != nil && !errors.Is(err, io.EOF) {
		return Config{}, fmt.Errorf("%s: %w", FileName, err)
	}
	if c.Version == 0 {
		c.Version = 1
	}
	return c, nil
}

// Save checks and writes the configuration: the text is written aside and renamed over
// the old file, so a failure part way never leaves a half-written one. The file is
// readable by this user only.
func (s *Store) Save(c Config) error {
	c.Version = 1
	if err := c.Validate(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.Dir, ".git-accounts-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		_ = os.Remove(name)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Chmod(name, 0o600); err != nil {
		_ = os.Remove(name)
		return err
	}
	if err := os.Rename(name, s.path()); err != nil {
		_ = os.Remove(name)
		return err
	}
	return nil
}
