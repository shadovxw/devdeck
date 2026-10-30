// Package agent is `devdeck agent`: a small server that runs on a remote host, next to
// the compose stacks it looks after, and answers devdeck through a tunnel. It listens
// on the loopback address only, wants a token, never runs a shell, and never reads an
// env file.
package agent

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"

	"github.com/shadovxw/devdeck/internal/compose"
)

// DefaultListen is where the agent listens when the configuration doesn't say.
const DefaultListen = "127.0.0.1:7071"

// Config is /etc/devdeck/agent.yaml. It names folders and files, never a secret.
type Config struct {
	Listen string `yaml:"listen"`
	// TokenFile is one token shared by everyone who uses the agent (named "shared" in the audit log).
	TokenFile string `yaml:"token_file"`
	// Tokens are one token per person, each in its own file, so the audit log says who did what
	// and one person can be cut off by removing a line. TokenFile may be used with them or not at all.
	Tokens []TokenFile `yaml:"tokens"`
	Stacks []Stack     `yaml:"stacks"`
}

// TokenFile is one person's token: a name for the audit log and the file that holds it.
type TokenFile struct {
	Name string `yaml:"name"`
	File string `yaml:"file"`
}

// Stack is one compose project on the host.
type Stack struct {
	ID   string `yaml:"id"`
	Name string `yaml:"name"`
	// Dir is the folder the compose commands run in; relative files are relative to it.
	Dir      string   `yaml:"dir"`
	Files    []string `yaml:"files"`
	EnvFiles []string `yaml:"env_files"`
	// VersionsFile is the env file with the image tags, the one file the agent may write.
	VersionsFile string `yaml:"versions_file"`
	// AllowWrite lets devdeck start, stop and change this stack. Off by default.
	AllowWrite bool `yaml:"allow_write"`
	// After lists the stacks that must be up before this one.
	After []string `yaml:"after"`
	// UpScript is a script in Dir that brings the stack up, such as ./dev-up.sh.
	UpScript string `yaml:"up_script"`
}

// Project is the stack as the compose package runs it.
func (s Stack) Project() compose.Project {
	return compose.Project{Dir: s.Dir, Files: s.Files, EnvFiles: s.EnvFiles}
}

var idPattern = regexp.MustCompile(`^[a-z][a-z0-9-]{0,39}$`)

// LoadConfig reads and checks the configuration file.
func LoadConfig(path string) (Config, error) {
	data, err := os.ReadFile(path) // #nosec G304 -- the path is the agent's own --config flag
	if err != nil {
		return Config{}, fmt.Errorf("the agent's configuration couldn't be read: %w", err)
	}
	var cfg Config
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&cfg); err != nil {
		return Config{}, fmt.Errorf("%s: %w", path, err)
	}
	if cfg.Listen == "" {
		cfg.Listen = DefaultListen
	}
	for i := range cfg.Stacks {
		if cfg.Stacks[i].Name == "" {
			cfg.Stacks[i].Name = cfg.Stacks[i].ID
		}
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("%s: %w", path, err)
	}
	return cfg, nil
}

