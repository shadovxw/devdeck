# The Claude Code connector: let Claude see what devdeck sees

> Status: **plan, for review (2026-10-30); no code yet.** Implements plan §10.4 (devdeck MCP server) and §14A.7 (Claude access), pulled forward. Related: [`../2026-10-30-docker-builds/plan.md`](../2026-10-30-docker-builds/plan.md) (its CLI checks `devdeck workspace check` and `devdeck schema` are reused here).

## 1. The goal

Anything devdeck shows a person (stacks and their state, logs, remote hosts, doctor results, git and Docker account status, the workspace files) Claude Code can read too, without copy and paste. Install once with one command; after that Claude asks devdeck instead of crawling repos or guessing. Claude can also see **where the person is in the UI**.

## 2. Decisions

1. **An MCP server, `devdeck mcp`, over stdio.** Claude Code starts it as a child process (no network port, nothing new listening). It is one more sub-command of the same binary, like `git-credential` and `agent`.
2. **It is a thin client of the running devdeck**, as `devdeck status` is: it calls `127.0.0.1:7070` (`DEVDECK_ADDR`). So Claude sees exactly what the UI sees, and there is no second copy of the logic. If devdeck isn't running, every tool answers "devdeck isn't running; open it" and nothing else.
3. **Read-only to start.** No tool writes, starts, stops or deploys. Writes come later as *proposals* the person approves in devdeck (§7), never as direct calls.
4. **The server enforces it, not just the connector.** Every request from `devdeck mcp` carries `X-Devdeck-Client: mcp`; a middleware lets those requests reach only an allow-list of GET routes and refuses everything else with 403. A bug or a modified connector still can't write. The one exception is `POST /api/v1/workspaces/validate`, which checks YAML and saves nothing.
5. **Secrets never reach Claude** (project rule): names only. No keyring values, no agent tokens, no Docker or GitHub tokens, no `.env`. Log lines are already redacted at ingest (`internal/logs/redact.go`); output is also size-capped (default 100 lines, at most 500 lines and 200 KB per call) and marked as truncated.
6. **Claude access is a visible switch.** A "Claude access" panel shows "Claude connected, last call 12 s ago", has a switch per area (logs, hosts, git and Docker, workspace files) and an **audit list of every call** (time, tool, arguments, bytes returned). Stored in SQLite through `internal/store`; arguments only, never results.
7. **Remote host logs are bounded.** Reading a host's logs through the tunnel is a capped read (last N lines or the last few seconds), never an open stream, and it opens no tunnel that isn't already connected in devdeck.
8. **A small JSON-RPC server written by hand, no SDK** (decided in C1): the part of MCP that tools need is initialize, ping, tools/list and tools/call (and later resources), about 200 lines, with no new dependency for CI to scan. Revisit if resources, prompts or progress updates make the hand-written part grow.

## 3. Installing it (the commands to give to Claude Code)

On a machine with the installer's devdeck and Claude Code:

```powershell
claude mcp add --scope user devdeck -- "$env:LOCALAPPDATA\Programs\devdeck\devdeck.exe" mcp
claude mcp list
```

`--scope user` makes it available in every project. For one project only (shared with a team through `.mcp.json`, no personal paths), `devdeck mcp config` prints the JSON to paste:

```json
{ "mcpServers": { "devdeck": { "command": "devdeck", "args": ["mcp"] } } }
```

This form needs "Add devdeck to my PATH" ticked in the installer. Remove the connector with `claude mcp remove devdeck`.

`devdeck mcp install` runs the `claude mcp add` line for the person when `claude` is on the PATH, and otherwise prints it. The installer gets an unticked task, "Connect devdeck to Claude Code". Doctor gets a check: connector installed, not installed, or devdeck not running.

Open point, settled in the first PR: the installed exe is built `-H windowsgui` (no console). `git-credential` already works through pipes from git, so stdio should work the same from Claude Code; C1 proves it with a real `claude mcp add` before anything else is built.

## 4. What Claude gets

**Tools** (read-only; each returns compact JSON plus a one-line summary):

| Tool | Answers | From |
|---|---|---|
| `devdeck_status` | what runs now: stacks, services, state, uptime, last error | `/runs`, stacks API |
| `list_workspaces`, `get_workspace` | workspaces and their repos, stacks, hosts (no tokens) | `/workspaces` |
| `query_logs` | stored lines of a stack, filtered by service, level, field, regex, since and until | `/workspaces/:id/stacks/:stack/logs` |
| `log_histogram`, `log_groups` | counts by level and time; what a line group is | same, `/histogram`, `/groups` |
| `list_hosts`, `host_info`, `host_services`, `host_compose`, `host_logs` | remote hosts, the agent's stacks, their services and image tags, a bounded and re-masked log tail (off until switched on; only over a tunnel that is already open) | `/hosts/...` |
| `doctor` | tool and host checks, as on the Doctor page | `/doctor` |
| `git_accounts`, `git_repos` | which account a repo uses, whether identity matches (no tokens; on unless switched off) | `/git`, `/git/repos` |
| `docker_accounts`, `image_history` | account names and namespaces; recent builds (once the Docker work lands) | `/docker/...`, `/images/...` |
| `validate_workspace_yaml`, `get_schema` | the issues (file, line, message) in a YAML text; the JSON Schema of a file kind (works with devdeck closed) | `/workspaces/validate`, built in |
| `get_ui_state` | what page, workspace, stack, host and filters the person has open (§5) | §5 |

