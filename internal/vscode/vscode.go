// Package vscode builds a project's .code-workspace file (dev-plans/2026-11-22-projects PJ7):
// every repo as a folder, the YAML schema for devdeck's own files, the recommended extensions,
// and a task for each script and run mode, so VS Code's "Run Task" lists them.
package vscode

import (
	"encoding/json"
	"path/filepath"
	"strings"
)

// Repo is a folder of the project, its path relative to the file.
type Repo struct {
	ID   string
	Path string
}

// Script is a script the tasks can run.
type Script struct {
	ID    string
	Title string
}

// Input is what the file is built from.
type Input struct {
	Workspace string // project id, passed to devdeck -w
	Name      string // shown name; the id when empty
	Repos     []Repo
	// ConfigDir is the folder that holds workspace.yaml and stacks/ (absolute). It is added as
	// a folder so devdeck's files open with their schema. Empty leaves it out.
	ConfigDir string
	Scripts   []Script
	Modes     []string // run modes (stack names)
	// SchemaBase is the server's address (http://127.0.0.1:7070); empty leaves the schemas out.
	SchemaBase string
}

type folder struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type task struct {
	Label          string   `json:"label"`
	Type           string   `json:"type"`
	Command        string   `json:"command"`
	Args           []string `json:"args"`
	Group          string   `json:"group,omitempty"`
	ProblemMatcher []string `json:"problemMatcher"`
	Detail         string   `json:"detail,omitempty"`
}

type file struct {
	Folders    []folder       `json:"folders"`
	Settings   map[string]any `json:"settings"`
	Extensions map[string]any `json:"extensions"`
	Tasks      map[string]any `json:"tasks"`
}

// FileName is the file's name: <project>.code-workspace.
func FileName(ws string) string { return ws + ".code-workspace" }

// Build returns the file's text, indented, ending in a new line. Tasks run devdeck itself
// without a shell ("process"), so no name ends up in a command line.
func Build(in Input) []byte {
	name := in.Name
	if name == "" {
		name = in.Workspace
	}
	f := file{
		Folders:    []folder{},
		Settings:   map[string]any{},
		Extensions: map[string]any{"recommendations": []string{"redhat.vscode-yaml"}},
	}
	for _, r := range in.Repos {
		p := filepath.ToSlash(r.Path)
		if p == "" {
			p = "."
		}
		f.Folders = append(f.Folders, folder{Name: r.ID, Path: p})
	}
	if in.ConfigDir != "" {
		f.Folders = append(f.Folders, folder{Name: "devdeck: " + name, Path: filepath.ToSlash(in.ConfigDir)})
	}
	if in.SchemaBase != "" {
		base := strings.TrimRight(in.SchemaBase, "/") + "/api/v1/schema/"
		f.Settings["yaml.schemas"] = map[string]any{
			base + "workspace": []string{"workspace.yaml"},
			base + "stack":     []string{"stacks/*.yaml"},
			base + "flow":      []string{"flows/*.yaml"},
			base + "feature":   []string{"feature.yaml"},
		}
	}

	tasks := []task{}
	for _, s := range in.Scripts {
		tasks = append(tasks, task{
			Label: "devdeck: " + s.Title, Type: "process", Command: "devdeck",
			Args: []string{"run", s.ID, "-w", in.Workspace}, ProblemMatcher: []string{}, Detail: "script " + s.ID,
		})
	}
	for _, m := range in.Modes {
		tasks = append(tasks,
			task{Label: "devdeck: start " + m, Type: "process", Command: "devdeck", Args: []string{"up", m, "-w", in.Workspace},
				ProblemMatcher: []string{}, Detail: "run mode " + m},
			task{Label: "devdeck: stop " + m, Type: "process", Command: "devdeck", Args: []string{"down", m, "-w", in.Workspace},
				ProblemMatcher: []string{}, Detail: "run mode " + m},
		)
	}
	f.Tasks = map[string]any{"version": "2.0.0", "tasks": tasks}

	b, _ := json.MarshalIndent(f, "", "  ") // plain maps, slices and strings: it can't fail
	return append(b, '\n')
}