// Validate checks everything that would make the agent unsafe or confused.
func (c Config) Validate() error {
	var errs []error
	if err := loopbackOnly(c.Listen); err != nil {
		errs = append(errs, err)
	}
	if c.TokenFile == "" && len(c.Tokens) == 0 {
		errs = append(errs, errors.New("token_file or tokens is required"))
	}
	names := map[string]bool{}
	for i, t := range c.Tokens {
		switch {
		case !idPattern.MatchString(t.Name):
			errs = append(errs, fmt.Errorf("token %d: the name must be lowercase letters, digits and dashes, starting with a letter", i+1))
		case t.Name == SharedToken:
			errs = append(errs, fmt.Errorf("token %d: %q is the name of token_file; pick another", i+1, SharedToken))
		case names[t.Name]:
			errs = append(errs, fmt.Errorf("token %q: the name is used twice", t.Name))
		}
		names[t.Name] = true
		if t.File == "" {
			errs = append(errs, fmt.Errorf("token %q: file is required", t.Name))
		}
	}
	if len(c.Stacks) == 0 {
		errs = append(errs, errors.New("no stack is listed"))
	}
	seen := map[string]bool{}
	for i, s := range c.Stacks {
		at := fmt.Sprintf("stack %d", i+1)
		if s.ID != "" {
			at = fmt.Sprintf("stack %q", s.ID)
		}
		switch {
		case !idPattern.MatchString(s.ID):
			errs = append(errs, fmt.Errorf("%s: the id must be lowercase letters, digits and dashes, starting with a letter", at))
		case seen[s.ID]:
			errs = append(errs, fmt.Errorf("%s: the id is used twice", at))
		}
		seen[s.ID] = true
		if !filepath.IsAbs(s.Dir) && !strings.HasPrefix(s.Dir, "/") {
			errs = append(errs, fmt.Errorf("%s: dir must be an absolute path", at))
		}
		if len(s.Files) == 0 {
			errs = append(errs, fmt.Errorf("%s: at least one compose file is needed", at))
		}
		for _, f := range append(append(append([]string{}, s.Files...), s.EnvFiles...), s.VersionsFile, s.UpScript) {
			if f != "" && !insideName(f) {
				errs = append(errs, fmt.Errorf("%s: %q must be a path inside dir", at, f))
			}
		}
		if s.VersionsFile != "" && !slices.Contains(s.EnvFiles, s.VersionsFile) {
			errs = append(errs, fmt.Errorf("%s: versions_file %q must also be listed in env_files, or compose would never read the tags the agent writes", at, s.VersionsFile))
		}
	}
	for _, s := range c.Stacks {
		for _, a := range s.After {
			if !seen[a] || a == s.ID {
				errs = append(errs, fmt.Errorf("stack %q: after names %q, which isn't another stack", s.ID, a))
			}
		}
	}
	if err := c.cycle(); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

// Stack finds a stack by id.
func (c Config) Stack(id string) (Stack, bool) {
	for _, s := range c.Stacks {
		if s.ID == id {
			return s, true
		}
	}
	return Stack{}, false
}

// loopbackOnly refuses any listen address that isn't 127.0.0.1 or ::1: the agent is
// reached through a tunnel, never over the network.
func loopbackOnly(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil || port == "" {
		return fmt.Errorf("listen %q must be host:port", addr)
	}
	if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
		return fmt.Errorf("listen %q must be a loopback address (127.0.0.1 or [::1]): the agent is reached through a tunnel only", addr)
	}
	return nil
}

// insideName says a file name stays inside the stack's folder: relative, no "..",
// and nothing docker could read as an option.
func insideName(f string) bool {
	if f == "" || strings.HasPrefix(f, "-") || strings.HasPrefix(f, "/") || filepath.IsAbs(f) || strings.ContainsAny(f, "\x00\n") {
		return false
	}
	for _, part := range strings.FieldsFunc(f, func(r rune) bool { return r == '/' || r == '\\' }) {
		if part == ".." {
			return false
		}
	}
	return true
}

// cycle reports stacks that wait for each other through after.
func (c Config) cycle() error {
	after := map[string][]string{}
	for _, s := range c.Stacks {
		after[s.ID] = s.After
	}
	state := map[string]int{} // 0 not seen, 1 on the path, 2 done
	var visit func(string) bool
	visit = func(id string) bool {
		switch state[id] {
		case 1:
			return true
		case 2:
			return false
		}
		state[id] = 1
		for _, a := range after[id] {
			if visit(a) {
				return true
			}
		}
		state[id] = 2
		return false
	}
	for _, s := range c.Stacks {
		if visit(s.ID) {
			return fmt.Errorf("the stacks' after lists go round in a circle (through %q)", s.ID)
		}
	}
	return nil
}
