package workspace

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.yaml.in/yaml/v3"
)

var (
	// ErrConverted means the project already is a project.yaml.
	ErrConverted = errors.New("this project already uses project.yaml")
	// ErrOldFilesThere means workspace.yaml.v1 or stacks.v1 from an earlier conversion is in the way.
	ErrOldFilesThere = errors.New("workspace.yaml.v1 or stacks.v1 is already there from an earlier conversion: move it away first")
)

// Conversion is the project.yaml devdeck would write for a project, for review.
type Conversion struct {
	YAML string `json:"yaml"`
	// Modes are the stacks/*.yaml files that go inline, by file name.
	Modes []string `json:"modes"`
	// Databases is how many databases go in.
	Databases int `json:"databases"`
	// Issues are the problems the new file would have; an error stops the conversion.
	Issues []Issue `json:"issues"`
}

// convertText builds project.yaml from a folder's workspace.yaml and stacks/*.yaml, keeping their
// comments and order: version becomes 2, every stack goes under run.modes without its version,
// and dbs (the databases found for the project) go under databases.
func convertText(dir string, dbs []DatabaseDecl) ([]byte, []string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, workspaceYAML))
	if err != nil {
		return nil, nil, err
	}
	var doc yaml.Node
	if err := yaml.Unmarshal(raw, &doc); err != nil || len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, nil, fmt.Errorf("workspace.yaml can't be read: fix it first")
	}
	root := doc.Content[0]
	if v := child(root, "version"); v != nil {
		v.Value, v.Tag, v.Style = "2", "!!int", 0
	}

	modes := &yaml.Node{Kind: yaml.SequenceNode, Tag: "!!seq"}
	var files []string
	for _, name := range yamlFiles(filepath.Join(dir, "stacks")) {
		b, err := os.ReadFile(filepath.Join(dir, "stacks", name))
		if err != nil {
			return nil, nil, err
		}
		var sd yaml.Node
		if err := yaml.Unmarshal(b, &sd); err != nil || len(sd.Content) == 0 || sd.Content[0].Kind != yaml.MappingNode {
			return nil, nil, fmt.Errorf("stacks/%s can't be read: fix it first", name)
		}
		m := sd.Content[0]
		removeKey(m, "version")
		if sd.HeadComment != "" && m.HeadComment == "" {
			m.HeadComment = sd.HeadComment
		}
		modes.Content = append(modes.Content, m)
		files = append(files, "stacks/"+name)
	}
	if len(modes.Content) > 0 {
		run := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		run.Content = append(run.Content, scalar("modes"), modes)
		root.Content = append(root.Content, scalar("run"), run)
	}
	if len(dbs) > 0 {
		var n yaml.Node
		if err := n.Encode(dbs); err != nil {
			return nil, nil, err
		}
		root.Content = append(root.Content, scalar("databases"), &n)
	}

	var out bytes.Buffer
	enc := yaml.NewEncoder(&out)
	enc.SetIndent(2)
	if err := enc.Encode(&doc); err != nil {
		return nil, nil, err
	}
	if err := enc.Close(); err != nil {
		return nil, nil, err
	}
	return out.Bytes(), files, nil
}

func scalar(v string) *yaml.Node { return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v} }

// removeKey drops a key and its value from a mapping. A comment above the key moves to the next one.
func removeKey(m *yaml.Node, key string) {
	for i := 0; i+1 < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			if c := m.Content[i].HeadComment; c != "" && i+2 < len(m.Content) {
				next := m.Content[i+2]
				next.HeadComment = strings.TrimSpace(c + "\n" + next.HeadComment)
			}
			m.Content = append(m.Content[:i], m.Content[i+2:]...)
			return
		}
	}
}

// ConvertPreview is the project.yaml a project would get, with its problems. Nothing is written.
func (s *Manager) ConvertPreview(id string, dbs []DatabaseDecl) (*Conversion, error) {
	r, err := s.room(id)
	if err != nil {
		return nil, err
	}
	if name, _ := FileOf(r.dir); name == projectYAML {
		return nil, ErrConverted
	}
	text, files, err := convertText(r.dir, dbs)
	if err != nil {
		return nil, err
	}
	_, issues := checkProjectText(projectYAML, r.dir, text, s.options(r.source))
	if files == nil {
		files = []string{}
	}
	return &Conversion{YAML: string(text), Modes: files, Databases: len(dbs), Issues: tidy(issues)}, nil
}

// Convert writes project.yaml for one of the user's own projects and keeps the old files next to
// it, renamed: workspace.yaml.v1 and stacks.v1/. Moving them back undoes it. Flows stay where
// they are. Nothing is written when the new file has errors (ErrInvalid, with the issues).
func (s *Manager) Convert(id string, dbs []DatabaseDecl) (*Conversion, error) {
	r, err := s.ownRoom(id)
	if err != nil {
		return nil, err
	}
	c, err := s.ConvertPreview(id, dbs)
	if err != nil {
		return nil, err
	}
	if HasErrors(c.Issues) {
		return c, ErrInvalid
	}
	oldWS, oldStacks := filepath.Join(r.dir, workspaceYAML), filepath.Join(r.dir, "stacks")
	for _, p := range []string{oldWS + ".v1", oldStacks + ".v1"} {
		if _, err := os.Lstat(p); err == nil {
			return nil, ErrOldFilesThere
		}
	}

	tmp, err := os.CreateTemp(r.dir, ".project-*.yaml")
	if err != nil {
		return nil, err
	}
	_, werr := tmp.WriteString(c.YAML)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr, os.Chmod(tmp.Name(), 0o644)); err != nil { //nolint:gosec // the mode workspace.yaml has
		_ = os.Remove(tmp.Name())
		return nil, fmt.Errorf("write project.yaml: %w", err)
	}
	movedStacks := false
	if len(c.Modes) > 0 {
		if err := os.Rename(oldStacks, oldStacks+".v1"); err != nil {
			_ = os.Remove(tmp.Name())
			return nil, fmt.Errorf("keep stacks/: %w", err)
		}
		movedStacks = true
	}
	undo := func() {
		if movedStacks {
			_ = os.Rename(oldStacks+".v1", oldStacks)
		}
		_ = os.Remove(tmp.Name())
	}
	if err := os.Rename(oldWS, oldWS+".v1"); err != nil {
		undo()
		return nil, fmt.Errorf("keep workspace.yaml: %w", err)
	}
	if err := os.Rename(tmp.Name(), filepath.Join(r.dir, projectYAML)); err != nil {
		_ = os.Rename(oldWS+".v1", oldWS)
		undo()
		return nil, fmt.Errorf("write project.yaml: %w", err)
	}
	return c, nil
}
