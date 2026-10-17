// Package sdk is the plugin contract. A plugin is static Go code behind these
// interfaces plus an embedded manifest.yaml; devdeck's core only ever talks to
// plugins through them (plan §5).
//
// Every plugin implements Plugin. It then adds whichever capability interfaces
// it supports (ActionRunner, LogParser, ...); the core discovers them with a
// type assertion, so a plugin never has to stub out features it doesn't have.
package sdk

import (
	"context"
	"time"

	"github.com/shadovxw/devdeck/internal/secrets"
)

// Plugin is the one interface every plugin implements.
type Plugin interface {
	// Manifest describes the plugin: identity, the tools it needs, the
	// connection it uses and the actions it offers.
	Manifest() Manifest
	// Check reports whether the tool is installed, new enough and healthy.
	Check(ctx context.Context) ToolStatus
}

// State is the outcome of a Check.
type State string

const (
	StateOK       State = "ok"       // installed, new enough, healthy
	StateMissing  State = "missing"  // a required binary was not found
	StateOutdated State = "outdated" // installed but older than the manifest's min_version
	StateDegraded State = "degraded" // installed, but not working (e.g. a daemon is down)
)

// ToolStatus is what Check returns.
type ToolStatus struct {
	State     State     `json:"state"`
	Version   string    `json:"version,omitempty"`
	Detail    string    `json:"detail,omitempty"`
	CheckedAt time.Time `json:"checked_at"`
}

// Inputs and Outputs are the JSON-shaped values passed to and from an action.
// Inputs are validated against the action's schema in the manifest before Run.
type (
	Inputs  map[string]any
	Outputs map[string]any
)

// Finding is one issue reported by a scanner or linter.
type Finding struct {
	RuleID   string `json:"rule_id"`
	Severity string `json:"severity"` // critical, high, medium, low, info
	Message  string `json:"message"`
	File     string `json:"file,omitempty"`
	Line     int    `json:"line,omitempty"`
}

// Emitter streams progress out of a running action to the UI.
type Emitter interface {
	Log(line string)
	Progress(done, total int, message string)
	Finding(f Finding)
}

// Connection is a configured instance of a plugin's connection type, such as
// one GitHub account. Secret fields come from the OS keyring and print masked.
type Connection struct {
	ID      string                   `json:"id"`
	Type    string                   `json:"type"`
	Fields  map[string]string        `json:"fields"`
	Secrets map[string]secrets.Value `json:"-"`
}

// Option is one choice offered by a DataSource (a dropdown entry in a form).
type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

// LogRecord is one parsed log line.
type LogRecord struct {
	Time    time.Time      `json:"time"`
	Level   string         `json:"level"`
	Message string         `json:"message"`
	Caller  string         `json:"caller,omitempty"`
	Fields  map[string]any `json:"fields,omitempty"`
}

// Metric is one sampled measurement.
type Metric struct {
	Name   string            `json:"name"`
	Value  float64           `json:"value"`
	Unit   string            `json:"unit,omitempty"`
	Labels map[string]string `json:"labels,omitempty"`
}

// Installer installs the tool. method is one of the manifest's install methods.
type Installer interface {
	Install(ctx context.Context, method string) error
}

// ActionRunner runs the manifest's actions.
type ActionRunner interface {
	Run(ctx context.Context, action string, in Inputs, out Emitter) (Outputs, error)
}

// ConnectionTester checks that a connection's credentials work.
type ConnectionTester interface {
	TestConnection(ctx context.Context, c Connection) error
}

// DataSource supplies options for form fields, e.g. a repo's branches.
type DataSource interface {
	Options(ctx context.Context, source string, params map[string]string) ([]Option, error)
}

// LogParser turns a raw log line into a LogRecord (zerolog JSON, Vite, Go panics).
// It reports false when the line is not in its format.
type LogParser interface {
	Parse(line []byte) (LogRecord, bool)
}

// FindingsProducer turns a tool's report file (SARIF or JSON) into findings.
type FindingsProducer interface {
	Findings(ctx context.Context, reportPath string) ([]Finding, error)
}

// MetricsSource samples metrics on demand.
type MetricsSource interface {
	Sample(ctx context.Context) ([]Metric, error)
}
