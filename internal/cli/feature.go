package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/shadovxw/devdeck/internal/feature"
	"github.com/shadovxw/devdeck/internal/workspace"
)

const featureUsage = `Usage:
  devdeck feature check [--json] [--workspace <folder or name>] <feature.yaml or plan folder>
                              check a feature file the way devdeck does and list the problems
                              with line numbers (exit 1 when there are errors). With --workspace
                              it also checks that the repos and layers it names exist there.
`

// Feature runs `devdeck feature ...` and returns the exit code: 0 done, 1 errors found, 2 wrong
// usage. args excludes "feature". It reads files and never needs the server.
func Feature(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "check" {
		_, _ = io.WriteString(stderr, featureUsage)
		return exitUsage
	}
	fs := flag.NewFlagSet("feature check", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "print the result as JSON")
	ws := fs.String("workspace", "", "a workspace folder or name, to check the repos and layers against")
	var pos []string
	rest := args[1:]
	for len(rest) > 0 {
		if err := fs.Parse(rest); err != nil {
			return exitUsage
		}
		if fs.NArg() == 0 {
			break
		}
		pos = append(pos, fs.Arg(0))
		rest = fs.Args()[1:]
	}
	if len(pos) != 1 {
		_, _ = io.WriteString(stderr, featureUsage)
		return exitUsage
	}

	file := pos[0]
	if fi, err := os.Stat(file); err == nil && fi.IsDir() {
		file = filepath.Join(file, feature.FileName)
	}
	data, err := os.ReadFile(file)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "devdeck: %s can't be read: %v\n", file, err)
		return exitFail
	}

	var repos []workspace.Repo
	if *ws != "" {
		dir, err := workspaceFolder(*ws, getenv)
		if err != nil {
			_, _ = fmt.Fprintln(stderr, "devdeck:", err)
			return exitFail
		}
		l, err := workspace.LoadDir(dir, workspace.Options{})
		if err != nil || l.Workspace == nil {
			_, _ = fmt.Fprintf(stderr, "devdeck: the workspace in %s can't be read\n", dir)
			return exitFail
		}
		repos = l.Workspace.Repos
		if repos == nil {
			repos = []workspace.Repo{}
		}
	}

	f, issues := workspace.LoadFeature(filepath.Base(file), data, repos)
	failed := workspace.HasErrors(issues)
	if issues == nil {
		issues = []workspace.Issue{}
	}
	prs := 0
	if f != nil {
		prs = len(f.PRs)
	}

	if *asJSON {
		b, _ := json.MarshalIndent(map[string]any{
			"file": file, "valid": !failed, "prs": prs, "cross_checked": repos != nil, "issues": issues,
		}, "", "  ")
		_, _ = fmt.Fprintln(stdout, string(b))
	} else {
		printIssues(stdout, issues)
		note := ""
		if repos == nil {
			note = " (repos and layers not checked: add --workspace)"
		}
		_, _ = fmt.Fprintf(stdout, "%s: %d PRs, %d errors, %d warnings%s\n", file, prs,
			workspace.Count(issues, workspace.SeverityError), workspace.Count(issues, workspace.SeverityWarning), note)
	}
	if failed {
		return exitFail
	}
	return exitOK
}

// printIssues lists problems one per line: severity, file and line, the message and the setting.
func printIssues(w io.Writer, issues []workspace.Issue) {
	for _, is := range issues {
		at := is.File
		if is.Line > 0 {
			at = fmt.Sprintf("%s:%d", is.File, is.Line)
		}
		path := ""
		if is.Path != "" {
			path = " (" + is.Path + ")"
		}
		_, _ = fmt.Fprintf(w, "%s %s: %s%s\n", is.Severity, at, is.Message, path)
	}
}
