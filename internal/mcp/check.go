package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/shadovxw/devdeck/internal/workspace"
)

const (
	// maxYAML bounds the text Claude may ask to have checked.
	maxYAML = 200 << 10
	// maxIssues bounds the problems listed in one answer.
	maxIssues = 100
)

// kinds are the files a workspace is made of, in the words the schemas use.
var kinds = []workspace.Kind{workspace.KindWorkspace, workspace.KindStack, workspace.KindFlow}

func kindEnum() []string {
	out := make([]string, len(kinds))
	for i, k := range kinds {
		out[i] = string(k)
	}
	return out
}

func parseKind(s string) (workspace.Kind, error) {
	for _, k := range kinds {
		if string(k) == s {
			return k, nil
		}
	}
	return "", fmt.Errorf("kind must be one of: %s", strings.Join(kindEnum(), ", "))
}

// Resources are the JSON Schemas of devdeck's files, built into the program.
func Resources() []Resource {
	var out []Resource
	for _, k := range kinds {
		out = append(out, Resource{
			URI:         "devdeck://schema/" + string(k),
			Name:        string(k) + " schema",
			Description: "JSON Schema of a " + string(k) + " file (YAML), the format devdeck reads.",
			MIME:        "application/schema+json",
			Read:        func() (string, error) { b, err := workspace.SchemaJSON(k); return string(b), err },
		})
	}
	return out
}

func checkTools(c *client) []Tool {
	return []Tool{
		{
			Name:        "get_schema",
			Description: "The JSON Schema of one of devdeck's YAML files: workspace (workspace.yaml: repos, hosts, connections), stack (stacks/<name>.yaml) or flow (flows/<name>.yaml). Read it before writing one. Works even when devdeck is not running.",
			Schema: objectSchema(map[string]any{
				"kind": map[string]any{"type": "string", "enum": kindEnum(), "description": "Which file."},
			}, "kind"),
			Call: getSchema,
		},
		{
			Name:        "validate_workspace_yaml",
			Description: "Checks the text of a workspace, stack or flow file against the schema and devdeck's own rules, and saves nothing. Answers with each problem: file, line, severity and message. Pass workspace (an id from list_workspaces) when checking a stack or flow, so its repo ids can be checked.",
			Schema: objectSchema(map[string]any{
				"kind":      map[string]any{"type": "string", "enum": kindEnum(), "description": "Which file the text is."},
				"yaml":      map[string]any{"type": "string", "description": "The file's text."},
				"workspace": map[string]any{"type": "string", "description": "Optional: the workspace a stack or flow belongs to."},
			}, "kind", "yaml"),
			Call: c.validate,
		},
	}
}

func getSchema(_ context.Context, args json.RawMessage) (string, error) {
	var a struct {
		Kind string `json:"kind"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	k, err := parseKind(a.Kind)
	if err != nil {
		return "", err
	}
	b, err := workspace.SchemaJSON(k)
	if err != nil {
		return "", errors.New("the schema couldn't be read")
	}
	return truncate(string(b)), nil
}

func (c *client) validate(ctx context.Context, args json.RawMessage) (string, error) {
	var a struct {
		Kind      string `json:"kind"`
		YAML      string `json:"yaml"`
		Workspace string `json:"workspace"`
	}
	if err := decodeArgs(args, &a); err != nil {
		return "", err
	}
	k, err := parseKind(a.Kind)
	if err != nil {
		return "", err
	}
	if a.YAML == "" {
		return "", errors.New("yaml is needed")
	}
	if len(a.YAML) > maxYAML {
		return "", fmt.Errorf("yaml is too long (%d KB at most)", maxYAML>>10)
	}
	if a.Workspace != "" {
		if err := checkArg("workspace", a.Workspace); err != nil {
			return "", err
		}
	}
	body, err := c.post(ctx, "/api/v1/workspaces/validate", map[string]string{"kind": string(k), "yaml": a.YAML, "workspace_id": a.Workspace})
	if err != nil {
		return "", err
	}
	var res struct {
		Valid  bool              `json:"valid"`
		Issues []workspace.Issue `json:"issues"`
	}
	if err := json.Unmarshal(body, &res); err != nil {
		return "", errors.New("devdeck sent an answer that can't be read")
	}
	return formatIssues(string(k), res.Valid, res.Issues), nil
}

// formatIssues is a one-line verdict, then one line per problem.
func formatIssues(what string, valid bool, issues []workspace.Issue) string {
	errs, warns := workspace.Count(issues, workspace.SeverityError), workspace.Count(issues, workspace.SeverityWarning)
	var b strings.Builder
	switch {
	case valid && len(issues) == 0:
		fmt.Fprintf(&b, "The %s file is valid.", what)
	case valid:
		fmt.Fprintf(&b, "The %s file is valid, with %d warnings.", what, warns)
	default:
		fmt.Fprintf(&b, "The %s file has %d errors and %d warnings.", what, errs, warns)
	}
	for i, is := range issues {
		if i == maxIssues {
			fmt.Fprintf(&b, "\n… and %d more.", len(issues)-maxIssues)
			break
		}
		at := is.File
		if is.Line > 0 {
			at = fmt.Sprintf("%s:%d", is.File, is.Line)
		}
		fmt.Fprintf(&b, "\n%s %s: %s", is.Severity, at, is.Message)
		if is.Path != "" {
			fmt.Fprintf(&b, " (%s)", is.Path)
		}
	}
	return truncate(b.String())
}
