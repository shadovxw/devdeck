package workspace

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"go.yaml.in/yaml/v3"
)

// project.yaml (dev-plans/2026-11-22-projects §5, PJ9) is one file per project: what workspace.yaml
// holds, plus its run modes, databases and scripts inline. It is loaded into the same shapes as
// workspace.yaml and stacks/*.yaml, so running, scripts and the rest work the same on either.
// A workspace.yaml with its stacks/ folder is still read as it is; converting is offered, never forced.

const (
	// KindProject is project.yaml.
	KindProject Kind = "project"
	// kindMode is a run mode written inside project.yaml: a stack without its version.
	kindMode Kind = "mode"

	projectYAML = "project.yaml"
)

// ErrInline means a run mode is written inside project.yaml, so it is edited there, not as its own file.
var ErrInline = errors.New("this run mode is written inside project.yaml: edit it there")

// ProjectFile is project.yaml.
type ProjectFile struct {
	WorkspaceFile `yaml:",inline"`
	Run           *Run           `yaml:"run,omitempty" json:"run,omitempty"`
	Databases     []DatabaseDecl `yaml:"databases,omitempty" json:"databases,omitempty"`
}

// Run is a project's run modes. Big projects can keep some as stacks/<name>.yaml files.
type Run struct {
	// Default is the mode the project page starts on.
	Default string      `yaml:"default,omitempty" json:"default,omitempty"`
	Modes   []StackFile `yaml:"modes,omitempty" json:"modes,omitempty"`
}

// DatabaseDecl is a database the file names: where it runs, and who uses it. Never a password.
type DatabaseDecl struct {
	ID     string       `yaml:"id" json:"id"`
	Engine string       `yaml:"engine" json:"engine"`
	Name   string       `yaml:"name,omitempty" json:"name,omitempty"`
	From   DatabaseFrom `yaml:"from" json:"from"`
	Port   int          `yaml:"port,omitempty" json:"port,omitempty"`
	UsedBy []string     `yaml:"used_by,omitempty" json:"used_by,omitempty"`
}

// DatabaseFrom says where a database runs: a service in a compose file of a run mode, installed on
// this machine, or wherever an env var in a repo's .env points.
type DatabaseFrom struct {
	Compose string `yaml:"compose,omitempty" json:"compose,omitempty"`
	Local   bool   `yaml:"local,omitempty" json:"local,omitempty"`
	URLEnv  string `yaml:"url_env,omitempty" json:"url_env,omitempty"`
}

// FileOf is the file a workspace folder is defined in: project.yaml when there is one, else workspace.yaml.
func FileOf(dir string) (string, Kind) {
	if _, err := os.Stat(filepath.Join(dir, projectYAML)); err == nil {
		return projectYAML, KindProject
	}
	return workspaceYAML, KindWorkspace
}

// generatedSchemas builds the mode and project schemas from the stack and workspace ones, so the
// three never drift apart: a mode is a stack without "version"; a project is a workspace at
// version 2 with "run" and "databases".
func generatedSchemas() (mode, project []byte, err error) {
	read := func(k Kind) (map[string]any, error) {
		raw, err := schemaFS.ReadFile("schemas/" + string(k) + ".schema.json")
		if err != nil {
			return nil, err
		}
		var m map[string]any
		return m, json.Unmarshal(raw, &m)
	}
	st, err := read(KindStack)
	if err != nil {
		return nil, nil, err
	}
	st["$id"] = "https://devdeck.local/schemas/mode.schema.json"
	st["title"] = "devdeck run mode"
	st["description"] = "A run mode inside project.yaml: the services that start together, and in what order."
	delete(st["properties"].(map[string]any), "version")
	st["required"] = []string{"name"}

	ws, err := read(KindWorkspace)
	if err != nil {
		return nil, nil, err
	}
	ws["$id"] = "https://devdeck.local/schemas/project.schema.json"
	ws["title"] = "devdeck project"
	ws["description"] = "project.yaml: a project's repos, accounts, run modes, databases and scripts, in one file."
	props := ws["properties"].(map[string]any)
	props["version"] = map[string]any{"const": 2, "description": "Schema version of project.yaml: 2."}
	props["run"] = map[string]any{
		"type": "object", "additionalProperties": false,
		"description": "How the project runs: its run modes. Big projects can keep some in stacks/<name>.yaml.",
		"properties": map[string]any{
			"default": map[string]any{"type": "string", "description": "The run mode the project page starts on."},
			"modes":   map[string]any{"type": "array", "items": map[string]any{"$ref": "mode.schema.json"}},
		},
	}
	props["databases"] = map[string]any{
		"type": "array", "description": "The project's databases: where each runs and who uses it. Never a password.",
		"items": map[string]any{
			"type": "object", "additionalProperties": false, "required": []string{"id", "engine", "from"},
			"properties": map[string]any{
				"id":     map[string]any{"$ref": "#/$defs/id"},
				"engine": map[string]any{"enum": []string{"postgres", "mysql", "redis", "mongo"}},
				"name":   map[string]any{"type": "string", "description": "The database's name inside the server."},
				"port":   map[string]any{"type": "integer", "minimum": 1, "maximum": 65535},
				"from": map[string]any{
					"type": "object", "additionalProperties": false, "minProperties": 1, "maxProperties": 1,
					"description": "Where it runs: one of compose (a service of a run mode's compose file), local (installed here) or url_env (the env var in a repo's .env).",
					"properties": map[string]any{
						"compose": map[string]any{"type": "string"},
						"local":   map[string]any{"const": true},
						"url_env": map[string]any{"type": "string", "pattern": "^[A-Z][A-Z0-9_]*$"},
					},
				},
				"used_by": map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "The repos that use it."},
			},
		},
	}
	if mode, err = json.MarshalIndent(st, "", "  "); err != nil {
		return nil, nil, err
	}
	project, err = json.MarshalIndent(ws, "", "  ")
	return mode, project, err
}