**Resources:** the three JSON Schemas (`devdeck://schema/workspace`, `stack`, `flow`), built in. A workspace's own YAML is not offered yet: the API gives parsed workspaces (`get_workspace`), not the raw files.

**Prompts** (short, named starting points Claude Code offers): `why-is-this-stack-failing` (status, then error-level logs of the failing service, then its compose), `compare-host-and-local`, `explain-this-screen` (uses `get_ui_state`).

## 5. "See the UI"

What is and isn't possible:

- **Data: yes, fully.** Everything a page shows comes from the API, so the tools above give Claude the same facts, in text, which is better than pixels.
- **Where the person is: yes** (`get_ui_state`). The web app posts a small snapshot when the route or selection changes (page, workspace, stack, host, active filters, the visible error message) to `PUT /api/v1/ui/state`. It lives in memory only (latest snapshot, a few KB, cleared on quit) and holds no secret values: it is built from the same non-secret fields the pages already show.
- **Pixels: today, in a browser.** The UI is also served at `http://127.0.0.1:7070`. Claude's browser tools (Claude in Chrome, or the browser pane in the desktop app) can open it, read it, click and take screenshots now, with no new code. The Host/Origin guard already allows it.
- **Pixels of the desktop window: not planned.** The Wails window can't be captured by an MCP tool without extra, platform-specific work. If wanted later, it is a separate item.

## 6. Security, in one place

- stdio only; no new port. The connector can do only what the allow-listed GET routes do (decision 4).
- Names, never values (decision 5). The tests include a fixture with a fake token in a log line and in a host's output, and assert it never appears in any tool result.
- Size caps and truncation notes on every tool.
- Every call is audited and visible to the person; "Claude access" can be switched off per area, and the server then answers 403 for that area.
- What an installed connector gives a **teammate's** Claude: the same read access to *their own* devdeck on *their own* machine. Nothing leaves the machine except what Claude Code itself sends to Anthropic as tool results, which is why logs are redacted first and why the switch exists.
- A local program that calls the API directly can do what the UI can; that is as before. The allow-list applies only to requests that say they are the connector, so it limits the connector, not other clients.

## 7. Later: Claude proposes, you approve

Writes (start, stop or restart a service; change an image tag; deploy) as `propose_action`: Claude sends an action, devdeck shows it in a queue ("Claude suggests: restart `demo-api` on host `dev`"), and **only a click in devdeck runs it**, through the same confirmation and locks as the UI buttons. Off by default. Not in the first PRs.

## 8. Order of work (each PR under 10 files, safe on its own, `changes.md` updated, neutral names)

| PR | What | Done when |
|---|---|---|
| C0 | This plan | merged |
| C1 | `devdeck mcp` (stdio), the `X-Devdeck-Client` allow-list middleware, tools `devdeck_status`, `list_workspaces`, `get_workspace`, `doctor`; `devdeck mcp install` and `config`; tests with an in-memory transport | the `claude mcp add` line from §3 works with the installed app, and Claude answers "what is running?" |
| C2 | Logs: `query_logs`, `log_histogram`, `log_groups`, with caps, truncation notes and the fake-token test | Claude finds the error lines of a failing service |
| C3 | Hosts: `list_hosts`, `host_services`, `host_compose`, `host_logs` (bounded, no new tunnel) | Claude reads a remote host's services and last log lines |
| C4 | Resources and `validate_workspace_yaml`; git and Docker status tools | A teammate's Claude checks the YAML it wrote and sees account status |
| C5 | The "Claude access" panel: per-area switches, connected indicator, audit list (SQLite) | Switching logs off makes `query_logs` answer 403; every call shows in the list |
| C6 | `get_ui_state` and the web app's snapshot | "What am I looking at?" is answered from the real page |
| C7 | Installer task, Doctor check, prompts, docs and the SOP section | A fresh install connects with one tick or one command |
| later | `propose_action` (§7); desktop window screenshot | |

**Where it fits with the other plan:** C1 and C2 are worth doing straight after PR 3B merges, because they help debug everything else (4C, 4D and the Docker work) with Claude reading the real logs. Suggested order: 3B, C1, C2, C3, then 4C, 4D, T1, T2, C4 to C7, then the Docker PRs. T2 (the CLI `workspace check` and `schema`) shares code with C4: write it once in `internal/workspace`.

## 9. Open questions

- ~~Official SDK or hand-written JSON-RPC~~: hand-written (decision 8).
- ~~Should "Claude access" be on by default?~~ Decided: local data (git) on, remote hosts off, kept in `<data dir>/claude-access.yaml` (`hosts:` and `git:` as true or false; no file means the defaults, a file that can't be read means everything off).
- The `.mcp.json` form assumes devdeck is on the PATH; teammates who skip that tick use the full-path command or `devdeck mcp install`.

## 10. Checking it works

- Go table tests per tool against a fake API (the helper pattern in `internal/api/stacks_test.go`); tests that every non-allow-listed route and every non-GET request returns 403 for `X-Devdeck-Client: mcp`; the fake-token redaction test; cap and truncation tests.
- Vitest for the Claude access panel and the UI-state snapshot.
- By hand: `claude mcp add`, then ask Claude "what's running in devdeck?", "show the errors from the last hour in <stack>", "what am I looking at?"; confirm the audit list shows each call.
