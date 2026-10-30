# Changes: the remote agent

## PR 1: the agent, read-only

### What was built

- **`internal/compose`** holds what devdeck reads from Docker Compose, now shared by the local supervisor and the agent: `Project` (folder, files, env files, and the start of every `docker compose` command), `ParsePS` (both shapes `ps --format json` has printed), `ParseLogLine` (the timestamped lines of `logs --timestamps --no-log-prefix`), and `ParseView`. The supervisor's own copies of the first two were removed; it uses these.
- **The compose view** runs `docker compose config --format json --no-interpolate`, so nothing from an env file is filled in, and keeps per service: image as written (`${API_IMAGE}`), build or not, ports, `depends_on` with conditions, health check, volumes, restart policy, and **the names of the environment variables only**. Values written straight into the compose file are dropped, and so are command lines and labels. A test feeds it an inline value and checks it never comes out.
- **`internal/agent`**, `devdeck agent`:
  - `agent.yaml`: listen address, token file, and any number of stacks (id, name, folder, compose files, env files, versions file, `allow_write`, `after`, up script). It refuses a listen address that isn't loopback, ids that aren't lowercase, a relative folder, files outside the folder or shaped like an option, `after` naming nothing or going round in a circle, and unknown keys.
  - The token: at least 32 characters, from a file only its owner can read (checked on Linux), compared in constant time. `devdeck agent token` prints a new one.
  - Every request passes three checks, in order: an audit line (method, path, status, time; never a header), the Host must be a loopback name (so a web page can't reach the agent through DNS rebinding while a tunnel is open), and the token.
  - `GET /v1/info` (version, API version, stacks with their ids, names, `allow_write` and `after`; never folders or files), `GET /v1/stacks/{stack}/compose`, `GET /v1/stacks/{stack}/services`, and `GET /v1/stacks/{stack}/logs?service=&since=&tail=`.
  - **Logs stream** as newline-delimited JSON `{service, ts, line}`. One follower per service (`docker compose logs --follow --timestamps --no-log-prefix`), so every line knows its service, merged into one response and flushed line by line. Without `since`, the last 200 lines (`tail`, at most 5000). A heartbeat line goes out at the start and every 25 s, so an idle SSM tunnel isn't closed and a dead client is noticed. A follower that ends sends an error line for its service. A service must be one `config --services` lists.
  - Docker runs through `sdk/proc` with argument lists only; the runner is an interface, so the tests replace docker.
  - `devdeck agent check` checks the configuration and the token and lists the stacks, for the bootstrap script to run before starting the service.
- **`internal/remote`**, devdeck's side:
  - `Client`: `Info` (and refuses an agent that speaks another API version), `Services`, `Compose`, `Stream` (one connection) and `Follow`.
  - `Follow` reconnects after a dropped connection with a growing wait (1 s to 30 s), from the oldest point any service had reached, and skips a line not newer than the last one taken for its service, so nothing is lost or repeated. It gives up only on a refusal retrying can't fix (bad token, unknown stack or service, bad request).
  - `devdeck remote info|services|compose|logs --url ... --token-file ...` (or `DEVDECK_AGENT_TOKEN`), to check an agent by hand through a tunnel.
- **The Linux build** is one static file: `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./cmd/devdeck` (about 21 MB), since nothing needs C.

### Checked for real

On Windows with Docker Desktop (there is no Docker inside WSL here), with a throwaway compose project of two `alpine` services (one ticking every second, one with an inline "secret"): `agent check`, `remote info`, `remote services` (running, healthy), `remote compose` (the variable's name shown, its value not), a wrong token (401), live logs of both services, and **the agent killed and restarted mid-stream: ticks 49 to 62 arrived with no gap and no repeat**. The project was removed afterwards.

### Changed from the plan

- The `Runtime` interface (and the local supervisor behind it) moves to PR 2, where the web pages first need it. PR 1 has no web changes; the agent is checked with `devdeck remote` instead.

### Not in this PR

Hosts in the workspace, the SSM tunnel, the web pages (PR 2); start, stop and the other writes (PR 3); versions (PR 4); the bootstrap script and release builds (PR 5).

## PR 2: hosts, the SSM tunnel and the Remote hosts page (merged, #25)

### What was built

- **Hosts in `workspace.yaml`**: `hosts: [{id, name, type: aws-ssm, aws: {instance, region, profile}, agent_port}]`, in the types, the JSON schema (instance, region and profile patterns) and the checks (an id used twice; an aws-ssm host without `aws`).
- **`remote.Tunnels`**: every connection to an agent goes through a dialer that opens `aws ssm start-session --document-name AWS-StartPortForwardingSession` on demand, waits until the agent answers, keeps the same local port across restarts, restarts a tunnel that died, and closes one that nobody used for 5 minutes. What the AWS CLI prints is turned into what to do: sign in again (`aws sso login --profile ...`), install the plugin, a profile that isn't set up, a role that may not start a session, an instance not connected to SSM, nothing listening on the agent's port.
- **`remote.Hosts`**: lists the hosts of local workspaces, keeps each token in the OS keychain (`host/<workspace>/<host>`), never returns it, and makes clients through the tunnel.
- **API** `/api/v1/hosts`: list; `GET /:ws/:host`; `PUT|DELETE /:ws/:host/token` (write-only); `POST .../disconnect`; `GET .../info`; `GET .../stacks/:stack/services|compose`; `GET .../stacks/:stack/logs` (newline-delimited JSON, kept going across tunnel drops).
- **Doctor**: the AWS CLI and the Session Manager plugin as tools when the workspace has hosts (whole-workspace runs only, never a stack's preflight), and a "Signed in to AWS as profile ..." check per profile (`aws sts get-caller-identity`), in a new "Remote hosts" group.
- **Web**: a **Remote hosts** page (`/hosts`, its own "Run remotely" group): each host with its instance, region and profile, connection state (shape and word), the token form (password field, saved to the keychain, Replace and Forget), Connect / Try again / Disconnect, the reason when it can't connect, and per stack: Services (state, health, image, ports, a Logs button per row), Compose (variable names only) and live Logs (all services or one).
- Tests: workspace hosts, tunnel (fake AWS CLI serving a real agent: shared tunnel, idle close and reopen on the same port, a connection in use keeps it open, a dead tunnel restarts, every failure explained), the hosts API end to end, Doctor, and the page (8 tests). Go and web suites pass (one supervisor test, untouched here, flaked once under load and passes alone).

### Found by trying it

- **The plugin installed after devdeck started wasn't found.** The AWS CLI runs `session-manager-plugin` from the PATH, and the PATH devdeck has is the one of the terminal that started it. `sdk.ToolPath` now also looks where the installers put the AWS CLI and the plugin (`%ProgramFiles%\Amazon\...` on Windows, `/usr/local/...` elsewhere); the tunnel adds the plugin's folder to the PATH it gives the AWS CLI, and Doctor's tool checks and the sign-in check use the same lookup, so they don't call an installed tool missing.
- **The reason a tunnel failed came wrapped in HTTP wording** ("the agent couldn't be reached (is the tunnel open?): Get "http://127.0.0.1/v1/info": ..."). Tunnel failures are now a `TunnelError` that the client passes on as it is.
- Checked for real: an SSM port forward to the instance opens with the `devdeck` SSO profile; with no agent there yet, the plugin reports "Connection to destination port failed", which devdeck turns into "is `devdeck agent` running there?".

### Checked on a real host

The agent (a pre-release build, tag `agent-dev-1`) was put on the first host by hand and the page connected through the tunnel; the stacks, services and live logs showed. The install steps used are in [plan.md §12](plan.md#12-where-we-are-and-what-is-next-read-this-first); they become `bootstrap.sh` in PR 5.

## PR 3, part A: the agent can start, stop and restart (agent only)

The agent on a host now offers writes. devdeck's side (client, API, buttons) is the next PR; nothing in devdeck calls these routes yet, so this is safe to deploy on its own.

### What was built

- **Routes** (`internal/agent/actions.go`): `POST /v1/stacks/{stack}/services/{svc}/{start|stop|restart}` and `POST /v1/stacks/{stack}/{up|down|pull|script}`. The list of actions is fixed in code; anything else is a 404, so a request can't name a command.
- **`down`** only stops the containers by default; `?mode=down` removes them. Volumes are never removed and there is no way to ask.
- **`script`** runs the stack's `up_script` from `agent.yaml` (a path inside `dir`, never from the request). A stack without one answers 400.
- **`allow_write`** is checked on every write: a read-only stack answers 403 and nothing runs. A service must be one that `docker compose config --services` returns (404 otherwise).
- **One write at a time per stack:** a second one gets 409 `busy: restart api is still running`.
- **Streamed answer:** newline-delimited JSON, `{"line":...}` as the command prints (stdout and stderr, because Compose prints its progress on stderr), heartbeats while it is quiet, and a last `{"done":true,"ok":...,"error":...}`. The HTTP status is 200 once the stream begins, so a failure shows in that last line.
- **Not tied to the request:** a write runs to its end (or 15 minutes) even if the tunnel drops, so an `up` is never left half started. The stack stays locked until it ends.
- **Audit line per write** in the journal (`journalctl -u devdeck-agent`): stack, action, service, duration and the error if any. Never output, arguments, files or the token.
- `Runner` gained `Exec`; `DockerRunner.Exec` runs docker, or the up script when a program is given.

### Tests

Handler tests with a fake runner (every action and its exact command, refusals, 403/404/400/405/401, the lock, a client that goes away, heartbeats, the failure and timeout endings, the audit line) and a real child process for `DockerRunner.Exec` (both streams, a non-zero exit, a program that can't start). Package coverage 87.8%.

### Left out on purpose

Up all / Down all (one stack on the first host, so nothing to order) and a list of protected services (offered, not asked for).

### Putting it on the host

Build `GOOS=linux CGO_ENABLED=0 go build -o devdeck ./cmd/devdeck`, replace the binary the unit runs, set `allow_write: true` on the stack in `agent.yaml`, and `systemctl restart devdeck-agent`.

## PR 3, part B: start, stop and restart from the Remote hosts page (devdeck only)

devdeck's side of part A. The agent needs no change: it only has to be the build from part A with `allow_write: true` on the stack. A stack the agent keeps read-only shows no buttons, so this is safe to deploy before or after the agent.

### What was built

- **`remote.Client.Act`** (`internal/remote/client.go`): asks the agent for a write (`Action{Stack, Service, Name, Mode}`). A refusal (writes off, busy, no such service) is an `*Error` before any output. `ActionRun.Each` hands over the output lines and returns nil when the agent says it worked, an `*ActionError` with the agent's reason when it failed, and a different error when the connection broke first ("the action may still be running on the host"), because then the outcome isn't known.
- **API:** `POST /api/v1/hosts/:ws/:host/stacks/:stack[/services/:svc]/:action[?mode=down]` (`internal/api/hosts.go`). A refusal is an error status (403 writes off, 409 busy, 400 bad request, 404 unknown, 409 no token saved); once the agent accepts, the output streams back as newline-delimited JSON in the agent's own shape, ending with `{"done":true,"ok":true}` or `{"done":true,"error":...}`. The agent finishes the write even if the page goes away.
- **Page** (`HostActions.tsx`, `HostsPage.tsx`, `useHostAction` in `lib/hosts.ts`): on a stack with `allow_write`, **Start/Stop and Restart** on each service row, and **Up, Pull, Run up script, Stop all, Remove containers** above the table. Every write asks first in a confirmation that says what will happen; nothing is sent before Confirm. While one runs, every write button is disabled. The output and the result ("Restart api: done" / "Pull failed" with the reason) stay until dismissed, and the services table refreshes when a write ends.
- **Stop all** stops the containers; **Remove containers** is a separate button (`?mode=down`). Volumes can't be removed from here.

### Tests

- Go: the client against a real agent with a fake runner (a service write, a stack write with mode, a failed write, every refusal before output, a stream that ends without saying how); the API end to end through the tunnel (output and result, a failure after it began, 403/404/400, no token, unknown host).
- Web (Vitest): no buttons on a read-only stack; ask first and Cancel sends nothing; restart shows output and refreshes; Stop for a running service and Start for a stopped one; a failure with its reason; Stop all versus Remove containers; a busy refusal; a stream that ends early.

### Not here

Versions (PR C/D), Up all / Down all, and showing whether a stack has an up script (a stack without one answers "no up script" when asked; the agent's `info` would have to say, which means a new agent build).

### Where it stands (2026-10-30)

- Part A is merged (#29) and runs on the first host. Part B is committed on `feat/host-writes-ui` (`d1fe40e`) and was tried in the app against that host; it is not pushed yet.
- Done by hand on the first host for the next PRs: `.env` split into `.env` and `versions.env`, `agent.yaml` pointed at both (believed done; the image check passed). **Not done:** editing the stack's up script to read both env files, and checking whether the up script's extra compose file must be in the agent's `files`. Both are in [plan.md §12](plan.md#12-where-we-are-and-what-is-next-read-this-first), with the next PRs (4C agent versions, 4D devdeck Versions panel).
