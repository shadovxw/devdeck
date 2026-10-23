# Remote agent, milestone 1: compose, versions, logs and control

> Status: **for review** · the first usable slice of [`plan.md`](plan.md). Everything else in that plan (host health, image clean-up, unsealing, web UIs, host actions, secrets) comes after this.

## 1. What you get

From devdeck on your laptop, for each stack on the EC2 instance:

1. **The compose file, read:** the services, their images, ports, dependencies, health checks and volumes.
2. **The versions file, read and changed:** each service's image tag, changed one at a time or several together, applied, and rolled back.
3. **All the logs:** live, for one service or the whole stack, in the Logs page with its search, filters and histogram.
4. **Control:** start, stop and restart one service; up, down and pull for a stack; run the stack's own up script; up all and down all across stacks in order.

## 2. Scope, exactly

### In

| Area | What |
|---|---|
| Agent | `devdeck agent` with `agent.yaml` (several stacks), token, `allow_write` per stack, audit log, systemd unit |
| Read | stacks, compose view, service status, versions, change history |
| Logs | follow one service or all services of a stack; resume after a dropped connection |
| Control | start, stop, restart (service); up, down, pull (stack); run up script; up all, down all |
| Versions | set one or several tags, apply them, roll back |
| devdeck | hosts in the private workspace, SSM tunnel manager, host switcher in Stacks, compose view, Versions panel, Doctor checks |
| Setup | Linux build, `bootstrap.sh`, the `.env` / `versions.env` split |

### Out (later)

Host CPU/RAM/disk, image clean-up, OpenBao unsealing, web UIs through the tunnel, host-defined actions, viewing or editing secrets, splitting the current project into two stacks (it works as one stack with two files), Helm.

## 3. The compose view (and why it isn't the raw file)

Your compose file has values written straight into it, some of them secret (an SMTP password, an access key). So the agent never sends the file as text. It runs `docker compose config --format json --no-interpolate` (which reads the files without filling in `.env`) and returns, per service:

- name, container name, image (as written, for example `${AUTH_SERVICE_IMAGE}`, and as resolved from `versions.env` only)
- ports, `depends_on` with conditions, health check (command and timings), volumes and bind mounts, restart policy
- **environment: the names only**, never the values

devdeck shows this as a table per stack, and a small dependency list per service ("waits for postgres to be healthy, keycloak to start").

## 4. The versions file

### The split, done once

`.env` today holds secrets and tags. The tags move to `versions.env`:

```
# versions.env: image tags only, nothing secret. devdeck's agent may change this file.
AUTH_SERVICE_IMAGE=acme/auth-service:1.0.34
CATALOG_SERVICE_IMAGE=acme/catalog-service:1.0.88
```

- `bootstrap.sh split-env` does it: it moves every `*_IMAGE=` line from `.env` to `versions.env`, keeps `.env.before-split`, and prints the diff. A dry run shows the result first.
- Compose then reads both: `--env-file .env --env-file versions.env`. The up script gets the same two arguments (the bootstrap prints the one-line change; Compose 2.24 or newer is checked).
- The agent reads and writes `versions.env` only. It never opens `.env`.

### Reading

`GET /v1/stacks/{stack}/versions` returns, per service whose image comes from a variable: the variable, repository, tag in the file, and the tag the running container actually has. A difference ("file says 1.0.35, running 1.0.34") is shown, so a change that was saved but never applied is visible.

### Changing and applying

`PUT /v1/stacks/{stack}/versions` with `{changes: [{service, tag}], apply: true}`:

1. Checks: the stack allows writes; each service exists and has an image variable; each tag matches `^[A-Za-z0-9_.-]{1,128}$`.
2. Writes `versions.env` atomically (a temporary file, then rename), keeps `versions.env.prev`, appends to `changes.log`: time, stack, service, old tag, new tag.
3. If `apply`: `docker compose pull <services>`, then `docker compose up -d --no-deps <services>`, then waits (up to 2 minutes) for each to run, and to be healthy if it has a health check.
4. Answers with each service's result. A failed pull puts the file back as it was. An unhealthy service is reported with its last 50 log lines; the file keeps the new tag and the page offers **Roll back**.

`apply: false` only saves, for when you want to apply with the up script instead.

**Roll back** = the same request with the previous tags from `changes.log`.

## 5. Logs

- `GET /v1/stacks/{stack}/logs?service=<svc>&since=<RFC3339>`: one service, or all of the stack's services when `service` is empty.
- The agent runs `docker compose logs --follow --timestamps [--since] [<svc>]` and streams each line as it comes, as `{"service":"…","ts":"…","line":"…"}` per line (newline-delimited JSON).
- devdeck feeds each line into the existing Logs pipeline (parsers, groups, ring and day files), tagged with host and stack, so search, filters, groups and the histogram work as for local stacks.
- On a dropped tunnel devdeck reconnects with `since` = the last timestamp it stored, and drops the lines it already has. Nothing is lost or doubled.
- Lines are followed only while something needs them (the Logs page or a stack page is open, or capture is switched on for that stack), so an idle laptop holds no stream open.

