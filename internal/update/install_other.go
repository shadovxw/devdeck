//go:build !windows

package update

import "errors"

// The installer is a Windows program; elsewhere devdeck only says that a new version is out.
var canInstall = false

func startInstaller(string, string) error {
	return errors.New("updates install by themselves on Windows only")
}
