package dockerx

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"unicode"

	"github.com/shadovxw/devdeck/internal/secrets"
)

// Service is everything the Docker accounts and builds feature needs, in one place for the API.
type Service struct {
	Store   Store
	Secrets secrets.Store
	Hub     *Hub
	Builder *Builder
	History *History
}

// NewService builds the service for a data folder. exe finds the devdeck program, which docker
// runs as its credential helper while a build runs. db keeps the history (nil keeps none).
func NewService(dataDir string, exe func() (string, error), db *sql.DB) *Service {
	return &Service{
		Store:   Store{Path: filepath.Join(dataDir, "docker-accounts.yaml")},
		Secrets: secrets.NewKeyring(),
		Hub:     &Hub{},
		Builder: &Builder{Executable: exe, TempDir: tempDir(dataDir)},
		History: &History{DB: db},
	}
}

// tempDir is where a build's private docker folder goes: inside the data folder, which
// only this user can read, rather than a shared temp folder.
func tempDir(dataDir string) string {
	dir := filepath.Join(dataDir, "tmp")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return ""
	}
	return dir
}

// Errors the page shows in plain words.
var (
	// ErrNoSuchAccount means the account id isn't in the list.
	ErrNoSuchAccount = errors.New("there is no such Docker account")
	// ErrNoToken means the account has no token saved yet.
	ErrNoToken = errors.New("no token is saved for this account yet")
)

// NoAccountError means no account may push to the repository's namespace.
type NoAccountError struct{ Namespace string }

func (e *NoAccountError) Error() string {
	return fmt.Sprintf("no Docker account on this machine owns the namespace %q: add one on the Docker Hub page, listing %q as its username or one of its namespaces", e.Namespace, e.Namespace)
}

// AmbiguousError means several accounts may push to the namespace.
type AmbiguousError struct {
	Namespace string
	IDs       []string
}

func (e *AmbiguousError) Error() string {
	return fmt.Sprintf("several Docker accounts own the namespace %q (%s): name one with account: in the image", e.Namespace, strings.Join(e.IDs, ", "))
}

// AccountView is an account and whether its token is saved. The token is never in it.
type AccountView struct {
	Account
	TokenSet bool `json:"token_set"`
}

// BuildSecretView is a named build secret: its name and whether a value is saved.
type BuildSecretView struct {
	Name     string `json:"name"`
	ValueSet bool   `json:"value_set"`
}

// Overview is the Docker Hub page: the accounts, the named build secrets, and whether docker is there.
type Overview struct {
	Accounts        []AccountView     `json:"accounts"`
	BuildSecrets    []BuildSecretView `json:"build_secrets"`
	DockerInstalled bool              `json:"docker_installed"`
}

func (s *Service) has(name string) bool {
	v, err := s.Secrets.Get(name)
	return err == nil && v.IsSet()
}

// Overview reads the accounts and the build secrets.
func (s *Service) Overview() (Overview, error) {
	cfg, err := s.Store.Load()
	if err != nil {
		return Overview{}, err
	}
	o := Overview{Accounts: []AccountView{}, BuildSecrets: []BuildSecretView{}}
	for _, a := range cfg.Accounts {
		if a.Registry == "" {
			a.Registry = HubRegistry
		}
		if a.Namespaces == nil {
			a.Namespaces = []string{}
		}
		o.Accounts = append(o.Accounts, AccountView{Account: a, TokenSet: s.has(SecretName(a.ID))})
	}
	for _, n := range cfg.BuildSecrets {
		o.BuildSecrets = append(o.BuildSecrets, BuildSecretView{Name: n, ValueSet: s.has(BuildSecretName(n))})
	}
	if _, err := exec.LookPath("docker"); err == nil {
		o.DockerInstalled = true
	}
	return o, nil
}

// SaveAccount adds an account or replaces the one with the same id. Its token is not touched.
func (s *Service) SaveAccount(a Account) error {
	if a.Registry == "" {
		a.Registry = HubRegistry
	}
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	if i := slices.IndexFunc(cfg.Accounts, func(x Account) bool { return x.ID == a.ID }); i >= 0 {
		cfg.Accounts[i] = a
	} else {
		cfg.Accounts = append(cfg.Accounts, a)
	}
	return s.Store.Save(cfg)
}

// DeleteAccount removes an account and its token.
func (s *Service) DeleteAccount(id string) error {
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	i := slices.IndexFunc(cfg.Accounts, func(x Account) bool { return x.ID == id })
	if i < 0 {
		return ErrNoSuchAccount
	}
	cfg.Accounts = slices.Delete(cfg.Accounts, i, i+1)
	if err := s.Store.Save(cfg); err != nil {
		return err
	}
	return s.Secrets.Delete(SecretName(id))
}

// A token or secret value: printable, no spaces, long enough to be real.
func checkValue(what, v string) error {
	if len(v) < 8 || len(v) > 4096 {
		return fmt.Errorf("that doesn't look like %s: it should be 8 to 4096 characters", what)
	}
	for _, r := range v {
		if unicode.IsSpace(r) || !unicode.IsPrint(r) {
			return fmt.Errorf("that doesn't look like %s: it has spaces or characters that can't be printed", what)
		}
	}
	return nil
}

