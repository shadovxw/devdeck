# Next steps (written 2026-10-30, for starting a new session)

A new session reads this file first, then [`CLAUDE.md`](../CLAUDE.md), then the section of the plan it works on. Facts about the owner's real host and organisation are **not** in this public repo: they are in the assistant's private memory, or the owner tells you. Never write them into code, docs or tests here.

## Where things are

| Piece | What | State |
|---|---|---|
| Remote agent PRs 1 to 3B | The agent, the SSM tunnel, the Remote hosts page, start/stop/restart/up/down/pull/up script | merged (#25 to #30) |
| Claude Code connector | `devdeck mcp`: read-only tools, access switches, audit list, prompts. Guide: [`docs/claude-connector.md`](../docs/claude-connector.md); plan: [`2026-10-30-claude-connector/`](2026-10-30-claude-connector/plan.md) | merged (#32, #35) |
| Docker accounts and builds | Several Docker Hub accounts, `images:` and build secrets in `workspace.yaml`, build and push by tag, editing a workspace. Guide: [`docs/docker-builds.md`](../docs/docker-builds.md) | merged (#36) |
| Versions and Deploy | Agent versions (read, change, apply, roll back, history), the Versions tab, named agent tokens, Deploy after a build, neutral test names. Guide: [`docs/remote-versions.md`](../docs/remote-versions.md); what changed: [`2026-10-24-remote-agent/changes.md`](2026-10-24-remote-agent/changes.md) | built; **check whether it is merged** (`git log`, `gh pr list`) |
| Teammate setup | [`docs/teammate-setup.md`](../docs/teammate-setup.md), with a prompt for a teammate's own Claude | written (in the last PR) |
| Features (PR stacks) | One `dev-plans` folder per feature with `feature.yaml`, per-repo layers, review tools per branch. Plan: [`2026-11-03-features/`](2026-11-03-features/plan.md) | planned; waiting for the owner's answers in its §10 |

Run `git log --oneline -10` and `gh pr list --state all --limit 10` first: this table may be behind.

## 1. The owner's steps on the first host (no code)

Nothing of the last PR has run on a real host yet. In this order:

1. **Put a new agent build on the host.** Build and publish a Linux build with a **new** release tag (`agent-dev-3` if it isn't taken; never reuse a tag), then swap it in as in [`2026-10-24-remote-agent/plan.md` §12](2026-10-24-remote-agent/plan.md#12-where-we-are-and-what-is-next-read-this-first) ("How an agent build gets onto a host today"). `devdeck agent check` before restarting; keep the old binary as `devdeck.prev` for a rollback.
2. **Make compose read both env files** in the stack's up script (`export COMPOSE_ENV_FILES=.env,versions.env` near the top, or the `sed` in [`docs/remote-versions.md`](../docs/remote-versions.md)), and check whether the up script uses compose files the agent's `files` doesn't list (compare `docker compose --dry-run ... up -d` for both sets; a `Recreate` line means they differ).
3. **Add `versions_file: versions.env` to the stack in `agent.yaml`** if it isn't there (it must also be in `env_files`), then restart the agent.
4. **Try it in this order:** *Save only* on one service, then *Deploy* one service, then *Roll back* that change, all from Remote hosts, Versions. Write down anything odd: a first real run usually finds a few things.
5. Optional: give each teammate their own named token (see `docs/remote-versions.md`, "Who did it").

## 2. PR 5: release builds and bootstrap (next code)

Goal: a teammate downloads an installer, and a fresh host goes from nothing to visible in devdeck with one script. Today the agent binary is built and copied by hand, and the host is set up by hand.

- **Release workflow in CI** (on a version tag): build and attach to the GitHub release the Windows installer (`mise run package` does it locally: needs Inno Setup), the Linux agent (`GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w"`), and a `SHA256SUMS` file. Keep the existing `agent-dev-N` pre-release convention until this exists.
- **`agent/bootstrap.sh`**: checks Docker and Compose 2.24 or newer, creates the `devdeck` user (or documents running as an existing user), downloads a **pinned** release and refuses it if the checksum doesn't match, writes `agent.yaml` from arguments, makes the token file(s) (mode 600), installs and starts the systemd unit, and prints what to do in devdeck (the host entry and the token to paste). Plan: [`2026-10-24-remote-agent/plan.md` §6 and §7](2026-10-24-remote-agent/plan.md#6-where-the-agent-binary-comes-from).
- **`split-env`**, with a dry run: the script version of the by-hand steps in `docs/remote-versions.md` (move the `*_IMAGE=` lines to `versions.env`, keep `.env.before-split`, print the diff, check `compose config --images` against `docker ps`).
- **Docs**: a walkthrough for a new instance (the AWS side is in plan §7), and update `docs/teammate-setup.md` to point at the release downloads instead of "the installer you were given".
- Also decide then: **Windows code signing** (an unsigned installer shows a SmartScreen warning on first run; the desktop plan says how to get past it for now).

## 3. Smaller follow-ups (any order)

- **`protected_services` in `agent.yaml`**: refuse stop and restart for the database and the secrets store from devdeck. Offered in PR 3, not built. Probably the best safeguard to add next.
- **The agent says whether a stack has an up script** in `info`, so the Run up script button only shows when it can work (needs a new agent build).
- **MCP tools for the new parts**: `host_versions` (read versions through the connector, under the hosts area), and image history and Docker account names (names only). The connector's allow-list deliberately has none of them yet.
- **Up all / Down all** in `after` order, once a host has two stacks (infrastructure and apps).
- **Docker**: list the tags that exist on Docker Hub and suggest the next one; a vulnerability scan (trivy) before a push; other registries (`registry:` is already a field on accounts).
- **Tidy**: the Docker Hub page's `docker-credential-devdeck` copy is made per build (about the size of the devdeck program); a persistent copy in the data folder, refreshed when devdeck updates, would be quicker.

## 4. Bigger, later (see the main plan and the connector plan)

- **Claude proposes, you approve** ([connector plan §7](2026-10-30-claude-connector/plan.md)): Claude suggests an action (restart a service, change a tag), devdeck queues it, and only a click in devdeck runs it, through the same confirmations and locks. Off by default.
- **Host health** (CPU, memory, disk, per container) and **image clean-up** (a dry-run list first): [remote-agent plan §10](2026-10-24-remote-agent/plan.md#10-later-after-logs-and-tags-pr-6-onwards).
- **Unseal the secrets store**: auto-unseal with AWS KMS is the recommendation; manual unseal with the key shares in the keyring is the alternative (same section).
- **Open the web UIs of a host's services** through the tunnel.
- **Helm**: the same Versions and Deploy flow for a Kubernetes stack (remote-agent plan §9, "Next phase, Helm").
- A screenshot of the desktop window for Claude ([connector plan §5](2026-10-30-claude-connector/plan.md)), macOS and Linux desktop builds.

## Things to remember about how this repo is worked on

- **Git**: the assistant gives the owner the git commands and does not run `commit`, `branch`, `checkout -b`, `push`, `merge` and the like (see `CLAUDE.md` and the owner's global instructions). Read-only `status`, `log`, `diff` are fine. Commit messages end with the `Co-Authored-By` line from the session's attribution reminder. Work lands through PRs into `dev`; the checks "CI passed", "Security passed" and "CodeQL passed" are required.
- **PR size**: the owner's default is small PRs (under about 10 files, one slice at a time, and propose the breakdown first when a plan is bigger). The last four PRs were deliberately large, one per area, **at the owner's explicit request**; go back to small slices unless asked again.
- **CI runs `go test -race`** on Linux. The race detector needs a C compiler and can't run on the owner's Windows PC, so think about goroutines in anything that streams (a data race in the Docker build output was found only in CI).
- **Public repo**: no employer, product, organisation, host, domain, instance id, email or Docker Hub namespace of the owner's in code, docs, tests or fixtures; use `acme`, `demo-api`, `example.com`. Secrets stay in the OS keyring, are masked in the UI, never logged, never sent to Claude or MCP (names only).
- **Windows quirks seen**: a hard link to a running program can't be deleted; `-race` isn't available locally; run Go and `npm` through the commands in `mise.toml` (`mise run lint`, `mise run check`, `cd web && npm test`).
- Each work item keeps `dev-plans/<date>-<name>/changes.md` current; each phase ends with a short `dev-plans/NN-<phase>.md`. Keep the plan honest: if a decision changes, update the plan in the same PR.

## How to start the next session

Paste something like:

> Read `dev-plans/2026-10-31-next-steps.md` and `CLAUDE.md`. Check which PRs are merged. Then plan PR 5 (release builds and bootstrap) as small slices and wait for my OK before coding.

or, after trying the host:

> I tried Save only, Deploy and Roll back on the host and this happened: [what you saw]. Read `dev-plans/2026-10-31-next-steps.md`, then help me fix it.
