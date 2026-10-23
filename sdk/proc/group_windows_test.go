//go:build windows

package proc

import (
	"os/exec"
	"testing"

	"golang.org/x/sys/windows"
)

func TestCommandsGetNoConsoleWindow(t *testing.T) {
	g, err := newGroup()
	if err != nil {
		t.Fatal(err)
	}
	defer g.close()
	cmd := exec.Command("git", "--version")
	g.configure(cmd)
	if cmd.SysProcAttr == nil || cmd.SysProcAttr.CreationFlags&windows.CREATE_NO_WINDOW == 0 {
		t.Fatalf("a command must start with CREATE_NO_WINDOW: %+v", cmd.SysProcAttr)
	}
	if cmd.SysProcAttr.HideWindow {
		t.Error("HideWindow would hide a command's own windows (the folder picker's dialog)")
	}
}
