# Changes: CLI

- `plan.md`: the CLI is a client of the running server (the supervisor owns the processes and stops them when the server closes), so there is no second owner to leave orphans.
- `internal/cli` (new): `Run` with `up`, `down`, `status`, `help`. `up` starts the stack and polls `GET /runs` every 500 ms, printing each service's state once per change; exit 0 when every service is ready, 1 on a failed or blocked service, a refused start (the failed Doctor checks and their fixes are printed) or a stack stopped meanwhile, 130 on Ctrl-C (the stack keeps starting; the message says how to stop it). `--detach` returns once the server accepts the start. An already-running stack is followed instead of treated as an error. `-w` picks the workspace; without it the only workspace of the user's own is used, never a sample.
- `internal/config`: `ListenAddr` split out of `Load`, so the CLI uses the same loopback rule as the server.
- `cmd/devdeck/main.go`: `up`, `down`, `status`, `help` go to the CLI; `serve` or no command runs the server; any other word is a usage error (before, extra words were ignored).
- Tests: table tests against a fake server (`internal/cli/cli_test.go`), 95.8% of statements.

## Found by running it against real services (frontend, catalog, automation of a real workspace)

- **`.env` files with inline comments** (`RATE_LIMIT_RPS=100 # per second`): `LoadEnvFile` passed the comment on as part of the value, so the service refused to start. A ` #` after an unquoted value, or after the closing quote of a quoted one, now starts a comment; `pa#ss` is kept whole. (`internal/supervisor/command.go`, test in `spec_test.go`)
- **Port check on Windows**: a program listening on `0.0.0.0` does not stop a bind to `127.0.0.1`, so Doctor called a taken port free, and a stack's readiness probe could be answered by someone else's service (the CLI printed "running" for a stack whose own process was crash-looping). `portFree` now also tries to connect. A start on a taken port is refused with the failed check and its fix. (`internal/doctor/doctor.go`, `port_test.go`)
- **Colour codes in error text**: Vite's output carries ANSI codes, which showed as `[2m[32m` in the CLI. `oneLine` strips them. (The supervisor still keeps them in the stored error; Phase 3 log work should strip them there.)
- Vite listens on `localhost`, which Node 24 on Windows binds to `::1` only, so a `ready.http` of `http://127.0.0.1:<port>/` never answers. Stack files for Vite apps should use `http://localhost:<port>/`.

## Verified live (real server, real binary)

`status` with nothing running; `up` catalog (go, built, ready on `/health`), frontend (node via `npm run dev`, ready), automation (go); a failing service ends with exit 1 and the reason; `up` of a running stack follows it; unknown stack and taken port give plain messages and exit 1; `down` leaves the ports free. No process of devdeck's was left behind.

## CI on PR 16

- **govulncheck** failed on GO-2026-6809 (crypto/x509, fixed in Go 1.26.10), reachable through the CLI's HTTP client. `go.mod` now says `go 1.26.10`, which CI's `go-version-file` picks up. A local `govulncheck@v1.9.0` run (the version CI uses) reports no vulnerabilities.
- **SonarQube** gate failed only on new security rating (rule go:S5332, "Using HTTP protocol is insecure", `internal/cli/cli.go`). The base URL is now built with `net/url`, and a comment says why plain HTTP is fine: `config.ListenAddr` only accepts loopback addresses.
