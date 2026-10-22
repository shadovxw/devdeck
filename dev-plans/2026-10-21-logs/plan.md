# Phase 3: Logs, implementation plan

> Status: **approved (2026-10-21); PR 1 to PR 4 built, see `changes.md`** · covers plan §8 items 3.1 to 3.4 plus per-service capture control (D16)
> Reference UI: [`ui-mockup/logs.html`](../../ui-mockup/logs.html) · design tokens: [`02-frontend-design-system.md`](../02-frontend-design-system.md)

## 1. Goal and "done when"

Never hunt through terminals again: every line a service prints is collected in one place, searchable, with errors pulled out and linked to the code.

Done when (from the plan):

1. An error in any started service appears in the Errors panel, with a working VS Code link, **within 1 s**.
2. Filtering **500,000 lines returns in under 1 s**.
3. Plus what the first runs of Phase 2 showed we need: no colour-code garbage in messages, and no secret values stored or shown.

## 2. Where we start (facts from the code)

| Today | Consequence |
|---|---|
| `run.record` appends each line to a per-service slice capped at **500** and trims with `slices.Delete(ring, 0, 1)` | Fine at 500, quadratic at 50,000: needs a real ring buffer |
| `Supervisor.Lines()` and an `Options.OnLine` hook exist, but **no route** uses them and `main.go` doesn't set the hook | Nothing is visible in the UI yet |
| Lines come from `proc.Run` (scanner, 1 MiB max line) as streams `stdout`, `stderr`, `build`; compose output is recorded on the `compose*` pseudo-service | Process output is already captured; Docker **container** logs are not |
| The event bus never blocks (drops the **oldest** event for a slow subscriber); the WebSocket hub sends **one JSON message per event** and **disconnects** a client whose queue (256) fills | A raw line-per-event feed would disconnect the browser under load: lines must be batched |
| `sdk.LogParser` (`Parse(line) (LogRecord, bool)`) and `sdk.LogRecord` exist; `log_parser:` is already a field of a service in the stack YAML | The parser contract is half-built; it is single-line only (panics need more) |
| SQLite (`state.db`) exists with migrations | Available, but not the right place for append-heavy log lines (see D4) |
| Nav has a `/logs` page with an empty state; the Stacks page shows `last_error` | Page slot exists |

## 3. Design decisions

### D1. A new package, `internal/logs`, owns logs; the supervisor only feeds it
`supervisor.record` builds an `Entry` and hands it to a `logs.Sink` (an interface; a no-op by default so the supervisor's tests don't change). The supervisor keeps only the **last line** per service for `last_error`. `Supervisor.Lines()` becomes a thin call to the store's tail. `Options.OnLine` is replaced by the sink.

### D2. The entry
```
Entry { Seq uint64 (per stack, increasing), Time, Workspace, Stack, Service, Stream,
        Text (cleaned and redacted), Level, Message, Caller, Fields map, Fingerprint }
```
Parsing happens **once, at ingest**, and the result is stored, so a query never re-parses 500k lines. `Seq` lets a client detect a gap (dropped batch) and ask for what it missed.

### D3. In-memory ring buffer: 50,000 lines per service
A true circular buffer (no shifting). Rough memory: about 250 B per entry, so ~12 MB per service, ~150 MB for a 12-service stack at worst. Lines longer than 16 KiB are cut for storage and streaming (the original length is kept in a field); the pipe reader's 1 MiB limit stays.

### D4. Files: JSONL, one folder per service, rotated daily
`<data>/logs/<workspace>/<stack>/<service>/YYYY-MM-DD.jsonl` (date in **UTC**, shown in local time). A buffered writer flushes every 250 ms or 64 KB. Rotation = a new file when the date changes; **retention = delete whole files** older than 7 days, and oldest-first when the total passes 500 MB (both configurable, checked at startup and daily). Directories `0700`, files `0600`; names come from already-validated ids and are still joined with an "inside this folder" check.
*Why not SQLite:* log traffic is append-only and bursty, rotation by deleting files is trivial, and the files stay greppable. *Why not only memory:* the plan wants history that survives a restart.

### D5. Cleaning before anything is stored, shown or sent
In this order, **before** the ring, the file and the bus see the line:
1. **ANSI** colour and cursor codes removed (CSI and OSC), and carriage-return progress lines reduced to their last state.
2. **Redaction**, replacing values with `***`:
   - the **exact values** of the service's own secret-named env keys (the supervisor already loads them: `token`, `password`, `secret`, `api_key`, `private_key` in the name, value at least 6 chars): the strongest rule, no guessing;
   - patterns: `Authorization: Bearer …`, `key=value` and `"key":"value"` with secret-looking keys, JWT-shaped strings (`eyJ….….…`), PEM private-key blocks, `://user:pass@` in URLs.
   
   Limit, stated in the UI help: an unknown secret printed without a recognisable key can still get through.
3. Level and fields come from the parser (D8), not from the cleaning step.

