// Package workspace reads, checks and creates workspace configuration: the YAML
// files that say which repositories devdeck works on, how their services start
// together (stacks) and which checks run on them (flows).
//
// A workspace is a folder:
//
//	<name>/workspace.yaml     repos, connections and account rules
//	<name>/stacks/<stack>.yaml  one stack per file
//	<name>/flows/<flow>.yaml    one flow per file
//
// The files are checked against the JSON Schemas in schemas/ (the same files
// work in VS Code's YAML extension) and then against rules a schema can't
// express, such as "this repo id exists". Every problem is reported as an
// Issue with its file and line.
package workspace

import (
	"go.yaml.in/yaml/v3"

	"github.com/shadovxw/devdeck/internal/logs"
)

// WorkspaceFile is workspace.yaml.
type WorkspaceFile struct {
	Version           int           `yaml:"version" json:"version"`
	Name              string        `yaml:"name" json:"name"`
	Description       string        `yaml:"description,omitempty" json:"description,omitempty"`
	Root              string        `yaml:"root" json:"root"`
	DefaultConnection string        `yaml:"default_connection,omitempty" json:"default_connection,omitempty"`
	Repos             []Repo        `yaml:"repos,omitempty" json:"repos,omitempty"`
	Connections       []Connection  `yaml:"connections,omitempty" json:"connections,omitempty"`
	AccountRules      []AccountRule `yaml:"account_rules,omitempty" json:"account_rules,omitempty"`
	Hosts             []Host        `yaml:"hosts,omitempty" json:"hosts,omitempty"`
}

// Host is a remote machine that runs `devdeck agent`, reached through a tunnel.
// Its token lives in the OS keychain, never here.
type Host struct {
	ID   string `yaml:"id" json:"id"`
	Name string `yaml:"name,omitempty" json:"name,omitempty"`
	// Type is how the tunnel is opened. Only "aws-ssm" (an SSM port-forwarding session) for now.
	Type string   `yaml:"type" json:"type"`
	AWS  *HostAWS `yaml:"aws,omitempty" json:"aws,omitempty"`
	// AgentPort is the port the agent listens on, on the host's loopback (7071 when zero).
	AgentPort int `yaml:"agent_port,omitempty" json:"agent_port,omitempty"`
}

// HostAWS says which instance an SSM session goes to, and as whom.
type HostAWS struct {
	Instance string `yaml:"instance" json:"instance"`
	Region   string `yaml:"region" json:"region"`
	// Profile is the AWS CLI profile to use ("" means the default one).
	Profile string `yaml:"profile,omitempty" json:"profile,omitempty"`
}

// Repo is one repository in the workspace.
type Repo struct {
	ID            string `yaml:"id" json:"id"`
	Path          string `yaml:"path" json:"path"`
	Type          string `yaml:"type,omitempty" json:"type,omitempty"`
	Remote        string `yaml:"remote,omitempty" json:"remote,omitempty"`
	Connection    string `yaml:"connection,omitempty" json:"connection,omitempty"`
	DefaultBranch string `yaml:"default_branch,omitempty" json:"default_branch,omitempty"`
}

// Connection is a configured account or service. Secrets are never stored here.
type Connection struct {
	ID       string            `yaml:"id" json:"id"`
	Type     string            `yaml:"type" json:"type"`
	Identity *Identity         `yaml:"identity,omitempty" json:"identity,omitempty"`
	Settings map[string]string `yaml:"settings,omitempty" json:"settings,omitempty"`
}

// Identity is the name and email used for commits made through a connection.
type Identity struct {
	Name  string `yaml:"name" json:"name"`
	Email string `yaml:"email" json:"email"`
}

// AccountRule maps a remote pattern to the connection that owns it.
type AccountRule struct {
	Match      string `yaml:"match" json:"match"`
	Connection string `yaml:"connection" json:"connection"`
}

