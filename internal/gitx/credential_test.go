package gitx

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"
)

// deps answers tokens from a fixed table and records who was asked.
func testDeps(cfg Config, asked *[]string, stderr *bytes.Buffer) Deps {
	return Deps{
		Config: func() (Config, error) { return cfg, nil },
		Token: func(_ context.Context, user string) (string, error) {
			*asked = append(*asked, user)
			if user == "no-token" {
				return "", errors.New("no token for no-token: gh auth token: no account")
			}
			if user == "bad-token" {
				return "line1\nline2", nil
			}
			return "tok-" + user, nil
		},
		Stderr: stderr,
	}
}

func get(t *testing.T, cfg Config, input string) (out, errOut string, asked []string) {
	t.Helper()
	var o, e bytes.Buffer
	if err := Run(context.Background(), "get", strings.NewReader(input), &o, testDeps(cfg, &asked, &e)); err != nil {
		t.Fatal(err)
	}
	return o.String(), e.String(), asked
}

func TestHelperAnswersForTheRepoItsRulePicks(t *testing.T) {
	out, errOut, asked := get(t, sample(), "protocol=https\nhost=github.com\npath=acme/api.git\n\n")
	if out != "username=office-dev\npassword=tok-office-dev\n" || errOut != "" || len(asked) != 1 || asked[0] != "office-dev" {
		t.Errorf("out=%q err=%q asked=%v", out, errOut, asked)
	}
	out, _, _ = get(t, sample(), "protocol=https\nhost=github.com\npath=me-personal/devdeck.git\n\n")
	if out != "username=me-personal\npassword=tok-me-personal\n" {
		t.Errorf("personal: %q", out)
	}
	// carriage returns and no final blank line are fine
	out, _, _ = get(t, sample(), "protocol=https\r\nhost=github.com\r\npath=acme/api")
	if !strings.HasPrefix(out, "username=office-dev") {
		t.Errorf("crlf: %q", out)
	}
}

func TestHelperPrefersAUsernameInTheAddress(t *testing.T) {
	// the address says me-personal (git sends it as username), though the rule says office
	out, _, _ := get(t, sample(), "protocol=https\nhost=github.com\npath=acme/api.git\nusername=me-personal\n\n")
	if !strings.HasPrefix(out, "username=me-personal\n") {
		t.Errorf("a username that names a connection wins: %q", out)
	}
	// a username that is nobody's falls back to the rule
	out, _, _ = get(t, sample(), "protocol=https\nhost=github.com\npath=acme/api.git\nusername=stranger\n\n")
	if !strings.HasPrefix(out, "username=office-dev\n") {
		t.Errorf("an unknown username: %q", out)
	}
	// without a path (useHttpPath not set), the username alone can still decide
	out, _, _ = get(t, sample(), "protocol=https\nhost=github.com\nusername=office-dev\n\n")
	if !strings.HasPrefix(out, "username=office-dev\n") {
		t.Errorf("username without a path: %q", out)
	}
}

func TestHelperStaysQuietWhenItDoesNotKnow(t *testing.T) {
	for name, input := range map[string]string{
		"a repo no rule matches": "protocol=https\nhost=github.com\npath=elsewhere/thing.git\n\n",
		"no path and no user":    "protocol=https\nhost=github.com\n\n",
		"another host":           "protocol=https\nhost=gitlab.com\npath=acme/api.git\n\n",
		"plain http":             "protocol=http\nhost=github.com\npath=acme/api.git\n\n",
		"nothing":                "",
	} {
		out, errOut, asked := get(t, sample(), input)
		if out != "" || errOut != "" || len(asked) != 0 {
			t.Errorf("%s: out=%q err=%q asked=%v (it must say nothing and ask for no token)", name, out, errOut, asked)
		}
	}
}

func TestHelperIgnoresStoreAndErase(t *testing.T) {
	for _, action := range []string{"store", "erase", "bogus"} {
		var o bytes.Buffer
		var asked []string
		var e bytes.Buffer
		if err := Run(context.Background(), action, strings.NewReader("protocol=https\nhost=github.com\npath=acme/api.git\nusername=u\npassword=p\n\n"), &o, testDeps(sample(), &asked, &e)); err != nil {
			t.Fatal(err)
		}
		if o.Len() != 0 || len(asked) != 0 {
			t.Errorf("%s: wrote %q and asked %v", action, o.String(), asked)
		}
	}
}