// SetToken saves the account's personal access token in the OS keyring. It is never read back to the page.
func (s *Service) SetToken(id, token string) error {
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Find(id); !ok {
		return ErrNoSuchAccount
	}
	if err := checkValue("a Docker Hub access token", token); err != nil {
		return err
	}
	return s.Secrets.Set(SecretName(id), secrets.NewValue(token))
}

// DeleteToken forgets the account's token.
func (s *Service) DeleteToken(id string) error {
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	if _, ok := cfg.Find(id); !ok {
		return ErrNoSuchAccount
	}
	return s.Secrets.Delete(SecretName(id))
}

// CheckResult is what signing in with an account showed.
type CheckResult struct {
	Username   string   `json:"username"`
	Namespaces []string `json:"namespaces"`
}

// Check signs in to Docker Hub with the account and reports who it is and which namespaces it can use.
func (s *Service) Check(ctx context.Context, id string) (CheckResult, error) {
	a, tok, err := s.account(id)
	if err != nil {
		return CheckResult{}, err
	}
	jwt, err := s.Hub.Login(ctx, a.Username, tok.Reveal())
	if err != nil {
		return CheckResult{}, err
	}
	return CheckResult{Username: a.Username, Namespaces: s.Hub.Namespaces(ctx, jwt, a.Username)}, nil
}

func (s *Service) account(id string) (Account, secrets.Value, error) {
	cfg, err := s.Store.Load()
	if err != nil {
		return Account{}, secrets.Value{}, err
	}
	a, ok := cfg.Find(id)
	if !ok {
		return Account{}, secrets.Value{}, ErrNoSuchAccount
	}
	tok, err := s.Secrets.Get(SecretName(id))
	if errors.Is(err, secrets.ErrNotFound) || (err == nil && !tok.IsSet()) {
		return a, secrets.Value{}, ErrNoToken
	}
	if err != nil {
		return a, secrets.Value{}, err
	}
	return a, tok, nil
}

// Resolve picks the account to push a repository with: the one named, or the only one that
// owns the namespace. It checks the token is saved.
func (s *Service) Resolve(repository, wanted string) (Account, error) {
	cfg, err := s.Store.Load()
	if err != nil {
		return Account{}, err
	}
	var a Account
	if wanted != "" {
		var ok bool
		if a, ok = cfg.Find(wanted); !ok {
			return Account{}, fmt.Errorf("the image names the Docker account %q, which isn't on this machine: add it on the Docker Hub page", wanted)
		}
	} else {
		match := cfg.Match(repository)
		switch len(match) {
		case 0:
			return Account{}, &NoAccountError{Namespace: Namespace(repository)}
		case 1:
			a = match[0]
		default:
			ids := make([]string, len(match))
			for i, m := range match {
				ids[i] = m.ID
			}
			return Account{}, &AmbiguousError{Namespace: Namespace(repository), IDs: ids}
		}
	}
	if !s.has(SecretName(a.ID)) {
		return a, fmt.Errorf("the account %q: %w", a.ID, ErrNoToken)
	}
	return a, nil
}

// SetBuildSecret saves a named build secret's value in the keyring and lists its name.
func (s *Service) SetBuildSecret(name, value string) error {
	if !ValidSecretName(name) {
		return fmt.Errorf("%q isn't a name: lower case letters, digits, dashes and underscores, starting with a letter", name)
	}
	if err := checkValue("a secret", value); err != nil {
		return err
	}
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	if !slices.Contains(cfg.BuildSecrets, name) {
		cfg.BuildSecrets = append(cfg.BuildSecrets, name)
		if err := s.Store.Save(cfg); err != nil {
			return err
		}
	}
	return s.Secrets.Set(BuildSecretName(name), secrets.NewValue(value))
}

// DeleteBuildSecret forgets a named build secret.
func (s *Service) DeleteBuildSecret(name string) error {
	cfg, err := s.Store.Load()
	if err != nil {
		return err
	}
	i := slices.Index(cfg.BuildSecrets, name)
	if i < 0 {
		return ErrNoSuchSecret
	}
	cfg.BuildSecrets = slices.Delete(cfg.BuildSecrets, i, i+1)
	if err := s.Store.Save(cfg); err != nil {
		return err
	}
	return s.Secrets.Delete(BuildSecretName(name))
}

// ErrNoSuchSecret means there is no build secret by that name.
var ErrNoSuchSecret = errors.New("there is no build secret with that name")

// BuildSecret reads a named build secret's value, for a build.
func (s *Service) BuildSecret(name string) (secrets.Value, error) {
	v, err := s.Secrets.Get(BuildSecretName(name))
	if errors.Is(err, secrets.ErrNotFound) || (err == nil && !v.IsSet()) {
		return secrets.Value{}, fmt.Errorf("the build secret %q has no value saved: save it on the Docker Hub page", name)
	}
	return v, err
}

// TagExists asks Docker Hub whether the repository already has the tag, signing in with the account.
func (s *Service) TagExists(ctx context.Context, a Account, repository, tag string) (bool, error) {
	tok, err := s.Secrets.Get(SecretName(a.ID))
	if err != nil {
		return false, err
	}
	jwt, err := s.Hub.Login(ctx, a.Username, tok.Reveal())
	if err != nil {
		return false, err
	}
	return s.Hub.TagExists(ctx, jwt, repository, tag)
}