// sub is the part of a file under ptr, checked on its own: its issues come back with ptr in front,
// on the lines of the whole file.
func (p *parsed) sub(ptr string, n *yaml.Node) (*parsed, error) {
	var v any
	if err := n.Decode(&v); err != nil {
		return nil, err
	}
	jv, err := toJSONValue(v)
	if err != nil {
		return nil, err
	}
	return &parsed{file: p.file, node: n, value: jv, index: buildIndex(n)}, nil
}

func prefixed(ptr string, issues []Issue) []Issue {
	for i := range issues {
		issues[i].Path = ptr + issues[i].Path
	}
	return issues
}

// child is the value of a key in a mapping node, or nil.
func child(n *yaml.Node, key string) *yaml.Node {
	if n.Kind == yaml.DocumentNode && len(n.Content) > 0 {
		n = n.Content[0]
	}
	if n.Kind != yaml.MappingNode {
		return nil
	}
	for i := 0; i+1 < len(n.Content); i += 2 {
		if n.Content[i].Value == key {
			return n.Content[i+1]
		}
	}
	return nil
}

// checkProjectText checks project.yaml text: the workspace part as workspace.yaml is checked, each
// run mode as a stack, and the databases. dir (optional) is where the project lives, for paths.
func checkProjectText(file, dir string, data []byte, opts Options) (*ProjectFile, []Issue) {
	p, issues := parse(file, data)
	if p == nil {
		return nil, issues
	}
	issues = append(issues, p.checkSchema(KindProject)...)
	if HasErrors(issues) {
		return nil, issues
	}
	pf, ok := decode[ProjectFile](p)
	if !ok {
		return nil, append(issues, p.issue("", "The file couldn't be read into a project."))
	}
	issues = append(issues, checkWorkspace(p, &pf.WorkspaceFile)...)
	if opts.CheckPaths {
		issues = append(issues, checkPaths(p, &pf.WorkspaceFile, dir)...)
	}
	repoIDs := map[string]bool{}
	for _, r := range pf.Repos {
		repoIDs[r.ID] = true
	}

	if pf.Run != nil {
		modes := child(child(p.node, "run"), "modes")
		names := map[string]bool{}
		for i := range pf.Run.Modes {
			m := &pf.Run.Modes[i]
			m.Version, m.File = 1, file
			ptr := "/run/modes/" + strconv.Itoa(i)
			if modes != nil && i < len(modes.Content) {
				if sp, err := p.sub(ptr, modes.Content[i]); err == nil {
					issues = append(issues, prefixed(ptr, checkStack(sp, m, repoIDs))...)
				}
			}
			if names[m.Name] {
				issues = append(issues, p.issue(ptr+"/name", fmt.Sprintf("The run mode name %q is used twice.", m.Name)))
			}
			names[m.Name] = true
		}
		if pf.Run.Default != "" && !names[pf.Run.Default] {
			issues = append(issues, p.warn("/run/default", fmt.Sprintf("There is no run mode %q in this file.", pf.Run.Default)))
		}
	}

	dbIDs := map[string]bool{}
	for i, db := range pf.Databases {
		ptr := "/databases/" + strconv.Itoa(i)
		if dbIDs[db.ID] {
			issues = append(issues, p.issue(ptr+"/id", fmt.Sprintf("The database id %q is used twice.", db.ID)))
		}
		dbIDs[db.ID] = true
		for j, u := range db.UsedBy {
			if !repoIDs[u] {
				issues = append(issues, p.warn(ptr+"/used_by/"+strconv.Itoa(j), fmt.Sprintf("There is no repo with id %q in this project.", u)))
			}
		}
		if db.From.Local && db.Port == 0 {
			issues = append(issues, p.warn(ptr+"/port", "A database installed on this machine needs its port, so devdeck can check it."))
		}
	}
	return pf, issues
}

// checkDefinition checks the text of a project's own file, as workspace.yaml or project.yaml by its name.
func checkDefinition(file, dir string, data []byte, opts Options) []Issue {
	if file == projectYAML {
		_, issues := checkProjectText(file, dir, data, opts)
		return issues
	}
	_, issues := checkWorkspaceText(file, dir, data, opts)
	return issues
}

// definitionOf reads the text of a project's own file into its workspace part.
func definitionOf(file string, data []byte) (*WorkspaceFile, []Issue) {
	if file == projectYAML {
		pf, issues := checkProjectText(file, "", data, Options{})
		if pf == nil {
			return nil, issues
		}
		return &pf.WorkspaceFile, issues
	}
	return checkWorkspaceText(file, "", data, Options{})
}
