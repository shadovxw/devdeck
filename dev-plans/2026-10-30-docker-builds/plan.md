# Docker accounts, build by tag, deploy, and devdeck for teammates

> Status: **the Docker half is built (2026-10-30) as one PR: accounts, images and build secrets in the workspace file, the build runner, the Docker Hub and Images pages and editing a workspace; see [`changes.md`](changes.md). PRs 1 and 2 below (agent versions and the Versions panel), named agent tokens and the deploy button after a build are built too, in a third PR; see the remote-agent `changes.md`.** The user guide is [`docs/docker-builds.md`](../../docs/docker-builds.md). Builds on the remote-agent work: read [`../2026-10-24-remote-agent/plan.md`](../2026-10-24-remote-agent/plan.md) §12 first. PRs 1 and 2 below are that plan's 4C and 4D.

## Context

What's in flight: PRs 1 to 3A of the remote agent are merged. 3B (the host buttons) is committed on `feat/host-writes-ui` but not pushed. 4C and 4D (versions on the host) haven't started. The owner wants three more things:

1. **Several Docker Hub accounts**, like the several GitHub accounts devdeck already handles. Each local repo is tied to its Docker repo. The owner types only the tag after `:`, and devdeck builds and pushes the image on this PC.
2. **Change that tag on the EC2 host and redeploy** from devdeck. This is PRs 4C and 4D, plus a link from "build finished" to "deploy".
3. **Nothing tied to one person.** Teammates install from the installer. They hand an SOP to their own Claude, and their Claude writes the YAML they need.

Choices made with the owner:
- Builds run on this PC with Docker Desktop.
- Docker Hub only for now. There is a `registry` field so GHCR or ECR can be added later.
- A repo can have several images.
- Teammates use their own AWS SSO profile and their own Docker Hub accounts, against the **same** agent.

What the audit found (facts):
- Data lives in `%AppData%\devdeck`, so nothing in it is per person.
- The installer ships only the exe (`installer/devdeck.iss`).
- A workspace can be created in the UI (`WorkspacesPage.tsx`) but **not edited afterwards**: there is no PUT route and no `Manager.Update`.
- Hosts can only be added by editing YAML. Saving the host token in the UI works (`HostsPage.tsx`, keyring name `host/<ws>/<id>`).
- There is **no CLI to check a workspace**. Only `POST /api/v1/workspaces/validate` exists.
- The schemas are embedded in the binary (`internal/workspace/schemas/*.json`) and can't be read from outside it.
- The Docker Hub card is a disabled placeholder (`ConnectionsPage.tsx:20`).
- Nothing runs `docker login` or `docker build` today.
- Some tests use the real product name (`git-pages.test.tsx`, `hosts-page.test.tsx`).

## Design

### Docker accounts (the same model as `internal/gitx`)
- **The list of accounts** lives in `<data>/docker-accounts.yaml`: `{id, registry: docker.io, username, namespaces: [acme]}`. It is per machine and per person, and it never goes in a repo.
- **Tokens:** each account's Docker Hub personal access token is kept in the OS keyring as `docker/<id>`, using `internal/secrets` (`Store`, `Value` masks itself).
- **The user's own `docker login` is never touched.** Each build runs with its own temporary `DOCKER_CONFIG`. That config:
  - copies the user's `currentContext` and buildx settings, so Docker Desktop still works;
  - points `credHelpers` for Docker Hub at `docker-credential-devdeck`.
- **`docker-credential-devdeck`** is a small shim in the temporary folder that runs `devdeck docker-credential get`. It answers with that account's token only, the same way `devdeck git-credential` works (`internal/gitx/credential.go`). The token never lands on disk.
  - Fallback if a spike shows buildx won't use the helper: a `config.json` holding the token, in a temporary folder only this user can read, deleted when the build ends.
- **Test connection:** sign in to Docker Hub with the token and report the user and its namespaces. This mirrors `gh.go`'s test.

### Images per repo (workspace.yaml)
```yaml
repos:
  - id: demo-api
    path: demo-api
    images:
      - id: api
        repository: acme/demo-api      # Docker Hub repo
        dockerfile: Dockerfile          # relative to repo
        context: .
        platforms: [linux/amd64]        # default; the EC2 host is x86_64
        account: acme-bot               # optional; else picked by namespace
```
- The schema goes in `workspace.schema.json` and the cross-file checks in `semantic.go`.
- When `account` is missing or unknown, Doctor and the Images page say so. The workspace still loads, because accounts belong to the person and not to the workspace.

### Build and push
- Route: `POST /api/v1/images/:ws/:repo/:image/build {tag}`.
  - The tag must match `^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`.
  - One build at a time per image. A second one gets 409.
  - The answer is a stream with the same `{"line"}` / `{"done"}` shape as host writes (plan §12, PR 3 decisions), so the UI code can be reused.
- The command it runs:
  - `docker buildx build --platform … -f … -t repo:tag --label org.opencontainers.image.revision=<commit> --push <context>`
  - It's an argument list, never a shell string.
- **Before the build:**
  - Show the branch and commit, and warn when the working tree has uncommitted changes.
  - If the tag already exists on Docker Hub, refuse unless the user confirms overwriting it.
- **History** goes into SQLite through `internal/store`: time, workspace, repo, image, tag, commit, dirty, result, duration.

### Build, then deploy
- After a successful push, **Deploy to host…** opens the Versions panel from 4D on every host where a service's `repository` matches this image, with the tag filled in.
- The match uses the repository the agent already reports in `GET /versions`, so no extra config is needed.

