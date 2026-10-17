package sdk

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"go.yaml.in/yaml/v3"
)

// Manifest is the YAML file embedded in every plugin (plugins/<name>/manifest.yaml).
// It is the single description the core and the UI use: the UI renders action
// forms from the same JSON Schema the core validates inputs against.
type Manifest struct {
	ID          string `yaml:"id" json:"id"`
	Name        string `yaml:"name" json:"name"`
	Category    string `yaml:"category" json:"category"`
	Icon        string `yaml:"icon" json:"icon,omitempty"`
	Description string `yaml:"description" json:"description,omitempty"`

	// Needs are the binaries the plugin drives, checked by the Doctor.
	Needs []Need `yaml:"needs" json:"needs,omitempty"`
	// ConnectionType describes the credentials the plugin needs, if any.
	ConnectionType *ConnectionType `yaml:"connection_type" json:"connection_type,omitempty"`
	// DataSources names the option lists the plugin can supply to forms.
	DataSources []string `yaml:"data_sources" json:"data_sources,omitempty"`
	// Actions are the operations flows and the UI can run.
	Actions map[string]Action `yaml:"actions" json:"actions,omitempty"`

	schemas map[string]*actionSchemas
}

// Need is a binary the plugin depends on.
type Need struct {
	Binary      string          `yaml:"binary" json:"binary"`
	VersionArgs []string        `yaml:"version_args" json:"version_args,omitempty"` // default: --version
	MinVersion  string          `yaml:"min_version" json:"min_version,omitempty"`   // e.g. "2.30"
	Install     []InstallMethod `yaml:"install" json:"install,omitempty"`
}

// InstallMethod is one way to install a Need.
type InstallMethod struct {
	Method  string `yaml:"method" json:"method"` // winget, scoop, brew, apt, docker or manual
	Command string `yaml:"command" json:"command"`
}

// ConnectionType lists the fields a connection to this tool has.
type ConnectionType struct {
	Fields []ConnectionField `yaml:"fields" json:"fields"`
}

// ConnectionField is one field. Secret fields are stored in the OS keyring and
// always shown masked.
type ConnectionField struct {
	Name     string `yaml:"name" json:"name"`
	Label    string `yaml:"label" json:"label"`
	Secret   bool   `yaml:"secret" json:"secret,omitempty"`
	Required bool   `yaml:"required" json:"required,omitempty"`
}

// Action is one operation. Inputs and Outputs are JSON Schema objects written
// in YAML. FailWhen is an expression over the outputs that marks the run failed.
type Action struct {
	Title    string         `yaml:"title" json:"title"`
	Inputs   map[string]any `yaml:"inputs" json:"inputs,omitempty"`
	Outputs  map[string]any `yaml:"outputs" json:"outputs,omitempty"`
	FailWhen string         `yaml:"fail_when" json:"fail_when,omitempty"`
}

type actionSchemas struct {
	inputs *jsonschema.Schema
}

var (
	idPattern      = regexp.MustCompile(`^[a-z][a-z0-9-]*$`)
	actionPattern  = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)
	fieldPattern   = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	versionPattern = regexp.MustCompile(`^\d+(\.\d+){0,2}$`)
	installMethods = map[string]bool{"winget": true, "scoop": true, "brew": true, "apt": true, "docker": true, "manual": true}
)

// ParseManifest decodes and validates a manifest. Unknown YAML keys are an
// error so typos don't silently disappear. Action schemas are compiled here,
// so a broken schema fails at load time, not at first use.
func ParseManifest(data []byte) (Manifest, error) {
	var m Manifest
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&m); err != nil {
		return Manifest{}, fmt.Errorf("manifest: %w", err)
	}
	if err := m.validate(); err != nil {
		return Manifest{}, fmt.Errorf("manifest %q: %w", m.ID, err)
	}
	return m, nil
}

func (m *Manifest) validate() error {
	var errs []error
	add := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }

	if !idPattern.MatchString(m.ID) {
		add("id %q must be lowercase letters, digits and dashes, starting with a letter", m.ID)
	}
	if strings.TrimSpace(m.Name) == "" {
		add("name is required")
	}
	if strings.TrimSpace(m.Category) == "" {
		add("category is required")
	}
	for i, n := range m.Needs {
		if n.Binary == "" {
			add("needs[%d]: binary is required", i)
		}
		if n.MinVersion != "" && !versionPattern.MatchString(n.MinVersion) {
			add("needs[%d]: min_version %q must look like 2 or 2.30 or 2.30.1", i, n.MinVersion)
		}
		for j, im := range n.Install {
			if !installMethods[im.Method] {
				add("needs[%d].install[%d]: unknown method %q", i, j, im.Method)
			}
			if strings.TrimSpace(im.Command) == "" {
				add("needs[%d].install[%d]: command is required", i, j)
			}
		}
	}
	if m.ConnectionType != nil {
		seen := map[string]bool{}
		for i, f := range m.ConnectionType.Fields {
			switch {
			case !fieldPattern.MatchString(f.Name):
				add("connection_type.fields[%d]: name %q must be lowercase letters, digits and underscores", i, f.Name)
			case seen[f.Name]:
				add("connection_type.fields[%d]: duplicate field %q", i, f.Name)
			}
			seen[f.Name] = true
		}
	}

	m.schemas = make(map[string]*actionSchemas, len(m.Actions))
	for _, name := range sortedKeys(m.Actions) {
		if !actionPattern.MatchString(name) {
			add("action %q: name must be lowercase letters, digits, dashes and underscores", name)
			continue
		}
		a := m.Actions[name]
		if strings.TrimSpace(a.Title) == "" {
			add("action %q: title is required", name)
		}
		s := &actionSchemas{}
		if len(a.Inputs) > 0 {
			sch, err := compileSchema(a.Inputs)
			if err != nil {
				add("action %q: inputs: %v", name, err)
			}
			s.inputs = sch
		}
		if len(a.Outputs) > 0 {
			if _, err := compileSchema(a.Outputs); err != nil {
				add("action %q: outputs: %v", name, err)
			}
		}
		m.schemas[name] = s
	}
	return errors.Join(errs...)
}

// ValidateInputs checks in against the action's input schema. An action with
// no schema accepts anything.
func (m Manifest) ValidateInputs(action string, in Inputs) error {
	if _, ok := m.Actions[action]; !ok {
		return fmt.Errorf("plugin %q has no action %q", m.ID, action)
	}
	s := m.schemas[action]
	if s == nil || s.inputs == nil {
		return nil
	}
	instance, err := toJSONValue(map[string]any(in))
	if err != nil {
		return err
	}
	if err := s.inputs.Validate(instance); err != nil {
		return fmt.Errorf("action %q inputs: %w", action, err)
	}
	return nil
}

func compileSchema(doc map[string]any) (*jsonschema.Schema, error) {
	v, err := toJSONValue(doc)
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource("schema.json", v); err != nil {
		return nil, err
	}
	return c.Compile("schema.json")
}

// toJSONValue round-trips v through JSON so numbers and nested maps have the
// exact types the schema library expects (YAML decodes integers as int).
func toJSONValue(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(b))
}

func sortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
