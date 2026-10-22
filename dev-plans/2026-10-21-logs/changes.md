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

- Parsers, levels and error groups (PR 3), filter queries and saved filters (PR 4), the Logs page with histogram, Errors panel and VS Code links (PR 5).
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
