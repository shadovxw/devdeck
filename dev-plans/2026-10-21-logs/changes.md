# Changes: Phase 3 Logs

## PR 1: Ingest (this change)

- **`internal/logs` (new):**
  - `Clean` strips colour and cursor codes and reduces a rewritten progress line to its last state; `Truncate` cuts a line at 16 KiB without splitting a character.
  - `Redactor` masks secrets: the exact values of the service's secret-named env variables (value of 6 or more characters), `key=value` and `"key":"value"` with secret-looking keys, Authorization headers, JWTs, credentials in URLs, and private-key blocks. Numbers, booleans and already-masked values stay readable (`token_count=5`).
  - `ring` is a real circular buffer (50,000 lines per service by default).
  - `Store` keeps the rings and writes `<logs dir>/<workspace>/<stack>/<service>/<UTC date>.jsonl` (folders `0700`, files `0600`, a compose container's `/` becomes `__`), reads the latest lines back after a restart, removes files past retention (7 days) and then the oldest while over 500 MB (never the file being written), and answers paged queries (newest, `before`, `after`, one service).
  - Capture rules (`all`, `matching` regex, `off`): defaults from the stack file, overrides at run time saved in the `settings` table, an override beats the file.
  - `Sink` never blocks a service: a bounded queue, one worker, oldest lines dropped and counted (with a marker line), and live batches (50 ms or 200 lines) published on `logs.<workspace>.<stack>`.
- **Stack files:** `logs: {store, match}` on a service and `logs:` keyed by container on a compose entry (schema, decoding, validation with line numbers: `match` must compile, is required for `matching`, not allowed otherwise).
- **Supervisor:** `Options.OnLine`, `Supervisor.Lines` and the 500-line ring are gone. A `LogSink` takes every line, the service's env (to mask its secrets) and the stack file's rules. `last_error` is cleaned and masked (no more `[2m[32m`, no secrets).
- **Config:** `DEVDECK_LOG_DIR`, `DEVDECK_LOG_RETENTION_DAYS`, `DEVDECK_LOG_MAX_MB`.
- **API:** `GET …/stacks/:stack/logs` (`service`, `limit`, `before`, `after`), `GET/PUT/DELETE …/logs/capture` (`?service=`, because a compose container's id has a slash), the live topic. Names are checked before any file is touched.
- **Web:** a Logs button on each stack card opens a windowed log view (fixed row height, follows the newest line until you scroll up), a service picker, Pause / Resume (catches up on resume, and re-fetches when a batch was lost), Clear view (view only), and "What is stored" per service: Stop storing, Start storing, Only matching…, Reset. Not offered for sample workspaces.
- **Tests:** Go (`internal/logs`: clean, redaction near-misses, ring, files and rotation, retention, restart read-back, capture rules and their persistence, name safety, the sink's filtering, truncation, batching and dropping; plus workspace, supervisor, config and API tests) and web (11 tests for the log view and the rules).

## Verified live (real binaries, a throwaway workspace with a made-up chatty service)

- Colour codes gone, the env password and a `token=` value masked, a progress line reduced to its last state, stderr marked, a `matching` service storing only its ERROR lines.
- Live batches reached a WebSocket client with a median delay of 21 ms (max 44 ms) and consecutive numbers.
- Stop storing stopped growth; Only matching changed it at once; Reset went back; a bad pattern got 422.
- After a hard kill and restart the stored lines were read back from the files and the run-time rule was still there. No child process was left behind.

## Known gaps (planned in later PRs)


- A failed write of a log file is not reported anywhere yet (the lines still reach memory and the live view).
- `TestRestartPolicies` in the supervisor package fails when run alone on a cold machine (a fresh test program starts slower than its 10 ms exit); it passes in the full package run.

# PR 2: Docker container logs

A compose file's containers now have their output collected like a service's, under the id `<compose id>/<container>` (for example `vault/openbao`), with the same cleaning, masking, storage, retention and capture rules.

- **How:** once a compose file is up, devdeck runs one `docker compose -f <file> logs --follow --no-color --no-log-prefix --timestamps --since <t> <service>` per container. One process per container (not one for the file) because without the prefix every line belongs to exactly one container, and each can then be started and stopped alone. `--since` starts at the moment the compose step began, so older history from earlier runs isn't pulled in. (`internal/supervisor/follow.go`)
- **Capture rules decide whether to follow at all:** a container whose rule is `off` is not followed (no Docker process, nothing read). Rules are looked at once a second, so switching a container on or off, in the UI or the API, takes effect within about a second. While off, its `since` moves forward, so switching it on later starts from then: what it printed while paused is not stored (verified: ticks 25 to 39 skipped).
- **Duplicates and restarts:** each container remembers the time of the last line taken and skips anything not newer. If Docker ends a follower (Docker restarted, container ended), it is started again from that time after 1, 2, 4 ... 30 s. The first failure of a streak writes one `[devdeck] couldn't follow this container's logs, trying again: ...` line to the container's logs; the retries are silent.
- **Containers show up before they print:** the compose file's service names are announced to the log store (`LogSink.Announce`), so the capture list shows every container, with its rule, from the start. That is how a container set to `off` in the file can be switched on again.
- **Stopping:** followers end with the compose step, on a stack stop and on a stop of just that compose file by hand; the compose goroutine waits for them, so no `docker logs` process outlives the step.
- **Interfaces:** `LogSink` gains `Announce` and `Wanted`; `Options` gains `ComposeNames`, `ComposeFollow` and `FollowPoll` (defaults run Docker, and only when `Compose` is the real one, like `ComposePorts`). `logs.Store` gains `Announce` and `Wanted`.
- **Tests:** followed and attributed to the container, an `off` container not followed and followed from now once switched on (and its follower ended when switched off again), restart from the last line without repeats and with one failure line, followers ended on stack stop and on stopping one compose file, the docker arguments and the timestamp parsing; store tests for `Announce` (unsafe names ignored) and `Wanted`; a sink pass-through test.

## Verified live (real Docker, a throwaway workspace with two alpine containers)

- Container lines arrived under `talk/chatty` with `token=` masked; the container set to `off` in the stack file (`talk/quiet`) was listed in the captures with rule `off` / source `file`, and nothing was stored for it.
- `PUT .../capture?service=talk/quiet` with `all`: lines started within seconds. `off` on the chatty one: its stored count stopped growing, and only the other `docker compose logs` process was left running. `all` again: the lines resumed from the present, with the paused stretch missing.
- `devdeck down`: no `docker compose logs` process remained.

## Known gaps

- A container that is already running before devdeck starts shows only what it prints from the moment the stack starts (older output isn't imported).
- The compose row itself still carries the output of `up` and `stop`; the Stacks page's Logs button lists containers by their `<id>/<container>` name.

# PR 3: parsers, levels, panics and error groups

Every stored line now carries what the parser found in it, read once when the line arrives (so a later query never re-parses). New fields on an entry, all optional in the JSON: `level` (trace, debug, info, warn, error, fatal), `message`, `caller` (`file:line`), `fields` and `fingerprint`.

- **Parsers** (`internal/logs/parse.go`), chosen per service by `log_parser:` or `logs: { parser: ... }` in the stack file (also for compose containers) or at run time (`parser` in the capture PUT; a run-time rule without a parser keeps the file's). `auto` (the default) tries each of these on every line:
  - **`zerolog`:** a JSON object with a level or a message. Level from `level`, `severity` or `lvl` (strings, and pino's numbers); message from `message` or `msg`; caller from `caller` or `source`; the time keys are left out because the entry has its own time; every other key is kept in `fields` (at most 64 keys, strings cut at 2 KiB, only for lines that fit the stored text). The usual spellings of zap, slog and pino parse too. JSON that isn't a log record stays plain text.
  - **`vite-log`:** TypeScript errors (both layouts, with file and line as the caller), esbuild `[ERROR]`/`[WARNING]` lines, Vite's "Internal server error", "error during build" and "Pre-transform error".
  - **`go-panic`:** the lines of a `panic:` or `fatal error:` become **one** entry (level `fatal`, the first line as the message, all lines as the text). The caller is the first frame that is the program's own code: not `runtime/`, not the Go standard library, not a vendored or downloaded module. The group ends at `exit status N`, at the first line that can't belong to a trace, at 300 lines or 32 KiB, or after 200 ms of silence (a ticker in the sink, so it is published without waiting for another line), and when the stack stops. Its time and stream are those of its first line. Lines are cleaned and redacted before they are put together.
  - **`plain`:** the level is guessed from words (`ERROR`, `[warn]`, `level=debug`, `panic:`, TypeScript-style `error TS1234:` ...). Being on stderr says nothing. A line with no sign is `info`. Near misses stay `info` ("0 errors found", "terror").
  - A named parser reads its own format and falls back to plain for other lines, so every line has a level.
- **Capture rules see the whole record:** a `matching` rule is tested on the grouped text, so one matching line in a trace keeps the whole panic.
- **Fingerprint and groups** (`internal/logs/groups.go`): only `error` and `fatal` entries get a fingerprint: a hash of service, level, the message with ids, numbers, addresses, durations and hex replaced by placeholders, and the caller. `GET /workspaces/:id/stacks/:stack/logs/groups` lists the groups (fingerprint, service, level, a sample message, caller, count, first and last seen, newest entry number), latest first. At most 1000 per stack (the one seen longest ago is dropped). Groups are counted as lines arrive and rebuilt from the stored lines when a service is first looked at after a restart (so as far back as its in-memory window).
- **Stack file:** `log_parser` is now one of `auto, zerolog, go-panic, vite-log, plain` (the schema says so; it used to name a plugin), and a rule's `parser` takes the same names. `logs:` no longer needs `store` when it only sets a parser.
- **Web:** types for the new entry fields, `LogGroup` and the rule's `parser` (the Logs page itself is PR 5).
- **Tests:** every parser with sample lines (synthetic; no private code), near misses, field limits, the panic grouper (one record, caller choice, ended by a line, by silence, by `exit status`, capped, not fooled by ordinary lines), fingerprint stability and what must change it, group counting, order, the 1000 limit and rebuild after a restart, the sink end to end (levels, a panic put together, a quiet panic published, rules on whole panics, the service's parser), parser name precedence, the groups route, schema and planning of `log_parser`.

## Verified live (real binary, a throwaway workspace, a made-up program printing each kind of line)

- JSON lines gave level, message, caller and fields; three "user N not found" errors shared one fingerprint and became one group with count 3; the TypeScript error got its file and line; a colour code was stripped; a panic printed on stderr with no `exit status` was published as one fatal entry after the silence, with the right caller, and the line after it was a separate entry.
- With `log_parser: plain` the same JSON lines stayed text (level still guessed), each error line was its own group, and the panic was a single fatal line.

## Known gaps

- The Logs page does not show levels or groups yet (PR 5); filtering by level, field or group is PR 4.
- Groups reach only as far back as a service's in-memory window (50,000 lines), not the whole 7 days on disk.
- `warn` lines have no fingerprint, so they are not grouped.

# PR 4: query filters, reading the files, saved filters

`GET /workspaces/:id/stacks/:stack/logs` now filters, and a workspace can keep saved filters.

- **Filters** (`internal/logs/query.go`), all optional and all of them must match:
  - `service` (repeat, or a comma list; `<compose id>/<container>` for a container), `level` (repeat or comma list; case blind; an entry with no level counts as `info`), `regex` (Go RE2, at most 500 characters, tested on the stored text, so it sees a whole panic), `field=path=value` or `path!=value` (repeat; the path is dotted for nested fields and also finds a key that itself has a dot; numbers compare as text without a needless `.0`; an entry without the field passes `!=`), `since` and `until` (RFC 3339, or how long ago: `90s`, `15m`, `2h`, `7d`, at most a year), `group` (an error group's fingerprint from `/logs/groups`), plus the paging that was already there (`before`, `after`, `limit`).
  - A mistake in a filter is a **400** with the reason ("the pattern isn't valid: ...", "level must be one of ...", "until is before since"); an unsafe service name is still a 404. Limits: 50 services, 20 field filters.
- **Where it reads:** each service's lines in memory, newest first, stopping as soon as it has one more than the page needs (that extra one tells whether there is a next page, so `next_before` is exact). Only when a service's memory is full and the page isn't filled does it read that service's day files, newest day first and not at all for days outside `since` and `until`; it skips what memory already covered by reading the entry number at the start of each line, and stops a file at the first line that is not older. The files are read without holding the store's lock, one goroutine per service, so a slow scan can't hold up new lines.
- **The 500,000 line gate** (plan D10), a test in `query_test.go` (skipped with `-short`): 10 services of 50,000 lines each, a typical filter (4 services, level error, pattern) took **6 ms**; a pattern nothing matches, looking at every line in memory, **86 ms**; a rare match that is only in the files of 500,000 lines (memory held 10,000 per service) **0.7 s** on this machine. The test fails over 1 s for the first two and 5 s for the file scan. CI runs Go tests with `-race`, which is several times slower, so under it the limit is 15 s and the file-scan case is skipped (build tags in `race_on_test.go` / `race_off_test.go`); this wasn't run with `-race` here, since Windows has no C compiler for it. No per-file index was needed.
- **Saved filters** (`internal/logs/filter.go`, `internal/workspace/logfilters.go`, `internal/api/logfilters.go`): kept in `log-filters.yaml` in the workspace folder (read strictly: an unknown key is an error; at most 100 filters and 256 KiB; written aside and renamed over the old file). A filter has `id`, `name` and any of `stack` (only offered for that stack), `services`, `levels`, `regex`, `fields` and `since` (relative or absolute, written as a query takes it). `GET /workspaces/:id/log-filters` lists them (sample workspaces too), `PUT .../log-filters/:id` adds or replaces (201, or 200 when it replaced one; 422 with the reason when it isn't valid), `DELETE .../log-filters/:id` removes it (404 if there is none). Sample workspaces can't be changed (403). A JSON Schema for editors is in `internal/workspace/schemas/log-filters.schema.json`; the server validates in Go, with the same checks a query gets.
- **Web:** `lib/log-query.ts` with the query and saved-filter types and the query-string builder the Logs page will use (PR 5).
- **Tests:** every filter and combinations, paging through filtered results, reaching into the files across days (and paging through a whole history without gaps or repeats), refusals, `ParseField`, `ParseWhen`, field comparison, filter validation, the 500k gate; the workspace store (add, replace in place, delete, strict reading, limit, samples read-only, no temporary files left); the routes (URL filters, specific refusals, saved-filter CRUD, samples); the web query builder.
- `TestRestartPolicies` (PR 2's supervisor tests) failed on a loaded machine because its "exits before it was ready" case relied on the program starting within 100 ms; that case now has a readiness check that can never pass, so it no longer depends on speed.
- One existing test changed on purpose: `TestRingKeepsOnlyTheNewest` now checks what memory holds directly, because a query goes on into the files.

## Verified live

On a throwaway workspace with the lines of PR 3 (read back from their files after a restart): filters by level, pattern, field (`user=43`, `user!=43`), group, and time gave exactly the expected entries; a bad pattern answered with its reason; a saved filter was created (201), listed, written to `log-filters.yaml`, and deleted (204), leaving no temporary file.

## Known gaps

- Counting for the level histogram (PR 5) isn't an endpoint yet; the page can count what it has loaded, and PR 5 adds a counting route if that isn't enough.
- A query is limited to 5,000 entries a page; very large exports aren't a goal.

# PR 5: the Logs page

The last piece of Phase 3. The phase summary is in [`../13-logs.md`](../13-logs.md).

## Server

- **`DELETE .../logs[?service=]`** deletes what is stored: the lines in memory, the day files and the error groups of one service or of the whole stack (`Store.Clear`; capture rules are kept; services that were never read in are found on disk; a folder outside the log folder is never touched). Answers `{"removed_files": n}`. The page asks for a confirmation first.
- **`GET .../logs/histogram`** takes the same filters as the logs route and counts the matching entries by level and time (`Store.Histogram`): the range is `since` to `until` (the last hour up to now by default), the bucket is a minute for up to an hour, then 5 and 15 minutes, an hour, 6 hours (never more than 400 buckets). It reads memory, and the day files only for a service whose memory doesn't reach back to the start of the range.
- **`GET .../logs/where?service=&caller=`** says where a line's caller points: `{file, line}`, with the absolute path, only when that file exists inside the service's own repo (for a container, its compose file's repo). The path may be relative, absolute inside the repo, or from another machine (matched by its longest tail of at least two folders and a name that exists in the repo). Anything else, a sample workspace, an unknown service or a file outside the repo is a 404.

## Web

- **`/logs`** (`pages/LogsPage.tsx`, `pages/logs/*`, `design/LevelMark.tsx`, `lib/log-stream.ts`, `lib/log-api.ts`, `lib/log-query.ts`):
  - A workspace and a stack (the running one by default), the filter bar, and the filters in the address (`service`, `level`, `q`, `field`, `since`, `until`, `group`), so a view can be bookmarked and shared.
  - **Filter bar:** a service picker (the services that have lines or a rule), the six levels as toggles, a pattern box, field filters as chips, a time range. The pattern waits for a pause in typing and for a pattern the browser can read; Go-style `(?i)`, `(?s)` and `(?m)` flags at the start are turned into the browser's. Active filters (fields, one error group, an end time) show as chips that can be removed.
  - **Stream:** a windowed list (fixed 22 px rows, no new dependency) that follows the newest line while live and the reader is at the end. Live lines are tested in the browser against the same filters, a skipped batch or a reconnecting socket asks the server for what was missed, Pause and Resume catch up, and older lines load on demand. Arrow, Page, Home and End keys move the selection, Escape lets go of it.
  - **Level histogram** in plain SVG with a drag to narrow the view to a stretch (that sets `since` and `until`, stops following live, and offers "Back to live"). Each level has a shape and a word in the legend, and in the list; colour is never the only sign.
  - **Errors panel:** the error groups, most recent first; one click shows only that group's lines, another lets go. A live line that carries a fingerprint refreshes the panel at once (at most once a second), with a poll every 5 s as the fallback. The histogram polls every 5 s while live.
  - **Selected line:** full text, level, time, fields, "Open file:line in VS Code" (a `vscode://file/...` link, shown only when the server found the file), "Show every line like this", and a disabled "Ask Claude about this error" (tooltip: Phase 10).
  - **Saved filters:** save the current filters under a name (a relative time range is kept; a dragged-out stretch is not), chips to apply one, a confirmation before deleting. Sample workspaces can't save or clear.
  - **Clear…** asks "Delete the stored logs of <service> / every service of this stack?" and says it removes the files, not only the view.
- **Stacks page:** each service row (not compose files) has a link to its logs.
- The old per-stack panel on the Stacks page stays as it was, with its own capture controls ("What is stored").
- **Test settings:** Testing Library's async wait is 5 s and Vitest's test timeout 15 s (`src/test/setup.ts`, `vite.config.ts`), because three of the older page tests failed now and then on a busy machine when the whole suite ran at once.

## Tests

- Go: clearing one service and all (files, memory, groups, rules kept, services never read in, unsafe names); the histogram (levels, a missing level as info, filters, the default range, bucket widths and the 400 limit, reading the files, refusals); caller resolution (relative, absolute, another machine's tail, outside the repo, bad lines) and the three routes.
- Web: the page end to end against a mocked server and socket (stored lines with level words, histogram and errors; levels, pattern, field filters; live lines filtered; fingerprint refresh; pause and resume; the selected line, its link or its plain caller; arrow keys; error groups; the histogram drag and "Back to live"; saving, applying and deleting filters; clearing with its confirmation; samples; a refusal from the server), the live matcher against the server's rules, the address round trip, the service link on the Stacks page.

## Verified live

On a throwaway workspace (real binary, a second Vite server on another port, the page opened in the browser pane): the stored lines of the earlier runs with their levels and fields, the histogram with its legend, the error groups, the selected line with its fields, and "Show every line like this" narrowing the list and the histogram.

## Known gaps

See [`../13-logs.md`](../13-logs.md).
