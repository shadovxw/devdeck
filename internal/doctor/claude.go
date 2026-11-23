package doctor

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// ClaudeConnector is what the machine says about devdeck's connector in Claude Code.
type ClaudeConnector struct {
	// ClaudeFound is whether Claude Code looks installed (its settings file or its program).
	ClaudeFound bool
	// Installed is whether Claude Code has an MCP server called devdeck.
	Installed bool
	// Command is the program that server runs, as written in Claude Code's settings.
	Command string
	// CommandMissing is true when Command is a path and nothing is there.
	CommandMissing bool
}

// claudeJobs checks the Claude Code connector. It only appears when the run asks for it
// (the probe is set), Claude Code is on the machine, and the run is of the whole
// workspace: it is about the machine, not a stack. Looking is a file read, so it is done
// when the checks are listed.
func (b *builder) claudeJobs() []job {
	if b.in.Stack != "" || b.p.ClaudeConnector == nil {
		return nil
	}
	st := b.p.ClaudeConnector(context.Background())
	if !st.ClaudeFound {
		return nil
	}
	return []job{func(context.Context) Check {
		c := Check{ID: "claude:connector", Group: GroupClaude, Title: "devdeck is connected to Claude Code"}
		switch {
		case st.Installed && st.CommandMissing:
			c.Status = Warn
			c.Detail = "Claude Code starts " + st.Command + ", and nothing is there: devdeck was moved or reinstalled."
			c.Fix = []string{"claude mcp remove devdeck", "devdeck mcp install"}
		case st.Installed:
			c.Status, c.Detail = OK, "Claude Code can read what devdeck shows. What it may read is on the Claude access page."
		default:
			c.Status = Warn
			c.Detail = "Claude Code can't see devdeck yet."
			c.Fix = []string{"devdeck mcp install"}
		}
		return c
	}}
}

// DetectClaudeConnector reads Claude Code's settings file (~/.claude.json) for an MCP server
// called devdeck, at the top (user scope) or in any project. It starts nothing and
// contacts nothing.
func DetectClaudeConnector(context.Context) ClaudeConnector {
	var st ClaudeConnector
	if _, err := exec.LookPath("claude"); err == nil {
		st.ClaudeFound = true
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return st
	}
	b, err := os.ReadFile(filepath.Join(home, ".claude.json"))
	if err != nil {
		return st
	}
	st.ClaudeFound = true
	return connectorIn(b, st)
}

// connectorIn finds the devdeck server in the text of Claude Code's settings file.
func connectorIn(settings []byte, st ClaudeConnector) ClaudeConnector {
	type server struct {
		Command string `json:"command"`
	}
	var f struct {
		MCPServers map[string]server `json:"mcpServers"`
		Projects   map[string]struct {
			MCPServers map[string]server `json:"mcpServers"`
		} `json:"projects"`
	}
	if json.Unmarshal(settings, &f) != nil {
		return st
	}
	found, ok := f.MCPServers["devdeck"]
	if !ok {
		for _, p := range f.Projects {
			if s, has := p.MCPServers["devdeck"]; has {
				found, ok = s, true
				break
			}
		}
	}
	if !ok {
		return st
	}
	st.Installed, st.Command = true, found.Command
	if filepath.IsAbs(found.Command) || strings.ContainsAny(found.Command, `/\`) {
		if _, err := os.Stat(found.Command); err != nil {
			st.CommandMissing = true
		}
	}
	return st
}
