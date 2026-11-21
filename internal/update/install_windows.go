//go:build windows

package update

import (
	"os/exec"
	"syscall"
)

// canInstall is a var so tests on other systems can act as Windows.
var canInstall = true

// Windows process flags: the installer must outlive devdeck, which quits right after starting it.
const (
	createNewProcessGroup = 0x00000200
	detachedProcess       = 0x00000008
)

// startInstaller runs the Inno Setup installer without its wizard, closing devdeck if it is still
// open and starting it again afterwards (installer/devdeck.iss), and returns at once.
func startInstaller(installer, logFile string) error {
	cmd := exec.Command(installer, // nosemgrep: go.lang.security.audit.dangerous-exec-command.dangerous-exec-command -- installer is the file Install saved in devdeck's own updates folder and just matched against the release's SHA256SUMS; the arguments are fixed
		"/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART",
		"/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS",
		"/LOG="+logFile,
	)
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: createNewProcessGroup | detachedProcess}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}
