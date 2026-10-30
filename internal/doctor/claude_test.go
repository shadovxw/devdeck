package doctor

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/shadovxw/devdeck/internal/workspace"
)

func claudeCheck(t *testing.T, stack string, probe func(context.Context) ClaudeConnector) (Check, bool) {
	t.Helper()
	b := &builder{in: Input{Stack: stack, Workspace: &workspace.WorkspaceFile{}}, p: Probes{ClaudeConnector: probe}}
	jobs := b.claudeJobs()
	if len(jobs) == 0 {
		return Check{}, false
	}
	if len(jobs) != 1 {
		t.Fatalf("%d jobs, want at most 1", len(jobs))
	}
	return jobs[0](context.Background()), true
}

func TestClaudeConnectorCheck(t *testing.T) {
	tests := []struct {
		name       string
		stack      string
		probe      func(context.Context) ClaudeConnector
		wantCheck  bool
		wantStatus Status
		wantFix    string
	}{
		{"not asked for", "", nil, false, "", ""},
		{"Claude Code isn't on the machine", "", func(context.Context) ClaudeConnector { return ClaudeConnector{} }, false, "", ""},
		{"a run of one stack leaves it out", "full", func(context.Context) ClaudeConnector { return ClaudeConnector{ClaudeFound: true} }, false, "", ""},
		{"connected", "", func(context.Context) ClaudeConnector {
			return ClaudeConnector{ClaudeFound: true, Installed: true, Command: "devdeck"}
		}, true, OK, ""},
		{"Claude Code is there but not connected", "", func(context.Context) ClaudeConnector { return ClaudeConnector{ClaudeFound: true} }, true, Warn, "devdeck mcp install"},
		{"connected to a devdeck that was moved", "", func(context.Context) ClaudeConnector {
			return ClaudeConnector{ClaudeFound: true, Installed: true, Command: "C:/old/devdeck.exe", CommandMissing: true}
		}, true, Warn, "claude mcp remove devdeck"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c, ok := claudeCheck(t, tc.stack, tc.probe)
			if ok != tc.wantCheck {
				t.Fatalf("check present = %v, want %v", ok, tc.wantCheck)
			}
			if !ok {
				return
			}
			if c.ID != "claude:connector" || c.Group != GroupClaude || c.Status != tc.wantStatus {
				t.Errorf("check = %+v, want status %s", c, tc.wantStatus)
			}
			if tc.wantFix != "" && (len(c.Fix) == 0 || c.Fix[0] != tc.wantFix) {
				t.Errorf("fix = %v, want it to start with %q", c.Fix, tc.wantFix)
			}
		})
	}
}

func TestConnectorIn(t *testing.T) {
	present := filepath.Join(t.TempDir(), "devdeck.exe")
	if err := os.WriteFile(present, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	gone := filepath.Join(t.TempDir(), "gone", "devdeck.exe")
	quote := func(s string) string { return `"` + filepath.ToSlash(s) + `"` }

	tests := []struct {
		name         string
		settings     string
		wantFound    bool
		wantMissing  bool
		wantCommand  string
		wantNotFound bool
	}{
		{"user scope", `{"mcpServers":{"devdeck":{"command":` + quote(present) + `,"args":["mcp"]}}}`, true, false, filepath.ToSlash(present), false},
		{"in a project", `{"projects":{"c:/code/app":{"mcpServers":{"devdeck":{"command":"devdeck"}}}}}`, true, false, "devdeck", false},
		{"a bare command is not looked up", `{"mcpServers":{"devdeck":{"command":"devdeck"}}}`, true, false, "devdeck", false},
		{"the program is gone", `{"mcpServers":{"devdeck":{"command":` + quote(gone) + `}}}`, true, true, filepath.ToSlash(gone), false},
		{"other servers only", `{"mcpServers":{"other":{"command":"x"}}}`, false, false, "", true},
		{"no servers", `{"numStartups":3}`, false, false, "", true},
		{"not JSON", `{`, false, false, "", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			st := connectorIn([]byte(tc.settings), ClaudeConnector{ClaudeFound: true})
			if st.Installed != tc.wantFound || st.CommandMissing != tc.wantMissing || st.Command != tc.wantCommand {
				t.Errorf("got %+v, want installed=%v missing=%v command=%q", st, tc.wantFound, tc.wantMissing, tc.wantCommand)
			}
			if !st.ClaudeFound {
				t.Error("the caller's ClaudeFound was lost")
			}
		})
	}
}
