package cli

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/shadovxw/devdeck/internal/config"
	"github.com/shadovxw/devdeck/internal/workspace"
)

// Offline commands: they read files and never need the server to be running.

const workspaceUsage = `Usage:
  devdeck workspace check [--json] <folder or name>
                              check a workspace's files the way devdeck does and list the
                              problems with file and line (exit 1 when there are errors).
                              A name is a folder in your workspaces folder.
  devdeck schema <workspace|stack|flow>
                              print the JSON Schema of one kind of file
`

// WorkspaceCommands are the words that start the offline commands.
var WorkspaceCommands = []string{"workspace", "schema"}

// Workspace runs `devdeck workspace ...` and returns the exit code: 0 done, 1 errors found,
// 2 wrong usage. args excludes "workspace".
func Workspace(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] != "check" {
		_, _ = io.WriteString(stderr, workspaceUsage)
		return exitUsage
	}
	fs := flag.NewFlagSet("workspace check", flag.ContinueOnError)
	fs.SetOutput(stderr)
	asJSON := fs.Bool("json", false, "print the result as JSON")
	rest := args[1:]
	// The flag may come before or after the folder.
	var pos []string
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
		_, _ = io.WriteString(stderr, workspaceUsage)
		return exitUsage
	}

	dir, err := workspaceFolder(pos[0], getenv)
	if err != nil {
		_, _ = fmt.Fprintln(stderr, "devdeck:", err)
		return exitFail
	}
	l, err := workspace.LoadDir(dir, workspace.Options{CheckPaths: true})
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "devdeck: %s can't be read: %v\n", dir, err)
		return exitFail
	}
	failed := workspace.HasErrors(l.Issues)
	if l.Issues == nil {
		l.Issues = []workspace.Issue{}
	}

	if *asJSON {
		b, _ := json.MarshalIndent(map[string]any{
			"folder": dir, "valid": !failed,
			"stacks": len(l.Stacks), "flows": len(l.Flows), "issues": l.Issues,
		}, "", "  ")
		_, _ = fmt.Fprintln(stdout, string(b))
	} else {
		for _, is := range l.Issues {
			at := is.File
			if is.Line > 0 {
				at = fmt.Sprintf("%s:%d", is.File, is.Line)
			}
			path := ""
			if is.Path != "" {
				path = " (" + is.Path + ")"
			}
			_, _ = fmt.Fprintf(stdout, "%s %s: %s%s\n", is.Severity, at, is.Message, path)
		}
		_, _ = fmt.Fprintf(stdout, "%s: %d stacks, %d flows, %d errors, %d warnings\n", dir, len(l.Stacks), len(l.Flows),
			workspace.Count(l.Issues, workspace.SeverityError), workspace.Count(l.Issues, workspace.SeverityWarning))
	}
	if failed {
		return exitFail
	}
	return exitOK
}

// workspaceFolder turns the argument into a folder: a path that exists is used as it is, a
// bare name is looked up in the workspaces folder.
func workspaceFolder(arg string, getenv func(string) string) (string, error) {
	if fi, err := os.Stat(arg); err == nil && fi.IsDir() {
		return filepath.Abs(arg)
	}
	if strings.ContainsAny(arg, `/\`) {
		return "", fmt.Errorf("%s isn't a folder", arg)
	}
	cfg, err := config.Load(getenv)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(cfg.WorkspacesDir, arg)
	if fi, err := os.Stat(dir); err != nil || !fi.IsDir() {
		return "", fmt.Errorf("no workspace named %q in %s", arg, cfg.WorkspacesDir)
	}
	return dir, nil
}

// Schema runs `devdeck schema <kind>`: it prints the JSON Schema, for editors and for
// whoever writes a workspace file. args excludes "schema".
func Schema(args []string, stdout, stderr io.Writer) int {
	if len(args) != 1 {
		_, _ = io.WriteString(stderr, workspaceUsage)
		return exitUsage
	}
	switch k := workspace.Kind(args[0]); k {
	case workspace.KindWorkspace, workspace.KindStack, workspace.KindFlow:
		b, err := workspace.SchemaJSON(k)
		if err != nil {
			_, _ = fmt.Fprintln(stderr, "devdeck: the schema can't be read:", err)
			return exitFail
		}
		_, _ = stdout.Write(b)
		return exitOK
	}
	_, _ = fmt.Fprintf(stderr, "devdeck: no schema for %q: use workspace, stack or flow\n", args[0])
	return exitUsage
}