## 6. Control

| Action | Command on the host | Needs |
|---|---|---|
| Start / stop / restart a service | `docker compose start\|stop\|restart <svc>` | write + confirm |
| Up a stack | `docker compose up -d` | write + confirm |
| Down a stack | `docker compose stop` (default) or `down` (removes containers; volumes are never removed) | write + confirm, `down` named in the dialog |
| Pull a stack | `docker compose pull` | write |
| Run the up script | the script named in `agent.yaml` (`up_script: ./dev-up.sh`), run in the stack's folder, output streamed back | write + confirm |
| Up all / down all | each stack in `after` order, waiting for health between them | write + confirm |

- Every command is an argument list; the up script is a path from `agent.yaml`, never from the request.
- One action at a time per stack (a lock); a second request gets "busy: restarting auth-service".
- Long actions (up, pull, the script) stream their output to the page as they run.
- `down -v` (deleting volumes) is not offered at all.

## 7. The agent's API (version 1)

```
GET  /v1/info                                  version, API version, stacks (id, name, allow_write)
GET  /v1/stacks/{stack}/compose                the compose view (§3)
GET  /v1/stacks/{stack}/services               status per service (state, health, image, started, ports)
GET  /v1/stacks/{stack}/logs?service=&since=   streamed (§5)
POST /v1/stacks/{stack}/services/{svc}/{start|stop|restart}
POST /v1/stacks/{stack}/{up|down|pull|script}  streamed output
POST /v1/up-all, /v1/down-all                  streamed output
GET  /v1/stacks/{stack}/versions               (§4)
PUT  /v1/stacks/{stack}/versions
GET  /v1/stacks/{stack}/changes                the change history
```

All behind the token. Errors are JSON `{message}` with 400 (bad input), 403 (writes off for this stack), 404, 409 (busy), 502 (docker failed, with its message).

## 8. Code layout

| Where | What |
|---|---|
| `internal/compose` | The compose code the local supervisor has now (ps parsing, logs follow, up/stop), moved out so the agent and devdeck share it; `config --no-interpolate` reading |
| `internal/agent` | config (`agent.yaml`), server and routes, token and audit middleware, versions file (read, atomic write, history), action locks |
| `internal/remote` | devdeck side: hosts, SSM tunnel manager, HTTP client implementing `Runtime` |
| `internal/runtime` | the `Runtime` interface; the local supervisor adapted to it |
| `internal/api` | `/api/v1/hosts/...` for the web app, passing through to the client |
| `cmd/devdeck` | `devdeck agent --config /etc/devdeck/agent.yaml` |
| `agent/bootstrap.sh` | install, config, token, systemd, `split-env` |
| `web/` | host switcher on Stacks; remote stack page (services, compose view, Versions panel, change history); Logs page shows host and stack |

## 9. PRs

| PR | Contents | Done when |
|---|---|---|
| 1 | `internal/compose` shared; agent config, token, audit; `info`, `compose`, `services`, `logs`; client with resume; `devdeck remote` to check by hand. **Built, see `changes.md`** | An agent's stacks, compose view and live logs show through `devdeck remote`, and a dropped connection resumes without loss |
| 2 | `Runtime` (moved here from PR 1); hosts in the workspace; SSM tunnel manager with reconnect; Doctor checks (AWS CLI, Session Manager plugin, signed in); host switcher; logs into the Logs page | One click on the EC2 host shows its stacks and their logs |
| 3 | Control (§6) with locks, `allow_write`, confirmations, streamed output | A service restarts and the up script runs from devdeck; a read-only stack refuses |
| 4 | Versions (§4): read, change, apply, roll back, history; `split-env` | A tag change pulls and recreates one service; Roll back restores it |
| 5 | Linux release build with checksums; `bootstrap.sh install`; walkthrough for a new instance | A fresh instance is visible in devdeck after running the script |

## 10. Tests

- Go, agent: table tests for the config, the tag pattern, the versions file (read, change, atomic write, history, roll back); handler tests with docker replaced by a fake runner (as the supervisor tests do); a real `docker compose` test that runs only when Docker is there (skipped on CI where it isn't).
- Go, devdeck: client against an `httptest` agent; tunnel manager with the `aws` command replaced; log resume (no loss, no doubles).
- Web: Vitest for the host switcher, compose view, Versions panel (change, apply, roll back, failure), confirmations.
- By hand, on the real instance: logs, a restart, a tag change and a roll back.

## 11. What I need from you before PR 2

- ~~The instance's architecture~~: `x86_64`, so the first release build is `linux/amd64` (arm64 can be added later at no cost).
- The AWS profile name you sign in with, and the instance id or its Name tag (these go in the private workspace, not here).
- Whether the AWS CLI and the Session Manager plugin are installed on your laptop (devdeck's Doctor will also tell you).
