package gitx

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/internal/config"
)

// Deps are what the credential helper needs; tests replace them.
type Deps struct {
	Config func() (Config, error)
	// Token returns the token of a gh account. It is written only to git's answer.
	Token  func(ctx context.Context, user string) (string, error)
	Stderr io.Writer
}

const (
	maxAttrLines = 64
	maxAttrBytes = 64 << 10
)

// readAttrs reads git's "key=value" lines, up to a blank line or the end of input. It
// reads a bounded amount, whatever is sent.
func readAttrs(in io.Reader) map[string]string {
	attrs := map[string]string{}
	sc := bufio.NewScanner(io.LimitReader(in, maxAttrBytes))
	for n := 0; n < maxAttrLines && sc.Scan(); n++ {
		line := strings.TrimRight(sc.Text(), "\r")
		if line == "" {
			break
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			attrs[k] = v
		}
	}
	return attrs
}

// Run answers one call of git's credential protocol (see gitcredentials(7)). action is
// what git passed: "get", "store" or "erase".
//
// Only "get" does anything. For a github.com repository that a rule (or a username
// written in its address) ties to a connection, it answers with that account's login and
// token. For anything else it says nothing, so git asks the next helper, as it would
// without devdeck. "store" and "erase" are ignored: devdeck keeps no credentials. It
// never fails git: a problem is a note on stderr and an empty answer.
func Run(ctx context.Context, action string, in io.Reader, out io.Writer, d Deps) error {
	attrs := readAttrs(in)
	if action != "get" || attrs["protocol"] != "https" || !strings.EqualFold(attrs["host"], Host) {
		return nil
	}
	note := func(format string, a ...any) {
		if d.Stderr != nil {
			_, _ = fmt.Fprintf(d.Stderr, "devdeck: "+format+"\n", a...)
		}
	}
	cfg, err := d.Config()
	if err != nil {
		note("couldn't read the git accounts: %v", err)
		return nil
	}
	rm := Remote{Host: Host, User: attrs["username"]}
	if parts := strings.Split(strings.Trim(attrs["path"], "/"), "/"); len(parts) >= 2 {
		rm.Owner, rm.Repo = parts[0], strings.TrimSuffix(parts[1], ".git")
	}
	cn, ok := cfg.ConnectionFor(rm)
	if !ok {
		return nil
	}
	token, err := d.Token(ctx, cn.User)
	if err != nil {
		note("%v", err)
		return nil
	}
	if token == "" || strings.ContainsAny(token, "\r\n") {
		note("the token of %s isn't usable", cn.User)
		return nil
	}
	_, err = fmt.Fprintf(out, "username=%s\npassword=%s\n", cn.User, token)
	return err
}

// newGH makes the gh the helper asks for tokens. Tests replace it.
var newGH = func() *GH { return NewGH("") }

// Command is `devdeck git-credential [--data-dir <folder>] <get|store|erase>`: it reads the
// configuration from devdeck's data folder (the one named, else the usual one), asks gh for
// tokens, and answers on out. It returns the exit code.
func Command(args []string, in io.Reader, out, errOut io.Writer, getenv func(string) string) int {
	dataDir := ""
	if len(args) >= 3 && args[0] == "--data-dir" {
		dataDir, args = args[1], args[2:]
	}
	if len(args) != 1 || (args[0] != "get" && args[0] != "store" && args[0] != "erase") {
		_, _ = fmt.Fprintln(errOut, "usage: devdeck git-credential [--data-dir <folder>] get|store|erase (git calls this; see `devdeck help`)")
		return 2
	}
	if dataDir != "" {
		env := getenv
		getenv = func(k string) string {
			if k == "DEVDECK_DATA_DIR" {
				return dataDir
			}
			return env(k)
		}
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		_, _ = fmt.Fprintf(errOut, "devdeck: %v\n", err)
		return 0 // never fail git: the next helper may know
	}
	store := &Store{Dir: cfg.DataDir}
	gh := newGH()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_ = Run(ctx, args[0], in, out, Deps{Config: store.Load, Token: gh.Token, Stderr: errOut})
	return 0
}
