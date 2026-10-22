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

- Docker container logs (PR 2), parsers, levels and error groups (PR 3), filter queries and saved filters (PR 4), the Logs page with histogram, Errors panel and VS Code links (PR 5).
- A failed write of a log file is not reported anywhere yet (the lines still reach memory and the live view).
- `TestRestartPolicies` in the supervisor package fails when run alone on a cold machine (a fresh test program starts slower than its 10 ms exit); it passes in the full package run.
