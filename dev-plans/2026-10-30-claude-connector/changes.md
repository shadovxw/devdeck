# Changes: Claude Code connector

What changed and why, kept current while coding. See [`plan.md`](plan.md) for the PR list.

## 2026-10-30

- Plan written, for review. No code yet.

## PR C1: `devdeck mcp`, the allow-list and the first four tools

### What was built

- **`devdeck mcp`** (`internal/mcp`): an MCP server over stdio, written by hand (initialize, ping, tools/list, tools/call; protocol versions 2025-06-18, 2025-03-26 and 2024-11-05). No SDK: the part tools need is small, and it adds no dependency. It reads the running devdeck's API and never starts the server. If nothing answers, a tool says "devdeck isn't running" as an error Claude can pass on.
- **Tools, all marked read-only:** `devdeck_status` (stacks and their state, with a one-line summary), `list_workspaces`, `get_workspace` (environment variable **values are replaced by "(hidden)"**, names stay) and `doctor`. Output is cut at 200 KB with a note; arguments are checked strictly (an unknown argument is an error, ids are at most 128 characters).
- **The server holds the connector to read-only** (`internal/api/connector.go`): a request with `X-Devdeck-Client: mcp` may only GET `health`, `runs`, `doctor`, `workspaces` and `workspaces/<id>`; anything else is 403 "this isn't available to Claude". Requests without the header are not limited (it limits the connector, not other local clients).
- **`devdeck mcp install`** runs `claude mcp add --scope user devdeck -- <this exe> mcp`, or prints that line when `claude` isn't on the PATH. **`devdeck mcp config [--full]`** prints the JSON for a project's `.mcp.json` (`devdeck` on the PATH, or the full path with `--full`).

### Checked

- Go tests for the protocol, each tool, the env-value hiding (a fake value must never appear), truncation, install, config and a run through `Command` with `DEVDECK_ADDR`; the guard has its own table test. `mise run lint:go` clean.
- The installed exe is built `-H windowsgui` (no console): a build with that flag, run with requests piped in, answered `initialize` and `devdeck_status` correctly over stdin and stdout. Not yet tried: `claude mcp add` against the installed app, which is the first manual step after merging.

### Decisions

- Hand-written server instead of the official SDK (plan §2.8, §9 updated).

### Not here

Logs (C2), hosts (C3), resources and the YAML check (C4), the Claude access panel and audit (C5), `get_ui_state` (C6), the installer task and Doctor check (C7).

## PR C2: logs

### What was built

- **Three tools:** `query_logs`, `log_histogram`, `log_groups`, over the same routes and filters as the Logs page (service, level, regex, since, until, error group; `query_logs` also pages with `before`).
  - `query_logs` returns one line per entry (`#number time level service text`, a multi-line entry indented), not JSON, which is shorter and easier to read. It asks for the newest `limit` lines (default 100, at most 500; a bigger number is cut to 500 and the answer says so) and says how to get the older ones (`before=<number>`). One line is cut at 2,000 bytes; the whole answer at 200 KB, each with a note.
  - `log_histogram` gives the totals and buckets by level; `log_groups` the latest 50 kinds of error.
- **The connector's allow-list** now has the stack's logs, histogram and groups. What is captured (`.../logs/capture`), the saved filters, deleting logs and every write stay refused.

### Checked

- Table tests for each tool (arguments, escaping of names in the path, paging, the limit cap, refusals, cut lines and answers).
- `TestConnectorReadsMaskedLogs` takes lines with a fake password, a fake credential in a URL and a fake token in a JSON line through the real intake (the sink, which masks) into the real log routes, reads them with the connector's header and asserts the fake value is in none of the answers, while the lines themselves still are. The guard's table test covers the new routes and the refused ones.
- `mise run lint:go` clean.

### Not here

- Filtering by a structured field (`field=name=value`), which the Logs page supports. It needs the syntax described to Claude first; add when asked for.
- Hosts (C3), resources and the YAML check (C4), the Claude access panel and audit (C5), `get_ui_state` (C6), the installer task and Doctor check (C7).

## PR C3: remote hosts

### What was built

- **Five tools:** `list_hosts`, `host_info` (the agent's version and stacks, which gives the stack ids the others need; not in the plan's list), `host_services`, `host_compose` (names of environment variables only, as the Remote hosts page shows them) and `host_logs`.
  - `host_logs` is a short read, not a stream: it asks for the last N lines (default 100, at most 200 per service), stops once the agent has gone quiet for 2 seconds, after 1,600 lines, or after 20 seconds, and shows the lines in time order, with a follower's own error after them. Every line is cleaned and **masked again here** with `logs.Redactor`, because host output is raw (the agent doesn't mask) and the Logs page's masking happens when lines are stored, which these never are.
- **Hosts are off for Claude until switched on** (plan §9): the connector's requests for `/hosts` get 403 "remote hosts are switched off for Claude" unless `<data dir>/claude-access.yaml` says `hosts: true` (`%AppData%\devdeck\claude-access.yaml` on Windows; read on every request, so no restart). A missing or unreadable file means off. The Claude access panel (C5) will write this same file.
- **The connector never opens a tunnel.** For anything that asks the agent (info, services, compose, logs) the server answers 409 "the host isn't connected: open it on the Remote hosts page first" unless that host's tunnel is already open. The list and a host's own view (no token, only whether one is saved) don't need a tunnel.
- **The server holds the host log tail** to 200 lines for the connector (a missing or larger `tail` is set to 200), whatever the connector asks for. Saving or deleting a token, closing a tunnel and every start, stop, restart, up, down and pull stay refused.
- `ConnectorGuard` now takes a `ConnectorPolicy` (`Access`, `HostConnected`); `api.Deps` has `ConnectorAccess`, set by the server to `api.FileAccess(<data dir>/claude-access.yaml)`.

### Checked

- Guard tables: every host route with the switch off, on with the tunnel closed, on with it open; another host's tunnel doesn't count; the tail clamp (none, too big, small, not a number); writes refused. `FileAccess` with no file, on, off, other areas, bad YAML and a live change.
- Tool tests: each read, devdeck's refusal messages passed through, strict arguments, and `host_logs` against a stream that stays open and quiet (it must end by itself), with a fake password that must come out masked, ANSI colours stripped, time order, and a silent host that never answers.
- `mise run lint:go` clean.

### Decisions

- A small file for the switch now, rather than waiting for C5's panel, so host access is off by default from the first PR that has it. To try it before C5, create `claude-access.yaml` in the data folder with the line `hosts: true`.
- Plan §4 (tools table) and §9 should list `host_info` and the file; the plan is updated in the next PR (this one is at the size limit).

### Not here

Resources and the YAML check (C4), the Claude access panel and audit (C5), `get_ui_state` (C6), the installer task and Doctor check (C7). Version and tag information for services (4C and 4D) will show in `host_compose` and `host_services` once the agent reports it.
