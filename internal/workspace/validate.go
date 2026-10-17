package workspace

import (
	"bytes"
	"embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"github.com/santhosh-tekuri/jsonschema/v6/kind"
	"go.yaml.in/yaml/v3"
)

// Kind says which sort of file is being checked.
type Kind string

const (
	KindWorkspace Kind = "workspace"
	KindStack     Kind = "stack"
	KindFlow      Kind = "flow"
)

//go:embed schemas/*.json
var schemaFS embed.FS

var (
	schemaOnce sync.Once
	schemaSet  map[Kind]*jsonschema.Schema
	schemaErr  error
)

// SchemaJSON returns the JSON Schema for a kind of file, for editors and docs.
func SchemaJSON(k Kind) ([]byte, error) {
	return schemaFS.ReadFile("schemas/" + string(k) + ".schema.json")
}

func schemas() (map[Kind]*jsonschema.Schema, error) {
	schemaOnce.Do(func() {
		schemaSet = map[Kind]*jsonschema.Schema{}
		c := jsonschema.NewCompiler()
		for _, k := range []Kind{KindWorkspace, KindStack, KindFlow} {
			raw, err := SchemaJSON(k)
			if err != nil {
				schemaErr = err
				return
			}
			doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
			if err != nil {
				schemaErr = fmt.Errorf("%s schema: %w", k, err)
				return
			}
			url := "https://devdeck.local/schemas/" + string(k) + ".schema.json"
			if err := c.AddResource(url, doc); err != nil {
				schemaErr = err
				return
			}
			s, err := c.Compile(url)
			if err != nil {
				schemaErr = fmt.Errorf("%s schema: %w", k, err)
				return
			}
			schemaSet[k] = s
		}
	})
	return schemaSet, schemaErr
}

// parsed is a YAML file that is well-formed enough to check further.
type parsed struct {
	file  string
	node  *yaml.Node
	value any
	index lineIndex
}

var (
	yamlLine  = regexp.MustCompile(`line (\d+)`)
	yamlNoise = regexp.MustCompile(`^yaml: (unmarshal errors:\n\s*)?(line \d+: )?`)
)

// parse reads YAML text. A syntax error is returned as an issue, with its line.
func parse(file string, data []byte) (*parsed, []Issue) {
	fail := func(line int, msg string) (*parsed, []Issue) {
		return nil, []Issue{{File: file, Line: line, Severity: SeverityError, Message: msg}}
	}

	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		return fail(lineOf(err), tidyYAMLError(err))
	}
	if root.Kind == 0 || len(root.Content) == 0 {
		return fail(1, "The file is empty.")
	}
	if root.Content[0].Kind != yaml.MappingNode {
		return fail(root.Content[0].Line, "The file must be a list of settings written as key: value.")
	}

	var v any
	if err := root.Decode(&v); err != nil {
		return fail(lineOf(err), tidyYAMLError(err))
	}
	jv, err := toJSONValue(v)
	if err != nil {
		return fail(1, "The file has a setting name that isn't text.")
	}
	return &parsed{file: file, node: &root, value: jv, index: buildIndex(&root)}, nil
}

func lineOf(err error) int {
	if m := yamlLine.FindStringSubmatch(err.Error()); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return 0
}

func tidyYAMLError(err error) string {
	msg := yamlNoise.ReplaceAllString(err.Error(), "")
	msg = strings.TrimSpace(strings.SplitN(msg, "\n", 2)[0])
	if msg == "" {
		return "The file isn't valid YAML."
	}
	return strings.ToUpper(msg[:1]) + msg[1:]
}

// toJSONValue round-trips a decoded YAML value through JSON, so numbers and
// maps have the types the schema library expects.
func toJSONValue(v any) (any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return jsonschema.UnmarshalJSON(bytes.NewReader(b))
}

// checkSchema runs the JSON Schema and returns plain-language issues.
func (p *parsed) checkSchema(k Kind) []Issue {
	set, err := schemas()
	if err != nil {
		return []Issue{{File: p.file, Severity: SeverityError, Message: "devdeck's own schema failed to load: " + err.Error()}}
	}
	verr := set[k].Validate(p.value)
	if verr == nil {
		return nil
	}
	ve, ok := verr.(*jsonschema.ValidationError)
	if !ok {
		return []Issue{{File: p.file, Severity: SeverityError, Message: verr.Error()}}
	}

	// Walk the error tree. A unit with children is only a container ("this
	// object didn't validate"), so only the leaves are reported.
	var issues []Issue
	var visit func(u jsonschema.OutputUnit)
	visit = func(u jsonschema.OutputUnit) {
		if len(u.Errors) > 0 {
			for _, child := range u.Errors {
				visit(child)
			}
			return
		}
		if u.Error != nil {
			issues = append(issues, p.fromUnit(u)...)
		}
	}
	visit(*ve.DetailedOutput())
	return issues
}

func (p *parsed) issue(path, msg string) Issue {
	return Issue{File: p.file, Path: path, Line: p.index.lineFor(path), Severity: SeverityError, Message: msg}
}

// fromUnit turns one schema error into one or more issues.
func (p *parsed) fromUnit(u jsonschema.OutputUnit) []Issue {
	ptr := u.InstanceLocation
	switch k := u.Error.Kind.(type) {
	case *kind.AdditionalProperties:
		var out []Issue
		for _, prop := range k.Properties {
			out = append(out, p.issue(ptr+"/"+escape(prop), fmt.Sprintf("%q isn't a setting devdeck knows. Check the spelling.", prop)))
		}
		return out
	case *kind.Required:
		var out []Issue
		for _, prop := range k.Missing {
			out = append(out, p.issue(ptr, fmt.Sprintf("%q is required here.", prop)))
		}
		return out
	case *kind.Pattern:
		return []Issue{p.issue(ptr, patternMessage(k))}
	case *kind.Enum:
		return []Issue{p.issue(ptr, fmt.Sprintf("%v isn't allowed here. Use one of: %s.", k.Got, joinAny(k.Want)))}
	case *kind.Type:
		return []Issue{p.issue(ptr, fmt.Sprintf("This should be %s, not %s.", article(strings.Join(k.Want, " or ")), article(k.Got)))}
	case *kind.Const:
		return []Issue{p.issue(ptr, fmt.Sprintf("This must be %v.", k.Want))}
	}
	return []Issue{p.issue(ptr, capitalise(u.Error.String())+".")}
}

func patternMessage(k *kind.Pattern) string {
	// The more specific patterns come first: they start the same way as a name.
	switch {
	case strings.Contains(k.Want, `\.[a-z]`):
		return fmt.Sprintf("%q should be written plugin.action, for example gitleaks.scan.", k.Got)
	case strings.Contains(k.Want, "(ms|s|m)"):
		return fmt.Sprintf("%q isn't a duration. Write it like 500ms, 30s or 2m.", k.Got)
	case strings.HasPrefix(k.Want, "^[a-z][a-z0-9-]"):
		return fmt.Sprintf("%q can't be used as a name. Use lowercase letters, digits and dashes, starting with a letter (40 characters at most).", k.Got)
	}
	return fmt.Sprintf("%q isn't in the expected format.", k.Got)
}

func joinAny(vs []any) string {
	parts := make([]string, len(vs))
	for i, v := range vs {
		parts[i] = fmt.Sprint(v)
	}
	return strings.Join(parts, ", ")
}

func article(noun string) string {
	switch noun {
	case "object":
		return "a group of settings"
	case "array":
		return "a list"
	case "string":
		return "text"
	case "integer", "number":
		return "a number"
	case "boolean":
		return "true or false"
	}
	return noun
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