func TestHelperNeverFailsGit(t *testing.T) {
	// a connection whose gh account has no token
	cfg := sample()
	cfg.Connections = append(cfg.Connections, Connection{ID: "gone", User: "no-token"}, Connection{ID: "odd", User: "bad-token"})
	cfg.Rules = append(cfg.Rules, Rule{Match: "github.com/lost/*", Connection: "gone"}, Rule{Match: "github.com/odd/*", Connection: "odd"})
	out, errOut, _ := get(t, cfg, "protocol=https\nhost=github.com\npath=lost/x.git\n\n")
	if out != "" || !strings.Contains(errOut, "no token for no-token") {
		t.Errorf("a missing token: out=%q err=%q", out, errOut)
	}
	out, errOut, _ = get(t, cfg, "protocol=https\nhost=github.com\npath=odd/x.git\n\n")
	if out != "" || !strings.Contains(errOut, "isn't usable") || strings.Contains(errOut, "line1") {
		t.Errorf("an unusable token: out=%q err=%q (and the token must not be echoed)", out, errOut)
	}
	// an unreadable configuration
	var o, e bytes.Buffer
	err := Run(context.Background(), "get", strings.NewReader("protocol=https\nhost=github.com\npath=acme/api\n\n"), &o,
		Deps{Config: func() (Config, error) { return Config{}, errors.New("broken file") }, Stderr: &e})
	if err != nil || o.Len() != 0 || !strings.Contains(e.String(), "broken file") {
		t.Errorf("a broken configuration: err=%v out=%q stderr=%q", err, o.String(), e.String())
	}
}

func TestReadAttrsIsBounded(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 500; i++ {
		b.WriteString("k" + strings.Repeat("x", 10) + "=v\n")
	}
	if got := readAttrs(strings.NewReader(b.String())); len(got) > maxAttrLines {
		t.Errorf("read %d attributes, the limit is %d", len(got), maxAttrLines)
	}
	got := readAttrs(strings.NewReader("a=1\nb=c=d\nnovalue\n\nafter=blank\n"))
	if got["a"] != "1" || got["b"] != "c=d" || got["after"] != "" || len(got) != 2 {
		t.Errorf("attrs = %v", got)
	}
}

func TestCommand(t *testing.T) {
	var out, errOut bytes.Buffer
	if code := Command([]string{"get", "extra"}, strings.NewReader(""), &out, &errOut, func(string) string { return "" }); code != 2 || !strings.Contains(errOut.String(), "usage") {
		t.Errorf("a wrong call: code %d, %q", code, errOut.String())
	}
	if code := Command(nil, strings.NewReader(""), &out, &errOut, func(string) string { return "" }); code != 2 {
		t.Errorf("no action: code %d", code)
	}

	// a real run against a data folder, with gh replaced
	dir := t.TempDir()
	if err := (&Store{Dir: dir}).Save(sample()); err != nil {
		t.Fatal(err)
	}
	old := newGH
	defer func() { newGH = old }()
	newGH = func() *GH {
		c := &canned{answers: map[string]string{"auth token --hostname github.com --user office-dev": "tok-from-gh\n"}}
		return NewGHWith("gh", c.run)
	}
	getenv := func(k string) string {
		if k == "DEVDECK_DATA_DIR" {
			return dir
		}
		return ""
	}
	out.Reset()
	errOut.Reset()
	if code := Command([]string{"get"}, strings.NewReader("protocol=https\nhost=github.com\npath=acme/api.git\n\n"), &out, &errOut, getenv); code != 0 || out.String() != "username=office-dev\npassword=tok-from-gh\n" {
		t.Errorf("get: code %d out %q err %q", code, out.String(), errOut.String())
	}
	out.Reset()
	if code := Command([]string{"store"}, strings.NewReader("protocol=https\nhost=github.com\n\n"), &out, &errOut, getenv); code != 0 || out.Len() != 0 {
		t.Errorf("store: code %d out %q", code, out.String())
	}
}
