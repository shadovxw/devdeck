package gitx

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// Host is the only GitHub host devdeck handles for now.
const Host = "github.com"

// Account is one account `gh` is signed in to. It carries no token.
type Account struct {
	Login  string   `json:"login"`
	Active bool     `json:"active"`
	Scopes []string `json:"scopes"`
	// TokenSource is where gh keeps the token ("keyring" is the safe one).
	TokenSource string `json:"token_source"`
}

// CheckResult is what a connection's token can see on GitHub.
type CheckResult struct {
	Login  string   `json:"login"`
	Scopes []string `json:"scopes"`
	// Orgs are the organisations the account belongs to (needs the read:org scope).
	Orgs []string `json:"orgs"`
	// OrgsNote says why Orgs is empty when it couldn't be read.
	OrgsNote string `json:"orgs_note,omitempty"`
}

// Runner runs gh with extra environment variables and returns what it printed. Tests replace it.
type Runner func(ctx context.Context, env []string, args ...string) (string, error)

// GH talks to the GitHub CLI.
type GH struct {
	path string
	run  Runner
}

// FindGH looks for the GitHub CLI: on the PATH, then where its installer puts it on Windows.
func FindGH() string {
	if p, err := exec.LookPath("gh"); err == nil {
		return p
	}
	if runtime.GOOS == "windows" {
		for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("LOCALAPPDATA")} {
			if base == "" {
				continue
			}
			for _, rel := range []string{`GitHub CLI\gh.exe`, `Programs\GitHub CLI\gh.exe`} {
				p := base + `\` + rel
				if _, err := os.Stat(p); err == nil {
					return p
				}
			}
		}
	}
	return ""
}

// NewGH uses the gh at path, or finds one when path is empty.
func NewGH(path string) *GH {
	if path == "" {
		path = FindGH()
	}
	g := &GH{path: path}
	g.run = g.exec
	return g
}

// NewGHWith is NewGH with the command replaced, for tests.
func NewGHWith(path string, run Runner) *GH { return &GH{path: path, run: run} }

// Installed says whether there is a gh to talk to.
func (g *GH) Installed() bool { return g.path != "" }

// Path is where gh was found ("" when it wasn't).
func (g *GH) Path() string { return g.path }

// ErrNoGH means the GitHub CLI isn't installed.
var ErrNoGH = errors.New("the GitHub CLI (gh) isn't installed: install it, then sign in with `gh auth login`")

func (g *GH) exec(ctx context.Context, env []string, args ...string) (string, error) {
	if g.path == "" {
		return "", ErrNoGH
	}
	res, err := proc.Run(ctx, proc.Cmd{
		Name: g.path, Args: args, Timeout: 20 * time.Second,
		Env: append([]string{"GH_PROMPT_DISABLED=1", "NO_COLOR=1", "GH_NO_UPDATE_NOTIFIER=1"}, env...),
	})
	if err != nil {
		return "", err
	}
	if !res.OK() {
		msg := strings.TrimSpace(res.Stderr)
		if i := strings.LastIndexByte(msg, '\n'); i >= 0 {
			msg = msg[i+1:]
		}
		return "", fmt.Errorf("gh %s: %s", args[0], msg)
	}
	return res.Stdout, nil
}

type statusJSON struct {
	Hosts map[string][]struct {
		Active      bool   `json:"active"`
		Login       string `json:"login"`
		Scopes      string `json:"scopes"`
		TokenSource string `json:"tokenSource"`
		State       string `json:"state"`
	} `json:"hosts"`
}

// Accounts lists the accounts gh is signed in to on github.com. No tokens are read.
func (g *GH) Accounts(ctx context.Context) ([]Account, error) {
	out, err := g.run(ctx, nil, "auth", "status", "--json", "hosts")
	if err != nil {
		// With no account at all gh exits with an error; that is an empty list, not a failure.
		if strings.Contains(err.Error(), "not logged") {
			return nil, nil
		}
		return nil, err
	}
	var st statusJSON
	if err := json.Unmarshal([]byte(out), &st); err != nil {
		return nil, fmt.Errorf("gh auth status: unreadable answer: %w", err)
	}
	var list []Account
	for _, a := range st.Hosts[Host] {
		if a.State != "success" {
			continue
		}
		var scopes []string
		for _, s := range strings.Split(a.Scopes, ",") {
			if s = strings.TrimSpace(s); s != "" {
				scopes = append(scopes, s)
			}
		}
		list = append(list, Account{Login: a.Login, Active: a.Active, Scopes: scopes, TokenSource: a.TokenSource})
	}
	return list, nil
}

// Token asks gh for one account's token. The token is held only by the caller, who
// must not log it.
func (g *GH) Token(ctx context.Context, user string) (string, error) {
	out, err := g.run(ctx, nil, "auth", "token", "--hostname", Host, "--user", user)
	if err != nil {
		return "", fmt.Errorf("no token for %s: %w", user, err)
	}
	tok := strings.TrimSpace(out)
	if tok == "" {
		return "", fmt.Errorf("no token for %s", user)
	}
	return tok, nil
}

// Check asks GitHub, as one account, who it is, what its token may do and which
// organisations it belongs to.
func (g *GH) Check(ctx context.Context, user string) (CheckResult, error) {
	tok, err := g.Token(ctx, user)
	if err != nil {
		return CheckResult{}, err
	}
	env := []string{"GH_TOKEN=" + tok}
	out, err := g.run(ctx, env, "api", "-i", "user")
	if err != nil {
		return CheckResult{}, fmt.Errorf("GitHub didn't accept the token of %s: %w", user, err)
	}
	head, body, _ := strings.Cut(strings.ReplaceAll(out, "\r\n", "\n"), "\n\n")
	var who struct {
		Login string `json:"login"`
	}
	if err := json.Unmarshal([]byte(body), &who); err != nil || who.Login == "" {
		return CheckResult{}, errors.New("GitHub's answer about the account couldn't be read")
	}
	res := CheckResult{Login: who.Login}
	for _, line := range strings.Split(head, "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok && strings.EqualFold(strings.TrimSpace(k), "x-oauth-scopes") {
			for _, s := range strings.Split(v, ",") {
				if s = strings.TrimSpace(s); s != "" {
					res.Scopes = append(res.Scopes, s)
				}
			}
		}
	}
	orgs, err := g.run(ctx, env, "api", "user/orgs", "--jq", ".[].login")
	if err != nil {
		res.OrgsNote = "The organisations couldn't be listed: the token may lack the read:org scope."
		return res, nil
	}
	for _, o := range strings.Fields(orgs) {
		res.Orgs = append(res.Orgs, o)
	}
	return res, nil
}
