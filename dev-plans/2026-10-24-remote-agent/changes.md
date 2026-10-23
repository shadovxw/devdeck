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
