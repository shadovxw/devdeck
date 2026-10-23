package remote

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommand(t *testing.T) {
	srv := server(t, &runner{rounds: [][]string{{"2026-10-22T03:30:00Z hello"}}})
	ctx := context.Background()
	env := func(k string) string {
		if k == "DEVDECK_AGENT_TOKEN" {
			return token
		}
		return ""
	}
	noEnv := func(string) string { return "" }
	run := func(getenv func(string) string, args ...string) (int, string, string) {
		var out, errOut bytes.Buffer
		code := Command(ctx, args, &out, &errOut, getenv)
		return code, out.String(), errOut.String()
	}

	if code, out, _ := run(env, "info", "--url", srv.URL); code != 0 || !strings.Contains(out, "agent 9.9.9 (API 1)") || !strings.Contains(out, "apps") {
		t.Errorf("info: %d %q", code, out)
	}
	if code, out, _ := run(env, "services", "--url", srv.URL, "--stack", "apps"); code != 0 || !strings.Contains(out, "SERVICE") || !strings.Contains(out, "healthy") {
		t.Errorf("services: %d %q", code, out)
	}
	if code, out, _ := run(env, "compose", "--url", srv.URL, "--stack", "apps"); code != 0 || !strings.Contains(out, "${API_IMAGE}") {
		t.Errorf("compose: %d %q", code, out)
	}
	// the token can come from a file
	file := filepath.Join(t.TempDir(), "token")
	if err := os.WriteFile(file, []byte(token+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if code, _, errOut := run(noEnv, "info", "--url", srv.URL, "--token-file", file); code != 0 {
		t.Errorf("token from a file: %d %q", code, errOut)
	}

	for name, args := range map[string][]string{
		"no command":     nil,
		"an unknown one": {"reboot", "--url", srv.URL, "--stack", "apps"},
		"no stack":       {"services", "--url", srv.URL},
		"a bad flag":     {"info", "--nope"},
	} {
		if code, _, _ := run(env, args...); code != 2 {
			t.Errorf("%s: code %d", name, code)
		}
	}
	if code, _, errOut := run(noEnv, "info", "--url", srv.URL); code != 2 || !strings.Contains(errOut, "no token") {
		t.Errorf("no token: %d %q", code, errOut)
	}
	if code, _, errOut := run(env, "services", "--url", srv.URL, "--stack", "nope"); code != 1 || !strings.Contains(errOut, "no such stack") {
		t.Errorf("an unknown stack: %d %q", code, errOut)
	}
}
