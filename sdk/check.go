package sdk

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/shadovxw/devdeck/sdk/proc"
)

// checkTimeout is how long one version command may take. A cold start of npm or node on Windows (the
// virus scanner looks at every file) can take several seconds, and the checks of a stack run side by
// side, so a short limit made "npm: command timed out" fail a start for no real reason.
const checkTimeout = 20 * time.Second

var versionRe = regexp.MustCompile(`\d+(?:\.\d+){1,3}`)

// ParseVersion pulls the first dotted version number out of a tool's output,
// e.g. "git version 2.46.0.windows.1" gives "2.46.0.1".
func ParseVersion(output string) string {
	return versionRe.FindString(output)
}

// CompareVersions compares dotted versions numerically: -1, 0 or 1. Missing
// parts count as zero, so "2.30" equals "2.30.0".
func CompareVersions(a, b string) int {
	ap, bp := versionParts(a), versionParts(b)
	for i := 0; i < max(len(ap), len(bp)); i++ {
		var x, y int
		if i < len(ap) {
			x = ap[i]
		}
		if i < len(bp) {
			y = bp[i]
		}
		if x != y {
			if x < y {
				return -1
			}
			return 1
		}
	}
	return 0
}

func versionParts(v string) []int {
	var parts []int
	for _, s := range strings.Split(v, ".") {
		n, err := strconv.Atoi(s)
		if err != nil {
			break
		}
		parts = append(parts, n)
	}
	return parts
}

// CheckNeeds runs each Need's version command and returns the combined
// status: the first problem found, or ok with the first binary's version.
func CheckNeeds(ctx context.Context, needs []Need) ToolStatus {
	st := ToolStatus{State: StateOK, CheckedAt: time.Now()}
	for i, n := range needs {
		args := n.VersionArgs
		if len(args) == 0 {
			args = []string{"--version"}
		}
		res, err := proc.Run(ctx, proc.Cmd{Name: n.Binary, Args: args, Timeout: checkTimeout})
		switch {
		case errors.Is(err, exec.ErrNotFound):
			return ToolStatus{State: StateMissing, Detail: n.Binary + " not found on PATH", CheckedAt: time.Now()}
		case err != nil:
			return ToolStatus{State: StateDegraded, Detail: fmt.Sprintf("%s: %v", n.Binary, err), CheckedAt: time.Now()}
		case !res.OK():
			return ToolStatus{State: StateDegraded, Detail: fmt.Sprintf("%s exited with code %d", n.Binary, res.ExitCode), CheckedAt: time.Now()}
		}
		version := ParseVersion(res.Stdout + "\n" + res.Stderr)
		if i == 0 {
			st.Version = version
		}
		if n.MinVersion != "" && (version == "" || CompareVersions(version, n.MinVersion) < 0) {
			return ToolStatus{
				State:     StateOutdated,
				Version:   version,
				Detail:    fmt.Sprintf("%s %s found, %s or newer needed", n.Binary, orUnknown(version), n.MinVersion),
				CheckedAt: time.Now(),
			}
		}
	}
	return st
}

func orUnknown(v string) string {
	if v == "" {
		return "(unknown version)"
	}
	return v
}
