// Package scripts is a project's own commands, run from a button (dev-plans/2026-11-22-projects
// §7, PJ4): named lists of steps, once or for every repo. A step is a built-in git step (fetch,
// pull, checkout, status), whose result devdeck reads as data, or a command run in the repo.
//
// Scripts come from three places: devdeck's starter scripts, the project's file (scripts:), and
// what each repo already has (package.json scripts, Makefile targets), which are offered without
// being copied anywhere.
package scripts

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/shadovxw/devdeck/internal/gitx"
)

// The git steps a script can take.
const (
	GitFetch    = "fetch"
	GitPull     = "pull"
	GitCheckout = "checkout"
	GitStatus   = "status"
)

// Where a script comes from.
const (
	SourceBuiltIn  = "built-in"
	SourceFile     = "file"
	SourcePackage  = "package.json"
	SourceMakefile = "Makefile"
)

// Step is one thing a script does: a git step or a command.
type Step struct {
	// Git is fetch, pull, checkout or status.
	Git string `yaml:"git,omitempty" json:"git,omitempty"`
	// Branch is the branch a checkout switches to.
	Branch string `yaml:"branch,omitempty" json:"branch,omitempty"`
	// Run is a command run in the repo, without a shell (as stack services are).
	Run string `yaml:"run,omitempty" json:"run,omitempty"`
}

// Script is a named list of steps.
type Script struct {
	ID    string `yaml:"id" json:"id"`
	Title string `yaml:"title,omitempty" json:"title,omitempty"`
	// ForEach is "repo" to run the steps in every repo of the project; empty runs them once, in
	// Repo (or in each repo, for a script with only git steps).
	ForEach string `yaml:"for_each,omitempty" json:"for_each,omitempty"`
	// Repo is the one repo a script runs in (the found ones: npm scripts, Makefile targets).
	Repo  string `yaml:"repo,omitempty" json:"repo,omitempty"`
	Steps []Step `yaml:"steps" json:"steps"`
	// Source says where the script comes from; it is never read from the file.
	Source string `yaml:"-" json:"source"`
}

// Label is a step as a few words: "fetch", "checkout dev", "npm test".
func (s Step) Label() string {
	switch {
	case s.Git == GitCheckout:
		return "checkout " + s.Branch
	case s.Git != "":
		return s.Git
	default:
		return s.Run
	}
}

// changes is whether the step can change the repo's files: everything but fetch and status.
func (s Step) changes() bool { return s.Git != GitFetch && s.Git != GitStatus }

// Writes is whether running the script can change files, so it asks before it runs.
func (s Script) Writes() bool {
	for _, st := range s.Steps {
		if st.changes() {
			return true
		}
	}
	return false
}

// Name is the title, or the id when there is none.
func (s Script) Name() string {
	if s.Title != "" {
		return s.Title
	}
	return s.ID
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._:-]{0,99}$`)

// Validate says what is wrong with a script, if anything.
func (s Script) Validate() error {
	if !idPattern.MatchString(s.ID) {
		return fmt.Errorf("script %q: the id must be lower case letters, digits, dots, colons and dashes", s.ID)
	}
	if s.ForEach != "" && s.ForEach != "repo" {
		return fmt.Errorf("script %q: for_each can only be repo", s.ID)
	}
	if len(s.Steps) == 0 {
		return fmt.Errorf("script %q has no steps", s.ID)
	}
	for i, st := range s.Steps {
		if (st.Git == "") == (st.Run == "") {
			return fmt.Errorf("script %q, step %d: give either git or run", s.ID, i+1)
		}
		switch st.Git {
		case "", GitFetch, GitPull, GitStatus:
		case GitCheckout:
			if !gitx.SafeRef(st.Branch) {
				return fmt.Errorf("script %q, step %d: checkout needs a branch name", s.ID, i+1)
			}
		default:
			return fmt.Errorf("script %q, step %d: git can be fetch, pull, checkout or status", s.ID, i+1)
		}
	}
	return nil
}

// BuiltIns are devdeck's starter scripts, offered on every project.
func BuiltIns() []Script {
	return []Script{
		{ID: "update-all", Title: "Update everything", ForEach: "repo", Steps: []Step{{Git: GitFetch}, {Git: GitPull}}, Source: SourceBuiltIn},
		{ID: "sync-dev", Title: "Switch every repo to dev", ForEach: "repo", Steps: []Step{{Git: GitFetch}, {Git: GitCheckout, Branch: "dev"}, {Git: GitPull}}, Source: SourceBuiltIn},
		{ID: "status-all", Title: "What changed?", ForEach: "repo", Steps: []Step{{Git: GitStatus}}, Source: SourceBuiltIn},
	}
}

// Found are the scripts a repo already has: its package.json scripts (run with npm) and its
// Makefile targets (run with make). A file that can't be read just gives none.
func Found(repo, dir string) []Script {
	var out []Script
	if raw, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		var pkg struct {
			Scripts map[string]string `json:"scripts"`
		}
		if json.Unmarshal(raw, &pkg) == nil {
			names := make([]string, 0, len(pkg.Scripts))
			for name := range pkg.Scripts {
				names = append(names, name)
			}
			sort.Strings(names)
			for _, name := range names {
				if !safeName(name) {
					continue
				}
				out = append(out, Script{ID: "npm:" + repo + ":" + strings.ToLower(name), Title: "npm run " + name, Repo: repo, Steps: []Step{{Run: "npm run " + name}}, Source: SourcePackage})
			}
		}
	}
	if raw, err := os.ReadFile(filepath.Join(dir, "Makefile")); err == nil {
		for _, name := range makeTargets(string(raw)) {
			out = append(out, Script{ID: "make:" + repo + ":" + strings.ToLower(name), Title: "make " + name, Repo: repo, Steps: []Step{{Run: "make " + name}}, Source: SourceMakefile})
		}
	}
	return out
}

var (
	targetLine = regexp.MustCompile(`^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:([^=]|$)`)
	plainName  = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`)
)

// safeName is a script or target name that is safe to put on a command line as one word.
func safeName(name string) bool { return plainName.MatchString(name) }

// makeTargets reads the targets a Makefile names at the start of a line, in order, without
// special ones (.PHONY) and pattern rules.
func makeTargets(text string) []string {
	var out []string
	seen := map[string]bool{}
	for _, line := range strings.Split(text, "\n") {
		m := targetLine.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil || strings.HasPrefix(m[1], ".") || seen[m[1]] || !safeName(m[1]) {
			continue
		}
		seen[m[1]] = true
		out = append(out, m[1])
	}
	return out
}

// ErrNotFound is returned for a script the project doesn't have.
var ErrNotFound = errors.New("no such script")

// Find returns the script with id from list.
func Find(list []Script, id string) (Script, error) {
	for _, s := range list {
		if s.ID == id {
			return s, nil
		}
	}
	return Script{}, ErrNotFound
}
