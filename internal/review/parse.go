package review

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// maxFindings caps how many findings a result lists.
const maxFindings = 50

// finding matches the "path/file.go:12:3: message" shape most tools print. It is a guess at structure, so
// the output is kept too.
var finding = regexp.MustCompile(`^\s*(?:\./)?([A-Za-z0-9_@.\\/-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?:?\s+(.+?)\s*$`)

// Findings pulls "file:line: message" lines out of a tool's output.
func Findings(lines []string) []Finding {
	var out []Finding
	for _, l := range lines {
		m := finding.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		n, _ := strconv.Atoi(m[2])
		out = append(out, Finding{Path: strings.ReplaceAll(m[1], `\`, "/"), Line: n, Message: m[3]})
		if len(out) == maxFindings {
			break
		}
	}
	return out
}

// goOK matches `ok  	github.com/x/y	0.5s` lines of go test.
var goOK = regexp.MustCompile(`^ok\s`)

// Summary says how a run went in one line.
func Summary(tool string, status Status, findings []Finding, lines []string) string {
	switch status {
	case StatusPass:
		if tool == "tests" {
			n := 0
			for _, l := range lines {
				if goOK.MatchString(l) {
					n++
				}
			}
			if n > 0 {
				return fmt.Sprintf("%d %s passed", n, plural(n, "package", "packages"))
			}
			return "All passed"
		}
		return "No problems found"
	case StatusFail:
		if n := len(findings); n > 0 {
			f := findings[0]
			return fmt.Sprintf("%d %s, the first at %s:%d", n, plural(n, "problem", "problems"), f.Path, f.Line)
		}
		if last := lastLine(lines); last != "" {
			return cut(last, 140)
		}
		return "Failed"
	}
	return ""
}

func plural(n int, one, many string) string {
	if n == 1 {
		return one
	}
	return many
}

// lastLine is the last line that says something.
func lastLine(lines []string) string {
	for i := len(lines) - 1; i >= 0; i-- {
		if s := strings.TrimSpace(lines[i]); s != "" {
			return s
		}
	}
	return ""
}

func cut(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
}
