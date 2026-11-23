package agent

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCommand(t *testing.T) {
	ctx := context.Background()
	var out, errOut bytes.Buffer
	if code := Command(ctx, []string{"token"}, &out, &errOut, "1"); code != 0 || len(strings.TrimSpace(out.String())) != 64 {
		t.Errorf("token: %d %q", code, out.String())
	}
	out.Reset()
	if code := Command(ctx, []string{"help"}, &out, &errOut, "1"); code != 0 || !strings.Contains(out.String(), "devdeck agent check") {
		t.Errorf("help: %d %q", code, out.String())
	}
	if code := Command(ctx, []string{"bogus"}, &out, &errOut, "1"); code != 2 {
		t.Errorf("an unknown command: %d", code)
	}

	dir := t.TempDir()
	tokenFile := filepath.Join(dir, "token")
	if err := os.WriteFile(tokenFile, []byte(testToken), 0o600); err != nil {
		t.Fatal(err)
	}
	cfgFile := filepath.Join(dir, "agent.yaml")
	cfg := "token_file: " + filepath.ToSlash(tokenFile) + "\nstacks:\n  - id: apps\n    name: Applications\n    dir: /srv/acme\n    files: [compose.apps.yml]\n    allow_write: true\n"
	if err := os.WriteFile(cfgFile, []byte(cfg), 0o600); err != nil {
		t.Fatal(err)
	}
	out.Reset()
	errOut.Reset()
	if code := Command(ctx, []string{"check", "--config", cfgFile}, &out, &errOut, "1"); code != 0 || !strings.Contains(out.String(), "apps") || !strings.Contains(out.String(), "writes allowed") {
		t.Errorf("check: %d %q %q", code, out.String(), errOut.String())
	}
	errOut.Reset()
	if code := Command(ctx, []string{"check", "--config", filepath.Join(dir, "none.yaml")}, &out, &errOut, "1"); code != 1 || errOut.Len() == 0 {
		t.Errorf("a missing config: %d %q", code, errOut.String())
	}
	if err := os.WriteFile(tokenFile, []byte("short"), 0o600); err != nil {
		t.Fatal(err)
	}
	errOut.Reset()
	if code := Command(ctx, []string{"check", "--config", cfgFile}, &out, &errOut, "1"); code != 1 || !strings.Contains(errOut.String(), "too short") {
		t.Errorf("a bad token: %d %q", code, errOut.String())
	}
}
