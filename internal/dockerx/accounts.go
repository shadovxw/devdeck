// Package dockerx handles Docker Hub accounts and builds images with them: several
// accounts side by side (as devdeck does for GitHub), each repository's images pushed with
// the account that owns the namespace, and the person's own `docker login` left alone.
//
// An account is a Docker Hub username and, in the OS keyring, a personal access token.
// Nothing secret is kept in a file. A build runs docker with a private, temporary
// DOCKER_CONFIG whose credential helper is devdeck itself, so the token goes from the
// keyring to docker and nowhere else.
package dockerx

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

// HubRegistry is the only registry for now. The field exists so another can be added.
const HubRegistry = "docker.io"

const (
	maxAccounts   = 20
	maxNamespaces = 20
	// maxBuildSecrets bounds the named build secrets.
	maxBuildSecrets = 50
)

var (
	idPattern   = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)
	namePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{1,254}$`)
	repoPattern = regexp.MustCompile(`^[a-z0-9]+([._-][a-z0-9]+)*(/[a-z0-9]+([._-][a-z0-9]+)*)+$`)
)

// Account is one Docker Hub login on this machine. The token is in the OS keyring under
// SecretName(ID), never here.
type Account struct {
	ID       string `yaml:"id" json:"id"`
	Username string `yaml:"username" json:"username"`
	// Registry is docker.io (the default when empty).
	Registry string `yaml:"registry,omitempty" json:"registry"`
	// Namespaces are the organisations this account may push to, besides its own username.
	Namespaces []string `yaml:"namespaces,omitempty" json:"namespaces"`
}

// SecretName is where the account's token lives in the OS keyring.
func SecretName(id string) string { return "docker/" + id }

// Owns reports whether the account may push to the namespace: its own, or a listed one.
func (a Account) Owns(namespace string) bool {
	return a.Username == namespace || slices.Contains(a.Namespaces, namespace)
}

// Config is docker-accounts.yaml: the accounts, in the order they were added, and the names
// of the build secrets saved in the keyring (the values are only there, never here).
type Config struct {
	Accounts     []Account `yaml:"accounts" json:"accounts"`
	BuildSecrets []string  `yaml:"build_secrets,omitempty" json:"build_secrets"`
}

var secretNamePattern = regexp.MustCompile(`^[a-z][a-z0-9_-]{0,39}$`)

// ValidSecretName reports whether s can name a build secret in the keyring.
func ValidSecretName(s string) bool { return secretNamePattern.MatchString(s) }

// BuildSecretName is where a named build secret lives in the OS keyring.
func BuildSecretName(name string) string { return "docker-build/" + name }

// Namespace is the part of a Docker Hub repository before the slash.
func Namespace(repository string) string {
	ns, _, _ := strings.Cut(repository, "/")
	return ns
}

// ValidRepository reports whether s is a Docker Hub repository, namespace/name, with no tag.
func ValidRepository(s string) bool { return repoPattern.MatchString(s) }

// Check says what is wrong with an account, in plain words, or returns nil.
func (a Account) Check() error {
	switch {
	case !idPattern.MatchString(a.ID):
		return errors.New("the id must be lower case letters, digits and dashes, starting with a letter (40 at most)")
	case !namePattern.MatchString(a.Username):
		return errors.New("the Docker Hub username must be lower case letters, digits, dots, dashes and underscores")
	case a.Registry != "" && a.Registry != HubRegistry:
		return fmt.Errorf("only %s is supported for now", HubRegistry)
	case len(a.Namespaces) > maxNamespaces:
		return fmt.Errorf("at most %d extra namespaces", maxNamespaces)
	}
	seen := map[string]bool{}
	for _, ns := range a.Namespaces {
		if !namePattern.MatchString(ns) {
			return fmt.Errorf("%q isn't a Docker Hub namespace", ns)
		}
		if seen[ns] {
			return fmt.Errorf("the namespace %q is listed twice", ns)
		}
		seen[ns] = true
	}
	return nil
}

// Check says what is wrong with the list, or returns nil.
func (c Config) Check() error {
	if len(c.Accounts) > maxAccounts {
		return fmt.Errorf("at most %d accounts", maxAccounts)
	}
	if len(c.BuildSecrets) > maxBuildSecrets {
		return fmt.Errorf("at most %d build secrets", maxBuildSecrets)
	}
	names := map[string]bool{}
	for _, n := range c.BuildSecrets {
		if !ValidSecretName(n) {
			return fmt.Errorf("%q isn't a build secret name", n)
		}
		if names[n] {
			return fmt.Errorf("the build secret %q is listed twice", n)
		}
		names[n] = true
	}
	ids := map[string]bool{}
	for _, a := range c.Accounts {
		if err := a.Check(); err != nil {
			return fmt.Errorf("account %q: %w", a.ID, err)
		}
		if ids[a.ID] {
			return fmt.Errorf("the account id %q is used twice", a.ID)
		}
		ids[a.ID] = true
	}
	return nil
}

// Find returns the account with that id.
func (c Config) Find(id string) (Account, bool) {
	for _, a := range c.Accounts {
		if a.ID == id {
			return a, true
		}
	}
	return Account{}, false
}

// Match lists the accounts that may push to the repository's namespace.
func (c Config) Match(repository string) []Account {
	ns := Namespace(repository)
	var out []Account
	for _, a := range c.Accounts {
		if a.Owns(ns) {
			out = append(out, a)
		}
	}
	return out
}

// Store reads and writes docker-accounts.yaml. It is per machine and per person, so it
// lives in devdeck's data folder, not in a workspace or a repository.
type Store struct{ Path string }

// Load reads the accounts. A missing file is no accounts.
func (s Store) Load() (Config, error) {
	b, err := os.ReadFile(s.Path)
	if errors.Is(err, fs.ErrNotExist) {
		return Config{Accounts: []Account{}, BuildSecrets: []string{}}, nil
	}
	if err != nil {
		return Config{}, err
	}
	var c Config
	dec := yaml.NewDecoder(bytes.NewReader(b))
	dec.KnownFields(true)
	if err := dec.Decode(&c); err != nil && !errors.Is(err, errEOF) {
		return Config{}, fmt.Errorf("%s can't be read: %w", filepath.Base(s.Path), err)
	}
	if err := c.Check(); err != nil {
		return Config{}, fmt.Errorf("%s: %w", filepath.Base(s.Path), err)
	}
	if c.Accounts == nil {
		c.Accounts = []Account{}
	}
	if c.BuildSecrets == nil {
		c.BuildSecrets = []string{}
	}
	return c, nil
}

// Save checks and writes the accounts in one step (a temporary file, then a rename), private to the user.
func (s Store) Save(c Config) error {
	if err := c.Check(); err != nil {
		return err
	}
	b, err := yaml.Marshal(c)
	if err != nil {
		return err
	}
	b = append([]byte("# Docker Hub accounts on this machine. Tokens are in your OS keychain, never here.\n"), b...)
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(s.Path), ".docker-accounts-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(b)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), s.Path); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}
