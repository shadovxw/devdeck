# Changes: several compose files, compose-only stacks, `requires`

- `internal/workspace`: `StackFile.Compose` is `Composes` (one file or a list, `UnmarshalYAML`); new `Require`; schema `stack.schema.json` takes `compose` as object or list, `requires`, and no longer demands `services`; semantic checks for a list's repos and paths (issue paths follow how it was written), reserved `compose*` service ids, a stack with nothing to run, and loopback-only `requires`.
- `internal/supervisor`: `StackSpec.Compose` is a list; each file is its own dependency with an id (`ComposeSpec.ID`), all started before any service and stopped after them; compose ids can't be restarted by hand.
- `internal/doctor`: a check per compose file (numbered when there are several) and per `requires` entry; new `Probes.Dial`.
- `web`: `StackDef.compose` is a list; `composeIds` mirrors the server's naming; `serviceLabel` and `isComposeId` replace the `id === "compose"` checks (Boot sequence, Home, Stacks page).
- Tests added in each package: list and object forms, compose-only plan and run, several files start before and stop after services, requires pass and fail, ids, web helpers.

## Found by running it

- The gateway's compose file has a healthcheck that runs `wget`, which the image doesn't have, so its container always shows "unhealthy" and `docker compose up --wait` (what devdeck runs) fails on it even though the gateway answers. Fix the healthcheck in that repo (or give it a command the image has).
- `devdeck down <stack>` runs `docker compose stop`, which also stops containers the stack adopted (they were already running). Expected, but easy to forget.

## Verified live

`up full` against a real server: Keycloak, Vault, Garage (with its one-shot init), the gateway, five Go services and the Vite app all became ready from one command (compose files first, in parallel; services built and started after); `down full` took 8 s and left no process, port or container behind. The gateway needed its healthcheck fixed in its own repo (`bash` over `/dev/tcp`, since its image has no `wget`); it is now `healthy`.

## Dev ports

devdeck's own dev UI moved from 5173 to 5174 (`web/vite.config.ts`, `mise.toml`, `README.md`), so a workspace's own Vite app can keep 5173, which its auth redirect settings expect.

## One-shot containers and `up --wait`

`docker compose up -d --wait` fails about one run in four with `container <name> exited (0)` when a stack has a one-shot init container (Garage's `garage-init`): whether it fails depends on whether Compose looks before or after the container finishes. The stack was fine. When `up --wait` fails, devdeck now asks `docker compose ps --all --format json` and counts the start as successful if every container is running (and healthy, where it has a healthcheck) or exited with code 0. Anything else (unhealthy, still starting, exit code other than 0, not started) is still a failure. (`internal/supervisor/compose.go`, `supervisor.go`; table test in `compose_test.go`.) Eight start/stop cycles of the storage stack in a row all passed.

## Compose files as steps in the start order; stop and start one service by hand

Asked for: Vault and Garage first (and fine if they crash), then NATS, the gateway, auth, the four Go services, then Keycloak and the web app, and a Stop and a Start button on every row.

- **Stack file:** a compose entry may have `id`, `after` and `optional`.
  - Give every compose file an id, or none (mixing is refused). Without ids nothing changes: every service waits for all compose files.
  - With ids, a compose file is a step like a service: it starts after the steps in its `after`, and a service (or another compose file) waits for it only if it lists it. Ids share one namespace with the services (`compose` and `compose-*` stay reserved), `after` is checked for unknown ids and loops, and the stack's start order and its reverse (stop) order cover both.
  - `optional: true`: if it fails, its row shows the error, a line is written to the logs ("failed to start, carrying on without it"), what waits for it carries on, and the stack stays "running" rather than "needs attention". A required compose file that fails still blocks what waits for it.
- **API:** `POST …/stacks/:stack/services/:service/stop` (204 when the process is gone) and `…/start` (202), for services and compose files. A stopped service is not restarted by devdeck; starting it again counts as a restart. Refused (404) when the stack isn't running, and while the stack is stopping. `ServiceStatus.optional` tells the UI and the CLI.
- **Supervisor:** `run.svc()` reads the current record under the lock, because starting a service that was stopped by hand replaces its record. Stopping the whole stack afterwards still works.
- **Web:** Stop (square) and Start (play) beside the restart (loop) button on every row, greyed out when they don't apply; compose rows get them too but no restart; an "optional" tag; the start-order diagram follows the new order.
- **CLI:** `devdeck up` no longer exits 1 for an optional step that didn't start; it says so on stderr.
- **Fix found while testing:** the one-shot check (`up --wait` failing on a finished init container) looked at every container of the Docker project, and two compose files in one folder share a project, so a broken file looked started because its neighbour's container was running. It now looks only at the services the file is meant to bring up, and every one of them must have a container.
- **Test fix:** `TestRestartPolicies` counted 10 ms from the start of a freshly built test program, whose first start on Windows can take longer than the 100 ms settle time. The test program is now run once before the tests.
- Tests: ordered start and reverse stop, an optional failure that carries on (and its log line), a required failure that blocks, planning and loops, stop and start of a service and of a compose file, the API routes, the CLI, the web row buttons and the diagram.

Your `all-service` stack (`full.yaml`) now uses this order.

## Found by running the new order for real: the web app never became ready, and compose ports were blank

- **Slow first request to a dev server.** The `frontend` step failed after its 60 s timeout although Vite was up: the HTTP readiness check gave up after 2 s per try, and Vite's first request on a cold start takes 2.5-6 s, so every try timed out. The per-try timeout is now 10 s (the step's own `timeout` still limits the whole wait). `internal/supervisor/probe.go`, `probe_test.go` (a server that answers after 3 s counts as ready).
- **`ready.log` and colour codes.** The log check ran on the raw line, so a coloured "ready" line (Vite, Next) never matched. It now matches the line with colour codes removed. Test in `order_test.go`.
- **Ports of compose steps.** A compose entry has no `port` field, so the Port column and the start-order diagram were blank for Vault, Garage, the gateway and Keycloak. When a compose file is up, devdeck now asks `docker compose ps --format json` for the ports its containers publish on the host and shows them (`ServiceStatus.ports`; "3900, 3903" in the table, `:3900 :3903` in the diagram). Only the file's own services count; unpublished ports are left out. `compose.go` (`composePorts`), `supervisor.go` (`dockerComposePorts`), tests in `compose_test.go`, `order_test.go` and `web/src/pages/service-control.test.tsx`.
