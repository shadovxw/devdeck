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
