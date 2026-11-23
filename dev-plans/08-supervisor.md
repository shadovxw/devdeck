# Phase 2, part 2: Supervisor

The supervisor starts the services of a stack in order, waits until each one is ready, watches them, restarts the ones that crash and stops everything without leaving a process behind. It has no screen of its own: the Stacks page (next PR) shows what it does.

## What it does

1. **Checks the machine first.** `Start` runs Doctor for just that stack. If anything fails it refuses with the whole report, and nothing starts. Warnings don't stop it.
2. **Starts Compose dependencies.** `docker compose -f <file> up -d --wait [services]`. Every service waits for it.
3. **Starts services in order.** A service starts when everything in its `after` list has been ready once. Services with no dependency between them start together.
4. **Builds Go services first.** `go build -buildvcs=false -o <data>/bin/<workspace>-<stack>-<service>` and then runs that file, so a restart is quick and the process is a real one.
5. **Decides when a service is ready:** its `ready.http` answers with a status below 400, `ready.tcp` accepts a connection, or `ready.log` text shows up in its output. With none of those, a service that has a `port` is checked on that port; one with neither counts as ready once it has stayed up for half a second. Timeout is `ready.timeout`, default 30 s.
6. **Watches and restarts.** A crash shows at once. With `restart: on-failure` (the default) or `always` it waits 1 s, 2 s, 4 s … (up to 30 s) and starts again, and gives up after 5 crashes in a row. A service that ran for 30 s is forgiven earlier crashes. `never` fails on the first crash. A program that is missing, or doesn't become ready in time, fails without retrying.
7. **Blocks what can't start.** If a service fails, the ones that wait for it show `blocked` and say why. The rest keep running and the stack shows `degraded`.
8. **Stops in reverse order.** Services that depend on others stop first, then the ones they depend on, then `docker compose stop`.

A service can be restarted by hand (Go services are rebuilt first). The same call retries a failed or blocked one.

## Safety

- **Only your own workspaces run.** A stack's `cmd` is a program devdeck starts, so the API refuses the read-only sample workspaces (403) and any workspace that still has errors (422).
- **No shell.** Commands are split into a program and arguments. `&&`, `|`, `;`, `>` and `&` are refused with a message to put the steps in a script.
- **Paths stay inside their repo.** The repo folder, service folder, env file and compose file are all kept under the workspace root.
- **Env files are read when a service starts** and passed to that process only. Errors name the line, never the value. Values from an `env:` block win over the file.
- **No orphans.** Each program runs in its own process group (a Job Object on Windows, closed with devdeck, so killing devdeck also kills what it started; checked by hand). Closing devdeck stops all stacks first.

Known limits: output lines can contain secrets, and are kept in memory (last 500 per service) and shown in a service's error text without redaction. Phase 3 adds redaction. Stopping is a hard kill, with no grace period for the program to shut down.

## Code

- `internal/supervisor/spec.go`: `Plan` turns a checked stack into a `StackSpec` (absolute paths, split commands, ready rules); `Levels` orders services and rejects loops.
- `command.go`: `SplitCommand`, `LoadEnvFile`.
- `supervisor.go`: `Supervisor` (`Start`, `Stop`, `StopAll`, `RestartService`, `Status`, `List`, `OwnPorts`, `Lines`), options, `PreflightError`.
- `run.go`: one stack's run: a goroutine per service, state changes, readiness, restarts, stopping.
- Every state change is published on the bus as a `RunStatus` on the topic `stacks.<workspace>.<stack>` (subscribe to `stacks.*` on `/ws`).
- Tests use a small fake service (`testdata/fakesvc`) that can listen, print, crash, exit and hang, so no real stack is needed.

## API

| Method and path | Does |
|---|---|
| `GET /api/v1/runs` | Every stack that is running, with each service's state |
| `POST /api/v1/workspaces/:id/stacks/:stack/start` | 202 with the first status. 403 sample workspace, 404 unknown, 409 already running, 422 workspace errors, a stack that can't run, or machine not ready (body has `message` and the Doctor `report`) |
| `POST /api/v1/workspaces/:id/stacks/:stack/stop` | 204 once nothing is left running; 404 if it isn't running |
| `POST /api/v1/workspaces/:id/stacks/:stack/services/:service/restart` | 202 |

`GET /api/v1/doctor` now treats ports held by a running stack as free of conflict.

## Verified by hand

A real devdeck binary built and ran a Go service and a second service in order, saw an external kill of the API in about half a second and restarted it, stopped cleanly (no process or open port left), and a hard kill of devdeck took its children with it. That run found one bug that the tests missed: `go build` refuses to build in a repo with a damaged `.git`, so builds now pass `-buildvcs=false`.

## Still to do in Phase 2

- 2.4 Stacks page: start and stop buttons, live status from `stacks.*`, boot sequence, Home wired to real data
- 2.5 `devdeck up / down / status`
- 2.1.3 install missing tools from the UI