### Teammates on the same agent
- **This works.** The tunnel uses each person's own AWS profile, which is the `profile` field of their own `hosts:` entry. IAM decides who may start an SSM session.
- **The gap:** everyone pastes the same agent token, so the agent's audit line can't tell who did a write, and one person can't be cut off alone.
- **The fix (PR T3):** named tokens in `agent.yaml` (`tokens: [{name, file}]`), still accepting `token_file`. The audit line records the name.
- The per-stack lock already turns writes from two people at once into a 409.

## PRs, in order (each under 10 files, safe to deploy on its own, `changes.md` updated, neutral names)

| # | PR | Main files | Done when |
|---|---|---|---|
| 0 | Push 3B and open the PR (commands given to the owner) | none | 3B is merged into `dev` |
| 1 | **4C** agent versions (as in plan §12) | `internal/agent/versions.go`, routes, tests | A tag change pulls and recreates one container; roll back works |
| 2 | **4D** Versions panel | `internal/remote` client, `internal/api/hosts.go`, `HostVersions.tsx`, tests | A tag is changed from the UI against the real host |
| 3 | **T1** Edit a workspace in the UI | `internal/workspace/service.go` (`Update`), `internal/api/workspaces.go` (PUT), `WorkspacesPage.tsx`, tests | Hosts and images can be added without touching files by hand |
| 4 | **T2** CLI: `devdeck workspace check <dir>` and `devdeck schema <workspace\|stack\|flow>` | `internal/cli`, `cmd/devdeck/main.go`, tests | A teammate's Claude can check the YAML it wrote |
| 5 | **D1** Docker accounts backend | `internal/dockerx/{accounts,hub,credential}.go`, `internal/api/docker.go`, `cmd/devdeck` (`docker-credential`), tests | Add an account, save a token, Test shows the user |
| 6 | **D2** Docker Hub card on the Connections page | `ConnectionsPage.tsx`, `DockerAccounts.tsx`, api client, test | Several accounts are listed, tokens masked, test and remove work |
| 7 | **D3a** `images:` on repos | `types.go`, `workspace.schema.json`, `semantic.go`, tests, example workspace | The example workspace with images passes the checks |
| 8 | **D3b** Build runner | `internal/dockerx/build.go` (temporary DOCKER_CONFIG, shim), `internal/store` builds table, `internal/api/images.go`, tests | `curl` builds and pushes `acme/demo-api:<tag>` with the right account |
| 9 | **D4** Images page | `ImagesPage.tsx`, nav, api client, test | Type a tag, confirm, watch the build stream, see the history |
| 10 | **D5** Deploy after build | `ImagesPage.tsx`, `HostVersions.tsx` (tag filled in), test | One flow: build, then deploy on the host |
| 11 | **T3** Named agent tokens (new `agent-dev-N`) | `internal/agent/config.go`, auth, audit, tests | The audit line names the teammate; old `token_file` still works |
| 12 | **T4** SOP for teammates | `docs/teammate-setup.md`, README link | A fresh Windows user, with Claude, reaches the Hosts and Images pages |
| 13 | **T5** (mechanical) Neutral names in tests | the two test files | No product name left in tests |
| later | List tags from Docker Hub and suggest the next one; trivy scan before push; a release of several images at once; PR 5 (release builds put the installer and the Linux agent on GitHub releases, so teammates download them instead of being sent the exe) | | |

Before PR 1, the plan docs go in: `dev-plans/2026-10-30-docker-builds/plan.md` + `changes.md`, and a link from remote-agent §12. Steps 3 and 4 come before the Docker work because the SOP depends on them.

## The SOP (PR T4), written for a teammate's Claude
1. **What the human installs, and Claude only checks:** Docker Desktop, the AWS CLI, the Session Manager plugin, an SSO profile (`aws configure sso --profile <name>`), devdeck from the installer.
2. **What Claude asks the human:**
   - a workspace name and the folder holding the repos;
   - for each repo, its images (Dockerfile, context, Docker Hub repo);
   - the host's instance id and region (from the owner) and the teammate's own profile name;
   - the Docker Hub usernames, without tokens.
3. **What Claude writes:** files into `%AppData%\devdeck\workspaces\<name>\`, then it runs `devdeck workspace check`. It reads `devdeck schema workspace` to get the format.
4. **What the human does in the UI, never through Claude:**
   - paste the agent token on the Hosts page;
   - paste Docker Hub tokens on the Connections page.
5. **Hard rules for Claude:**
   - never ask for, read or print a token;
   - never write secrets into YAML;
   - never edit `.env` on the host.

## Answers to the owner's questions
- **Can people who install the binary see the code?** The installer holds compiled machine code plus the built, minified web UI. The Go source isn't in it. Tools like `strings` or a disassembler show text and structure but don't give the source back. This matters little because the repo is already public. What matters is that **the binary holds no secrets or host details**; the audit confirmed that. Each person's config is in their own `%AppData%\devdeck`, and their tokens are in their own keyring.
- **Can their Claude get at it?** Their Claude can do whatever their Windows user can do once they approve it:
  - read the exe as bytes and their workspace YAML;
  - call devdeck's local API at `127.0.0.1:7070` with curl. The Host/Origin guard stops web pages, not local programs. The API never returns tokens, but it can start actions.
  - So the SOP tells teammates to keep Claude's permission prompts on, and the confirmations stay in the UI.
  - Claude can't see your machine, your keyring or your host unless they're given access.

## Checking it works
- Go table tests for each package (`mise run test`). Vitest for each new page and hook. `mise run lint`. CI with CI, Security and CodeQL passing.
- **D1 and D3b:** the build runs against a fake `docker` (the helper-process pattern from `internal/agent/actions_test.go`). A manual check pushes a throw-away tag to a test Docker Hub repo with two accounts and confirms that `~/.docker/config.json` didn't change.
- **4C and 4D, D5:** against the real host, change one service's tag and roll it back.
- **T4:** a dry run of the SOP on a clean Windows user account.
