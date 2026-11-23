# Phase 2, part 1: Doctor

Doctor checks that a machine is ready to start a workspace, before anything is started. It only reads: it runs `--version`, `docker info` and `git config`, looks at files and tries to open a port. It never installs or changes anything; a failed check says what to do and you do it.

## What it checks

| Group | Check | Fails when |
|---|---|---|
| Tools | Each tool the stacks need: Git always, Go / Node + npm / Python by service kind, Docker when a stack has a compose file | not installed, too old or not working |
| Tools | Docker is running | `docker info` doesn't answer |
| Repos | Each repo's folder exists and is a git repository | folder missing (fails), not a repo (warns), path leaves the workspace (fails) |
| Stacks | Compose file, service folder, env file, port free | file or folder missing, port already used |
| Git | Global name and email; per repo, the commit identity of its connection | missing (warns), different from the connection's identity (warns) |

A **failure** means a stack that needs it won't work. A **warning** means something looks off but a stack can still start, so `Report.Ready()` is true when nothing failed.

## Fix hints

Every failed check carries `fix`: commands to run, a link, or a sentence. Install commands come from the plugin manifest when the tool has a plugin (`git`, `docker`), and from a small built-in table for Go, Node, npm and Python until Phase 7 moves them into manifests. A missing env file points at `.env.example` / `.env.sample` / `.env.template` when one exists. The UI shows commands in a copy box, links as links and sentences as text.

## Code

- `internal/doctor` — `Run(ctx, Input)` builds a list of small jobs and runs them in parallel; the report keeps a stable order. `Probes` (tool check, Docker, port, git config) are injected, so the tests never touch the machine.
- `Input.Stack` limits the run to one stack and the repos it uses; this is what the pre-start gate (2.3.5) will call.
- `Input.OwnPorts` lists ports held by services devdeck itself is running, so a running stack doesn't fail its own port check. The supervisor fills it in.
- All paths from workspace files are joined under the workspace root and refused if they leave it.

## API

| Method and path | Does |
|---|---|
| `GET /api/v1/doctor?workspace=<id>` | Checks the whole workspace |
| `GET /api/v1/doctor?workspace=<id>&stack=<name>` | Checks one stack. 404 for an unknown workspace or stack, 422 when the workspace has errors |

## UI

The Doctor page has a workspace picker, a stack picker ("Whole workspace" by default) and **Check again**. The choice lives in the address (`?workspace=…&stack=…`). Results are grouped Tools / Repos / Stacks / Git; each row has the same status shapes as the rest of the app (dot, triangle, square) so colour is never the only signal. The shared `StatusMark` component now also draws the marks on the Workspaces page.

## Not done yet (rest of Phase 2)

- 2.1.3 Install missing tools from the UI (needs a confirm step and streamed output). Deferred until the other features are in; see the plan.
- 2.5 `devdeck up / down / status`: done, see `2026-10-19-cli/`
