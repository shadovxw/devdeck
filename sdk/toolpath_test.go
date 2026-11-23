package sdk

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestToolPath(t *testing.T) {
	// a tool on the PATH is run by its name
	if got := ToolPath("go"); got != "go" {
		t.Errorf("go = %q", got)
	}
	// a tool nowhere stays its name, so it fails as "not found"
	if got := ToolPath("no-such-tool-devdeck"); got != "no-such-tool-devdeck" {
		t.Errorf("missing = %q", got)
	}
	if _, ok := PathWith("no-such-tool-devdeck", "go"); ok {
		t.Error("nothing to add, PATH stays as it is")
	}
}

func TestToolPathFindsAnInstallerPlaceMissingFromPATH(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the installer places checked here are Windows ones")
	}
	base := t.TempDir()
	dir := filepath.Join(base, "Amazon", "SessionManagerPlugin", "bin")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(dir, "session-manager-plugin.exe")
	if err := os.WriteFile(exe, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("ProgramFiles", base)
	t.Setenv("ProgramFiles(x86)", "")
	t.Setenv("LOCALAPPDATA", "")
	t.Setenv("PATH", t.TempDir()) // the plugin isn't on it
	if got := ToolPath("session-manager-plugin"); got != exe {
		t.Errorf("found %q, want %q", got, exe)
	}
	path, ok := PathWith("session-manager-plugin")
	if !ok || !strings.HasPrefix(path, dir+string(os.PathListSeparator)) {
		t.Errorf("PATH = %q, %v", path, ok)
	}
}