### D6. Never block the service, never lose silently
The sink is a **bounded channel with one worker**. If the worker falls behind, the oldest queued lines are dropped and counted; a marker entry (`N lines dropped`) is written. A service's pipe is **never** stalled by logging.

### D7. Live delivery without breaking the hub
No hub change. The sink publishes **batches**: every 50 ms (or 200 entries) per stack, one bus event on topic `logs.<workspace>.<stack>` carrying `{from_seq, to_seq, entries[]}`. If the client's subscription drops a batch, it sees a `Seq` gap and refetches with `GET …/logs?after=<seq>`. The browser keeps at most 5,000 rows in memory and drops the oldest.

### D8. Parsers
- `sdk.LogParser` stays for single-line formats; add an optional **`sdk.LogGrouper`** (`Feed(line) → finished records, still pending`) for formats that span lines. Additive: existing plugins don't change.
- Built-in parsers: **`zerolog`** (JSON: level, time, message, caller, error, every other field kept), **`go-panic`** (a `panic:` or `fatal error:` line plus its goroutine and frame lines become **one** entry; level `fatal`; `Caller` is the first frame that is not `runtime/` or a vendored/module-cache path; flushed after 200 ms of silence), **`vite-log`** (Vite and TypeScript compile errors), **`plain`** (guess the level from words such as `ERROR`, `WARN`, `panic`, `fatal`; being on stderr alone does not make a line an error).
- Choice per service: the stack's `log_parser:` if set; otherwise auto, trying zerolog, then go-panic, then vite, then plain, per line.

### D9. Error groups
Fingerprint = hash of service + level + the message with numbers, UUIDs and ULIDs, hex, IPs and durations replaced by placeholders + the top frame. A group keeps count, first seen, last seen and a sample entry. Groups are built at ingest and rebuilt from today's file at startup (bounded). They are not persisted separately.

### D10. Query
Filters: services, levels, regex (Go RE2: linear time, so no pathological patterns; pattern limited to 500 chars), `field=value` (dotted path), since/until, a group fingerprint. Paging by `Seq` (`before`/`after`, default 1,000, max 10,000). It reads the ring first, then files **newest first** until the limit is met; a time range picks files by date and skips by time inside a file.
**Acceptance, measured:** a Go benchmark builds 500k lines and the test fails if a typical filter (service + level + regex) takes over 1 s on the CI runner. If a plain scan misses it, add a per-file index of time offsets before anything fancier.

### D11. API (all behind the existing Host/Origin guard; reads only except Clear)
| Route | Does |
|---|---|
| `GET /workspaces/:id/stacks/:stack/logs` | Entries matching the filters, plus `next_before` |
| `GET …/logs/groups` | Error groups |
| `DELETE …/logs?service=…` | Deletes a service's stored logs (confirmation in the UI; a write action) |
| `GET/PUT/DELETE /workspaces/:id/log-filters` | Saved filters (YAML in the workspace, with a JSON Schema like the other files) |
| WebSocket topic `logs.<workspace>.<stack>` | Live batches (D7) |

### D12. VS Code links
The server resolves each `Caller` to a file **inside the service's repo** (absolute path inside it, relative joined to it, or a suffix match) and returns `where: {file, line}` **only if the file exists**. The browser builds `vscode://file/<path>:<line>`. Nothing outside the workspace root is ever linked.

### D13. Docker container logs
For each compose file, after `up --wait`, run `docker compose -f <file> logs -f --no-color --timestamps --since <t> [services]` as a long-lived child. Lines are attributed to `compose-<repo>/<container service>` by the line prefix. It stops with the stack and restarts with backoff if it exits while the stack runs (using `--since` the last timestamp to avoid duplicates).

### D14. UI (Logs page; reference mockup)
- Filter bar: services (checkboxes), level, regex, field = value, since; Live / Pause, Clear (view only), Save filter, saved-filter chips.
- Virtualised stream (batched per animation frame): columns time, service, level, message, fields, where; JSON-shaped rows show as columns; click a row for the full record; click Where to open VS Code.
- **Level histogram** over time (stacked bars per minute, status colours with legend, shapes as well as colour) with drag-to-filter; drawn as plain SVG, no chart library.
- Errors panel (groups, count, first/last seen); clicking a group filters the stream to it.
- "Ask Claude about this error": **disabled with a tooltip** until Phase 10.
- Stacks page: each service gets a **Logs** link into the page with that service filtered.
- Flat style, tokens only, Geist Mono for data, dark first with a working light theme, status never by colour alone, keyboard operable.
- Virtual list: **hand-rolled windowing** (fixed row height) so no new web dependency is needed; revisit only if variable heights are required.

### D16. Per-service capture control (added after review)
Every service, and every container of a compose file, has its own capture rule:

| Mode | Meaning |
|---|---|
| `all` (default) | store every line |
| `matching` | store only lines whose cleaned text matches a regex (Go RE2, at most 500 chars) |
| `off` | store nothing: the service runs as usual, only its **last line** is kept for `last_error`. For a compose container, devdeck does not even follow its Docker logs |

