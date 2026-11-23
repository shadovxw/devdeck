package sdk

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// knownPlaces are where some installers put a tool, for when it is installed but the
// PATH devdeck was started with doesn't have it yet (it was installed while devdeck
// ran, or the terminal that started devdeck was open from before).
func knownPlaces(binary string) []string {
	switch runtime.GOOS {
	case "windows":
		var out []string
		for _, base := range []string{os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")} {
			if base == "" {
				continue
			}
			switch binary {
			case "session-manager-plugin":
				out = append(out, filepath.Join(base, "Amazon", "SessionManagerPlugin", "bin", "session-manager-plugin.exe"))
			case "aws":
				out = append(out, filepath.Join(base, "Amazon", "AWSCLIV2", "aws.exe"))
			}
		}
		return out
	default:
		switch binary {
		case "session-manager-plugin":
			return []string{"/usr/local/sessionmanagerplugin/bin/session-manager-plugin", "/usr/local/bin/session-manager-plugin"}
		case "aws":
			return []string{"/usr/local/bin/aws", "/usr/local/aws-cli/v2/current/bin/aws"}
		}
	}
	return nil
}

// ToolPath is the program to run for binary: the name itself when it is on the PATH,
// else the place its installer puts it when that exists, else the name (which then
// fails as "not found" as it would have).
func ToolPath(binary string) string {
	if _, err := exec.LookPath(binary); err == nil {
		return binary
	}
	for _, p := range knownPlaces(binary) {
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p
		}
	}
	return binary
}

// PathWith is a PATH value that also has the folder of each binary that isn't on the
// PATH but was found where its installer puts it. ok is false when nothing had to be
// added, so the caller can leave PATH alone.
func PathWith(binaries ...string) (path string, ok bool) {
	path = os.Getenv("PATH")
	for _, b := range binaries {
		if p := ToolPath(b); p != b {
			path = filepath.Dir(p) + string(os.PathListSeparator) + path
			ok = true
		}
	}
	return path, ok
}
