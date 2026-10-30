# Connecting Claude Code to devdeck

devdeck has a connector for [Claude Code](https://claude.com/claude-code). Once connected, Claude can read what devdeck shows (what is running, logs, Doctor results, git accounts, remote hosts and which page you have open) instead of you copying text into a chat. It can only **read**: it can't start, stop, restart, deploy or change anything.

## Connect it

devdeck has to be installed (the installer, or a `devdeck.exe` you built) and Claude Code too. Then, in a terminal:

```powershell
devdeck mcp install
```

That runs `claude mcp add --scope user devdeck -- <path to devdeck> mcp` for you. The installer can do the same: tick **Connect devdeck to Claude Code**. Start a new Claude Code session and ask, for example:

- "what is running in devdeck?"
- "show the errors from the last hour in my `full` stack"
- "what am I looking at?"

To do it by hand, or to share the setup in a project, `devdeck mcp config` prints the JSON for a `.mcp.json` (`--full` writes the full path instead of relying on the PATH). To remove it: `devdeck mcp uninstall` (or `claude mcp remove devdeck`).

The Doctor page has a **Claude Code** check that says whether it is connected.

devdeck must be running for Claude to read anything: the connector asks the running app. If it isn't, Claude is told to ask you to open it.

## What Claude can read

| Area (a switch on the **Claude access** page) | Tools | Default |
|---|---|---|
| Workspaces and stacks | `devdeck_status`, `list_workspaces`, `get_workspace`, `doctor`, `validate_workspace_yaml`, `get_schema` | on |
| Logs | `query_logs`, `log_histogram`, `log_groups` | on |
| Git accounts | `git_accounts`, `git_repos` | on |
| What's on your screen | `get_ui_state` | on |
| Remote hosts | `list_hosts`, `host_info`, `host_services`, `host_compose`, `host_logs` | **off** |

`get_schema` and the three schemas (`devdeck://schema/workspace`, `stack`, `flow`) are built in and work even when devdeck isn't running. Claude Code also offers four prompts: **why-is-this-stack-failing**, **compare-host-and-local**, **explain-this-screen** and **check-my-workspace-yaml**.

## What Claude never gets

- **Secrets.** No tokens, passwords or keys; they live in your OS keychain, and no tool reads it. Environment variables are shown **by name only**; their values are replaced by `(hidden)`. Log lines have secrets masked when they are stored, and lines from a remote host are masked again before Claude sees them. Masking recognises common shapes (`password=...`, `Authorization: Bearer ...`, tokens in URLs and JSON, private-key blocks): a secret printed on its own, under a name nobody would guess, can get through, so keep secrets out of your logs.
- **Write access.** The server refuses every request from the connector that isn't a read, except the YAML check, which saves nothing. This is enforced by devdeck, not by the connector, so a changed connector can't write either.
- **Its own settings.** The Claude access page and its list can't be reached by the connector, so Claude can't switch an area on for itself.

## Remote hosts

Remote hosts are **off** until you switch them on, because a host's log lines travel through the tunnel to your PC and then to Claude. Even when on, Claude never opens a tunnel: the host has to be open already (use the Remote hosts page), and it reads at most the last 200 log lines per service in a short read, not a stream.

## Seeing what Claude asked

The **Claude access** page lists every request the connector made (time, tool, what it asked for, whether it was answered or refused, and the size), newest first, for the last 1,000. It keeps what was asked, never the answers. Clear it any time.

The switches are kept in `claude-access.yaml` in devdeck's data folder (`%AppData%\devdeck` on Windows), which the page writes. You can edit it by hand: `hosts: true`, `git: false` and so on (the areas are `workspaces`, `logs`, `git`, `hosts` and `ui`). With no file, the defaults above apply; a file devdeck can't read switches **everything off**.

## Writing devdeck's YAML with Claude

Claude can write a workspace for you and check its own work:

1. It calls `get_schema` for the kind of file (workspace, stack or flow).
2. It writes the file and calls `validate_workspace_yaml` until it says the file is valid. For a stack or flow it passes the workspace, so repo ids are checked.
3. You save the files in `%AppData%\devdeck\workspaces\<name>\` (`workspace.yaml`, `stacks\<stack>.yaml`, `flows\<flow>.yaml`).

Without Claude, in a terminal and with no devdeck running:

```powershell
devdeck workspace check <folder or name>
devdeck schema stack
```

`devdeck workspace check` lists each problem with file and line and exits with 1 when there are errors; `--json` is for scripts. Never put a secret in the YAML: the schema asks for environment variable **names**, and the values belong in an env file or the OS keychain.

## What stays on your machine

The connector talks to devdeck on `127.0.0.1` over its standard input and output, and opens no port of its own. What Claude Code does with a tool's answer is up to Claude Code and your Anthropic account: once an answer has been read, treat it as shared. If that matters for a kind of data, switch its area off.
