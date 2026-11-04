// Package review runs code-review tools on a branch and keeps what they say. A run checks the branch out
// into a folder of its own (a git worktree), runs the tool there, writes the result as a file in the plan's
// reviews/ folder, and removes the folder. The owner's own checkout is never touched.
package review

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

// Step is one command of a tool.
type Step struct {
	Program string
	Args    []string
}

// Context is what a tool's commands depend on: what the checked-out branch holds, and its refs.
type Context struct {
	// Go and Node say the checkout has a go.mod or a package.json at its root.
	Go, Node bool
	// Base and Head are the branch's base and the branch itself, as git refs. Base is empty when it doesn't exist.
	Base, Head string
}

// Tool is one review tool that runs on this machine and exits when it is done.
type Tool struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	// About says what the tool does, for a tooltip.
	About string `json:"about"`
	// Programs are every program its commands may use, so the page can say which one is missing.
	Programs []string `json:"programs"`

	// modules says an npm step needs node_modules in the checkout.
	modules bool
	steps   func(Context) []Step
}

// Steps are the commands to run for this checkout. None means the tool has nothing to check here.
func (t Tool) Steps(c Context) []Step { return t.steps(c) }

// Tools are the review tools devdeck runs, in the order the page lists them. They are the same commands
// the project's CI runs, so a result here says what CI would.
var Tools = []Tool{
	{
		ID: "tests", Name: "Tests", About: "go test, or npm test, on the branch",
		Programs: []string{"go", "npm"}, modules: true,
		steps: func(c Context) []Step {
			var s []Step
			if c.Go {
				s = append(s, Step{"go", []string{"test", "-count=1", "./..."}})
			}
			if c.Node {
				s = append(s, Step{"npm", []string{"test", "--if-present"}})
			}
			return s
		},
	},
	{
		ID: "lint", Name: "Lint", About: "golangci-lint, or the project's npm lint script",
		Programs: []string{"golangci-lint", "npm"}, modules: true,
		steps: func(c Context) []Step {
			var s []Step
			if c.Go {
				s = append(s, Step{"golangci-lint", []string{"run"}})
			}
			if c.Node {
				s = append(s, Step{"npm", []string{"run", "lint", "--if-present"}})
			}
			return s
		},
	},
	{
		ID: "semgrep", Name: "Semgrep", About: "Static analysis with the default rules",
		Programs: []string{"semgrep"},
		steps: func(Context) []Step {
			return []Step{{"semgrep", []string{"scan", "--config", "p/default", "--error", "--metrics=off"}}}
		},
	},
	{
		ID: "gitleaks", Name: "Gitleaks", About: "Looks for secrets in the commits the branch adds",
		Programs: []string{"gitleaks"},
		steps: func(c Context) []Step {
			args := []string{"detect", "--source", ".", "--redact", "--no-banner"}
			if c.Base != "" && c.Head != "" {
				args = append(args, "--log-opts", c.Base+".."+c.Head)
			} else {
				args = append(args, "--no-git")
			}
			return []Step{{"gitleaks", args}}
		},
	},
	{
		ID: "trivy", Name: "Trivy", About: "Known vulnerabilities, secrets and misconfigurations in the files",
		Programs: []string{"trivy"},
		steps: func(Context) []Step {
			return []Step{{"trivy", []string{"fs", "--scanners", "vuln,secret,misconfig", "--severity", "HIGH,CRITICAL", "--ignore-unfixed", "--exit-code", "1", "--quiet", "."}}}
		},
	},
	{
		ID: "deps", Name: "Dependencies", About: "govulncheck, or npm audit, for known vulnerabilities in dependencies",
		Programs: []string{"govulncheck", "npm"},
		steps: func(c Context) []Step {
			var s []Step
			if c.Go {
				s = append(s, Step{"govulncheck", []string{"./..."}})
			}
			if c.Node {
				s = append(s, Step{"npm", []string{"audit", "--audit-level=high", "--omit=dev"}})
			}
			return s
		},
	},
}

// ToolByID finds a tool.
func ToolByID(id string) (Tool, bool) {
	for _, t := range Tools {
		if t.ID == id {
			return t, true
		}
	}
	return Tool{}, false
}

// hints say where to get a program that isn't installed.
var hints = map[string]string{
	"go":            "Install Go: https://go.dev/dl/",
	"npm":           "Install Node.js, which brings npm: https://nodejs.org/",
	"golangci-lint": "Install golangci-lint: https://golangci-lint.run/welcome/install/",
	"semgrep":       "Install Semgrep: https://semgrep.dev/docs/getting-started/",
	"gitleaks":      "Install Gitleaks: https://github.com/gitleaks/gitleaks#installing",
	"trivy":         "Install Trivy: https://trivy.dev/latest/getting-started/installation/",
	"govulncheck":   "Install govulncheck: go install golang.org/x/vuln/cmd/govulncheck@latest",
}

// Hint says how to install a program ("" when unknown).
func Hint(program string) string { return hints[program] }

// Locate finds a program: on the PATH, then where tool managers put theirs (mise shims, go install's folder),
// since devdeck is often started from a place that doesn't have them on its PATH.
func Locate(program string) (string, bool) {
	if p, err := exec.LookPath(program); err == nil {
		return p, true
	}
	var dirs []string
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, "go", "bin"), filepath.Join(home, ".local", "share", "mise", "shims"))
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		dirs = append(dirs, filepath.Join(local, "mise", "shims"))
	}
	if gobin := os.Getenv("GOBIN"); gobin != "" {
		dirs = append(dirs, gobin)
	}
	exts := []string{""}
	if runtime.GOOS == "windows" {
		exts = []string{".exe", ".cmd", ".bat"}
	}
	for _, dir := range dirs {
		for _, ext := range exts {
			p := filepath.Join(dir, program+ext)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, true
			}
		}
	}
	return "", false
}

// Installed says which of a tool's programs are on this machine.
func Installed(t Tool, locate func(string) (string, bool)) map[string]bool {
	found := map[string]bool{}
	for _, p := range t.Programs {
		_, found[p] = locate(p)
	}
	return found
}

// Usable says whether at least one of a tool's programs is installed: if none is, there is nothing to run.
func Usable(t Tool, locate func(string) (string, bool)) bool {
	for _, ok := range Installed(t, locate) {
		if ok {
			return true
		}
	}
	return false
}
