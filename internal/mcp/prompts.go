package mcp

import "fmt"

// Prompts are the named starting points Claude Code offers: each turns a few arguments
// into a message that says which tools to use, in what order, and to change nothing.
func Prompts() []Prompt {
	return []Prompt{
		{
			Name:        "why-is-this-stack-failing",
			Description: "Find the likeliest reason a stack is failing, from what is running, its errors and the machine checks.",
			Arguments: []PromptArg{
				{Name: "workspace", Description: "The workspace id.", Required: true},
				{Name: "stack", Description: "The stack name.", Required: true},
			},
			Build: func(a map[string]string) (string, error) {
				return fmt.Sprintf(`Find out why the stack %q in devdeck's workspace %q is failing. Use devdeck's tools, in this order, and change nothing:
1. devdeck_status: which services are not running or are degraded.
2. log_histogram with level=error and since=1h: when the errors started.
3. log_groups: the kinds of error, then query_logs with level=error and since=15m for the newest lines of the main one (use group=<fingerprint> to read one kind).
4. doctor for the workspace and stack: a missing tool, a stopped Docker, a missing env file.
Then say the likeliest cause, the evidence (service, time and line), and the next step the person can take. If something you need is switched off, say which devdeck setting to turn on.`, a["stack"], a["workspace"]), nil
			},
		},
		{
			Name:        "compare-host-and-local",
			Description: "Compare a stack running on a remote host with the same stack on this machine: images, ports and what is running.",
			Arguments: []PromptArg{
				{Name: "workspace", Description: "The workspace id.", Required: true},
				{Name: "host", Description: "The host id from list_hosts.", Required: true},
				{Name: "stack", Description: "The stack id on the host (host_info lists them).", Required: true},
			},
			Build: func(a map[string]string) (string, error) {
				return fmt.Sprintf(`Compare host %q (workspace %q, stack %q) with this machine. Use devdeck's tools and change nothing:
1. host_info, host_services and host_compose for the host's stack (the host's tunnel must already be open; if a tool says it isn't, tell the person to open it on the Remote hosts page).
2. get_workspace and devdeck_status for the same workspace here.
Then list the differences that matter: services missing on either side, image tags that differ, ports, and anything unhealthy. Don't guess about values you can't see: environment variable values are hidden, only names.`, a["host"], a["workspace"], a["stack"]), nil
			},
		},
		{
			Name:        "explain-this-screen",
			Description: "Explain what the page the person has open in devdeck shows, and what stands out in it.",
			Build: func(map[string]string) (string, error) {
				return `Call get_ui_state to see which devdeck page the person has open, with its filters and any message it shows. Then read the data that page shows with the right tool (logs: query_logs and log_histogram; stacks: devdeck_status; remote hosts: list_hosts and host_services; connections and repositories: git_accounts and git_repos; Doctor: doctor) and explain it in plain words: what the page is for, what the numbers or rows mean, and what stands out or looks wrong. Change nothing.`, nil
			},
		},
		{
			Name:        "check-my-workspace-yaml",
			Description: "Write or fix a devdeck workspace, stack or flow file, and check it until it is valid.",
			Arguments: []PromptArg{
				{Name: "goal", Description: "What the file should describe, in a sentence."},
			},
			Build: func(a map[string]string) (string, error) {
				goal := a["goal"]
				if goal == "" {
					goal = "the person's workspace"
				}
				return fmt.Sprintf(`Help write devdeck's YAML for: %s.
1. Call get_schema for each kind of file you will write (workspace, stack, flow) and follow it exactly.
2. Draft the file, then call validate_workspace_yaml with the text. For a stack or flow pass workspace=<id> so repo ids are checked. Fix every error and read each warning; repeat until it says the file is valid.
3. Never put a secret in the YAML (no tokens, passwords or keys: names of environment variables only). If a value must be secret, tell the person to put it in their OS keychain or an env file.
4. Show the final file and where it should be saved, the workspaces folder of devdeck's data folder (on Windows %%AppData%%\devdeck\workspaces\<name>\). Say that the person can also run "devdeck workspace check <name>" in a terminal.`, goal), nil
			},
		},
	}
}
