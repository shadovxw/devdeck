package gitx

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// Identity is the name and email commits are made with.
type Identity struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// The states of a repository's account setup.
const (
	StateOK            = "ok"             // a rule matches and the identity is right
	StateWrongIdentity = "wrong-identity" // a rule matches, but name or email differ
	StateNoRule        = "no-rule"        // no connection is tied to this repository
	StateNoRemote      = "no-remote"      // the repository has no origin
	StateMissing       = "missing"        // the folder isn't there or isn't a git repository
	StateOtherHost     = "other-host"     // the remote isn't on github.com
)

// RepoStatus is how one repository stands with the git accounts.
type RepoStatus struct {
	Path string `json:"path"`
	// Remote is the origin address without credentials.
	Remote string `json:"remote"`
	// Connection is the id of the connection a rule picks, if any.
	Connection string `json:"connection,omitempty"`
	// Expected is the identity of that connection; Actual is what git would commit with now.
	Expected Identity `json:"expected"`
	Actual   Identity `json:"actual"`
	State    string   `json:"state"`
}

// Git runs git commands in repositories.
type Git struct {
	// Path is the git program ("" means "git" on the PATH).
	Path string
	// Env is extra environment, for tests.
	Env []string
}

func (g Git) run(ctx context.Context, dir string, args ...string) (string, int, error) {
	name := g.Path
	if name == "" {
		name = "git"
	}
	res, err := proc.Run(ctx, proc.Cmd{Name: name, Args: append([]string{"-C", dir}, args...), Env: g.Env, Timeout: 15 * time.Second})
	if err != nil {
		return "", -1, err
	}
	return strings.TrimSpace(res.Stdout), res.ExitCode, nil
}

// Inspect looks at one repository folder against the configuration.
func (g Git) Inspect(ctx context.Context, dir string, cfg Config) RepoStatus {
	st := RepoStatus{Path: dir}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		st.State = StateMissing
		return st
	}
	if _, code, err := g.run(ctx, dir, "rev-parse", "--git-dir"); err != nil || code != 0 {
		st.State = StateMissing
		return st
	}
	if name, code, _ := g.run(ctx, dir, "config", "user.name"); code == 0 {
		st.Actual.Name = name
	}
	if email, code, _ := g.run(ctx, dir, "config", "user.email"); code == 0 {
		st.Actual.Email = email
	}
	raw, code, _ := g.run(ctx, dir, "remote", "get-url", "origin")
	if code != 0 || raw == "" {
		st.State = StateNoRemote
		return st
	}
	st.Remote = StripCredentials(raw)
	rm, ok := ParseRemote(raw)
	switch {
	case !ok || !strings.EqualFold(rm.Host, Host):
		st.State = StateOtherHost
		return st
	}
	cn, ok := cfg.ConnectionFor(rm)
	if !ok {
		st.State = StateNoRule
		return st
	}
	st.Connection = cn.ID
	st.Expected = Identity{Name: cn.Name, Email: cn.Email}
	// A connection with no name or email asks for none: only what it sets is compared.
	if (cn.Name != "" && cn.Name != st.Actual.Name) || (cn.Email != "" && !strings.EqualFold(cn.Email, st.Actual.Email)) {
		st.State = StateWrongIdentity
		return st
	}
	st.State = StateOK
	return st
}

// ApplyIdentity writes a connection's name and email into the repository's own git
// config, leaving the global one alone. What the connection doesn't set isn't touched.
func (g Git) ApplyIdentity(ctx context.Context, dir string, cn Connection) error {
	if cn.Name == "" && cn.Email == "" {
		return fmt.Errorf("the connection %q has no name or email to write", cn.ID)
	}
	for _, kv := range [][2]string{{"user.name", cn.Name}, {"user.email", cn.Email}} {
		if kv[1] == "" {
			continue
		}
		if _, code, err := g.run(ctx, dir, "config", "--local", kv[0], kv[1]); err != nil || code != 0 {
			return fmt.Errorf("git couldn't set %s in %s", kv[0], dir)
		}
	}
	return nil
}