// StackFile is stacks/<name>.yaml.
type StackFile struct {
	Version     int      `yaml:"version" json:"version"`
	Name        string   `yaml:"name" json:"name"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
	Compose     Composes `yaml:"compose,omitempty" json:"compose,omitempty"`
	// Requires are things outside devdeck's control that must answer before the stack starts.
	Requires []Require `yaml:"requires,omitempty" json:"requires,omitempty"`
	Services []Service `yaml:"services,omitempty" json:"services"`
	// File is the file name it was read from (set by the loader, not in YAML).
	File string `yaml:"-" json:"file"`
}

// Composes are a stack's Docker Compose files. In YAML it is one file
// (`compose: {repo, file}`) or a list of them.
type Composes []Compose

// UnmarshalYAML accepts a single file or a list of files.
func (c *Composes) UnmarshalYAML(n *yaml.Node) error {
	if n.Kind == yaml.SequenceNode {
		var list []Compose
		if err := n.Decode(&list); err != nil {
			return err
		}
		*c = list
		return nil
	}
	var one Compose
	if err := n.Decode(&one); err != nil {
		return err
	}
	*c = Composes{one}
	return nil
}

// Require is something the stack needs but doesn't start, such as a database
// that runs on this machine. devdeck checks that it answers on tcp (a loopback
// host:port) and refuses to start the stack when it doesn't.
type Require struct {
	Name string `yaml:"name" json:"name"`
	TCP  string `yaml:"tcp" json:"tcp"`
}

// Compose points at a Docker Compose file that provides dependencies.
type Compose struct {
	// ID names the file in the start order, so services and other compose files can
	// wait for it. Give every compose file an id, or none: without ids every service
	// waits for all of them, as always.
	ID       string   `yaml:"id,omitempty" json:"id,omitempty"`
	Repo     string   `yaml:"repo" json:"repo"`
	File     string   `yaml:"file" json:"file"`
	Services []string `yaml:"services,omitempty" json:"services,omitempty"`
	// After lists the services and compose files (by id) that must be done first.
	After []string `yaml:"after,omitempty" json:"after,omitempty"`
	// Optional means: if this file fails, say so and carry on, and don't hold back
	// what comes after it.
	Optional bool `yaml:"optional,omitempty" json:"optional,omitempty"`
	// Logs sets which output lines of the file's containers are stored, keyed by the
	// compose service name. A container with no entry stores everything.
	Logs map[string]logs.Rule `yaml:"logs,omitempty" json:"logs,omitempty"`
}

// Service is one process in a stack.
type Service struct {
	ID        string            `yaml:"id" json:"id"`
	Repo      string            `yaml:"repo" json:"repo"`
	Kind      string            `yaml:"kind" json:"kind"`
	Cmd       string            `yaml:"cmd,omitempty" json:"cmd,omitempty"`
	Dir       string            `yaml:"dir,omitempty" json:"dir,omitempty"`
	Port      int               `yaml:"port,omitempty" json:"port,omitempty"`
	EnvFile   string            `yaml:"env_file,omitempty" json:"env_file,omitempty"`
	Env       map[string]string `yaml:"env,omitempty" json:"env,omitempty"`
	After     []string          `yaml:"after,omitempty" json:"after,omitempty"`
	Ready     *Ready            `yaml:"ready,omitempty" json:"ready,omitempty"`
	LogParser string            `yaml:"log_parser,omitempty" json:"log_parser,omitempty"`
	// Logs says which of the service's output lines are stored (default: all).
	Logs    *logs.Rule `yaml:"logs,omitempty" json:"logs,omitempty"`
	Restart string     `yaml:"restart,omitempty" json:"restart,omitempty"`
}

// Ready says how to tell that a service is up: exactly one of HTTP, TCP or Log.
type Ready struct {
	HTTP    string `yaml:"http,omitempty" json:"http,omitempty"`
	TCP     string `yaml:"tcp,omitempty" json:"tcp,omitempty"`
	Log     string `yaml:"log,omitempty" json:"log,omitempty"`
	Timeout string `yaml:"timeout,omitempty" json:"timeout,omitempty"`
}

// FlowFile is flows/<name>.yaml.
type FlowFile struct {
	Version     int      `yaml:"version" json:"version"`
	Name        string   `yaml:"name" json:"name"`
	Description string   `yaml:"description,omitempty" json:"description,omitempty"`
	Trigger     *Trigger `yaml:"trigger,omitempty" json:"trigger,omitempty"`
	ForEach     string   `yaml:"for_each,omitempty" json:"for_each,omitempty"`
	Steps       []Step   `yaml:"steps" json:"steps"`
	File        string   `yaml:"-" json:"file"`
}

// Trigger says when a flow runs.
type Trigger struct {
	Manual        bool   `yaml:"manual,omitempty" json:"manual,omitempty"`
	Schedule      string `yaml:"schedule,omitempty" json:"schedule,omitempty"`
	WorkItemStage string `yaml:"work_item_stage,omitempty" json:"work_item_stage,omitempty"`
}

// Step is one plugin action in a flow.
type Step struct {
	ID       string         `yaml:"id" json:"id"`
	Uses     string         `yaml:"uses" json:"uses"`
	Inputs   map[string]any `yaml:"inputs,omitempty" json:"inputs,omitempty"`
	Needs    []string       `yaml:"needs,omitempty" json:"needs,omitempty"`
	Gate     string         `yaml:"gate,omitempty" json:"gate,omitempty"`
	Approval bool           `yaml:"approval,omitempty" json:"approval,omitempty"`
	Timeout  string         `yaml:"timeout,omitempty" json:"timeout,omitempty"`
	Retries  int            `yaml:"retries,omitempty" json:"retries,omitempty"`
}