- **Default in the stack file**, per service and per compose container:
  ```yaml
  services:
    - id: api
      logs: { store: matching, match: "(?i)error|warn|panic" }
  compose:
    - repo: keycloack-local
      file: docker-compose.yml
      logs:
        keycloak: { store: off }      # keyed by the compose service name
  ```
  Checked when the file is validated: `match` must compile, is required for `matching` and not allowed otherwise.
- **Start and stop at run time, without editing the file:** `PUT/DELETE /workspaces/:id/stacks/:stack/logs/capture/:service` and a toggle in the UI. A run-time choice is saved (in devdeck's `settings` table, key `logs.capture.<workspace>.<stack>.<service>`), beats the file, and `DELETE` goes back to the file's rule. Changes apply to the next line, and start or stop the Docker follower at once.
- The rule is applied **before** anything is stored, parsed or published (so a paused chatty service costs almost nothing), and on the cleaned, redacted text.
- The stack-wide default of keeping everything stays; this is the control for the noisy ones (Keycloak first).

### D15. Config and privacy
`DEVDECK_LOG_DIR` (default `<data>/logs`), `DEVDECK_LOG_RETENTION_DAYS` (7), `DEVDECK_LOG_MAX_MB` (500). **TODO:** make retention and size editable in the Settings page when it is built (the environment variables stay as the defaults). Logs are never sent to Claude, MCP, or any network (the future "Ask Claude" sends only after an explicit click, redacted). Documented: redaction is best effort.

## 4. Delivery in five pull requests

Each one ends green (Go and web tests, lint, govulncheck, Sonar gate) and keeps `changes.md` current; the last also writes `dev-plans/NN-logs.md` (the phase summary CLAUDE.md asks for).

| # | PR | Contents | Size |
|---|---|---|---|
| 1 | **Ingest** | `internal/logs` (entry, ring, files, retention, ANSI + redaction, capture rules, sink with drop counting), supervisor wiring, config, `logs:` in the stack YAML, `GET …/logs` (service, limit, before/after), capture-control routes, batched WebSocket topic, a minimal live view per service on the Stacks page with a Storing / Paused toggle | L |
| 2 | **Docker logs** | D13 for compose files, following each container only while its capture rule is not `off` | M |
| 3 | **Parsers and groups** | `LogGrouper`, zerolog / go-panic / vite / plain, auto-detect, level, caller, fingerprint, groups endpoint | L |
| 4 | **Query and saved filters** | filter engine, ring + files scan, the 500k benchmark gate, `log-filters` API and schema | M |
| 5 | **Logs page** | filter bar, live/pause, expand, columns, histogram with brush, Errors panel, VS Code links, Clear with confirm, nav and Stacks links | L |

After PR 1 you can already see every service's output live; after PR 3 errors are grouped; after PR 5 the "done when" can be checked end to end.

## 5. Tests

- **Table tests:** ANSI stripping; redaction (each rule, exact-value rule, near misses that must **not** be redacted); ring wrap-around; file rotation with a fake clock; retention by age and by size; fingerprint normalisation; every parser with sample lines (synthetic zerolog, a real-shape Go panic, Vite errors; nothing from a private codebase); query filters; saved-filter schema.
- **Supervisor integration:** extend the `fakesvc` test program to print JSON lines, a panic, ANSI text and a secret; assert what reaches the ring, the file and the bus.
- **API:** each route's statuses, paging, the `Seq` gap path, Clear.
- **Web (Vitest):** live append, pause, gap refetch, windowing, filter bar, histogram brush, group click, link building.
- **Gates:** the 500k benchmark; a goroutine-count check after a stack stops (no leaked readers or workers); `-race` on Linux CI.
- **By hand with a real stack** before each PR is called done, as in Phase 2.

## 6. Security checklist (CLAUDE.md)

Secret values never stored, shown or sent (D5); files `0600`, folders `0700`; paths from validated ids and checked to be inside; routes read-only except Clear, which confirms; nothing leaves the machine; no `Math.random` ids (rows are keyed by `Seq`); no CDN scripts; no key-shaped strings in fixtures (test secrets are built at run time, not written as literals).

## 7. Decisions

1. **Retention: 7 days and 500 MB total.** Approved. **TODO:** customisable from the Settings page later.
2. **Docker container logs:** not one global switch. Each service and container gets its own rule (`all` / `matching` regex / `off`), with start and stop at run time, so noisy ones like Keycloak can be paused and used only when needed (D16).
3. Hand-rolled list windowing (no new web dependency). *Assumed, not yet confirmed.*
4. File dates in UTC, shown in local time. *Assumed.*
5. On restart, show the last lines from today's file. *Assumed.*
6. PR order as in §4. *Assumed; PR 16 is merged.*

## 8. Out of scope here

Alerts and notifications (Phase 5), "Ask Claude" (Phase 10), remote or shared logs (Phase 14), log shipping, and metrics.
