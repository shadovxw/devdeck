# CLI: `devdeck up / down / status` (plan §8, item 2.5)

## Goal

Start, stop and look at a stack from a terminal, without opening the browser.

## Decision: the CLI is a client of the running server

Stacks are run by the supervisor inside the devdeck server, and the server stops them when it closes. A CLI that started services on its own would need a second owner for the processes (and a way to find them again), so it would break "no orphans". So:

- `devdeck` (no arguments) and `devdeck serve` run the server, as today.
- `devdeck up | down | status` call the server's HTTP API on `127.0.0.1` (address from `DEVDECK_ADDR`, same loopback rule as the server) and print the answer.
- If the server isn't running, the command says so and how to start it. It does not start one.

No new server routes and no auth: the API's Host/Origin guard already lets a request with no `Origin` through, which is what the CLI sends.

## Commands

| Command | Does |
|---|---|
| `devdeck up <stack> [-w <workspace>]` | Starts the stack, then prints each service's state as it changes until the stack is running or something failed. Exit 0 when every service is ready, 1 otherwise. `--detach` returns as soon as the server accepts the start. |
| `devdeck down <stack> [-w <workspace>]` | Stops the stack and waits until nothing is left. |
| `devdeck status` | One line per stack that devdeck has started, with its services. Exit 0 even when nothing runs. |

Workspace: `-w` gives the workspace id. Without it, the one workspace of yours is used when there is exactly one; with none or several the command lists the ids and exits 2. Sample workspaces are never picked.

A refused start (machine not ready) prints the failed Doctor checks and their fixes, exit 1.

## Where it lives

`internal/cli`: argument parsing, an HTTP client for the five calls, output. `cmd/devdeck/main.go` only chooses between the server and the CLI. Progress is read by polling `GET /runs` every 500 ms, so the CLI needs no WebSocket.

## Tests

Table tests against a fake server (`httptest`) for: workspace resolution, `up` reaching running, `up` with a failed service, a refused start, `down` of a stack that isn't running, `status` empty and with runs, server not running, bad arguments.

## Done when

`devdeck up full` against a real server starts the stack and exits 0 once ready; `devdeck down full` leaves no process behind; `devdeck status` agrees with the Stacks page.
