# Changes: Docker accounts, build by tag, deploy, teammates

What changed and why, kept current while coding. See [`plan.md`](plan.md) for the PR list.

## 2026-10-30

- Plan written and approved. No code yet.

## The Docker PR: accounts, images, build secrets, builds, and editing a workspace

Built as one PR at the owner's request (the plan had D1 to D4 and T1 as separate PRs).

### What was built

- **`images:` on a repo in `workspace.yaml`** (schema, types and checks): `id`, `repository` (namespace/name, no tag), `dockerfile`, `context`, `platforms`, `account` and `secrets:`. A repo can list several. Checks: ids and repositories once per repo, the Dockerfile and context inside the repo, unknown settings refused.
- **Build secrets** (`secrets:` on an image, added because the owner's own build commands pass `--secret id=gh_token,env=GH_TOKEN` for most services and nothing for the frontend): `{id, from: github|keyring, name}`. No value is ever in YAML. `github` is the token of the GitHub account devdeck's rules already pick for the repo, fetched with `gh` at build time; `keyring` is a named secret saved in the OS keychain (`docker-build/<name>`). devdeck passes the value in an environment variable of the docker process only, with `--secret id=<id>,env=DEVDECK_BUILD_SECRET_<n>`, and masks it in the output.
- **`internal/dockerx`**: accounts (`docker-accounts.yaml` in the data folder: id, username, namespaces and the build secret names; tokens in the keyring as `docker/<id>`), Docker Hub's web API (sign in, namespaces, tag exists), the credential helper (docker's protocol; Docker Hub only; the account comes from the environment and the token from the keyring), the build runner, and the history (`image_builds`, migration 0003, newest 500).
- **The build runner** runs `docker buildx build --progress plain --platform ... -f ... -t repo:tag --label org.opencontainers.image.revision=<commit> --secret ... --push <context>` through `sdk/proc` (process tree killed on cancel, 30 minute limit) in a **private temporary `DOCKER_CONFIG`**: `credsStore: devdeck`, the person's `currentContext`, their `contexts/` copied, their `cli-plugins` folder named in `cliPluginsExtraDirs`, and none of their logins. A copy of devdeck's own program, named `docker-credential-devdeck`, is on the PATH of that one process. One build per Docker Hub repository at a time (409 otherwise). A failed push is explained in words (denied, bad token, Docker not running, rate limit).
- **`main`**: run under the name `docker-credential-devdeck` (or as `devdeck docker-credential <verb>`) the program is docker's credential helper and never starts the server.
- **API**: `/docker` (accounts, tokens, check, build secrets), `/images` (the images with the account that would push each, the repo's branch, commit and dirty state, secret problems and the last build), `/images/builds` (history) and `POST /images/:ws/:repo/:image/build {tag, overwrite}` (a refusal is an error status; then a stream of `{"line"}` and a last `{"done":true,"ok":...,"error":...}`; it runs to its end if the page goes away). Before starting it picks the account, reads the secrets and asks Docker Hub whether the tag exists (409 `{exists: true}` unless `overwrite`; if Docker Hub can't be asked it pushes anyway and says so).
- **Editing a workspace**: `GET /workspaces/:id/file` and `PUT /workspaces/:id` (`Manager.YAML` and `Manager.Update`): checked first, the name can't change, samples can't be changed, the old file is kept as `workspace.yaml.prev`, written in one step. A pencil on a workspace card opens the text in a drawer, checked as you type.
- **Web**: the **Docker Hub** page (`/connections/docker`: accounts with a token field that is a password input and is never kept, Test, Forget, a two-step Remove; build secrets by name), the **Images and tags** page (a card per image with its account, repo state, secrets and last build; a tag field; a confirmation that says what will be built, from which commit, and warns about uncommitted changes; the streamed output; the result; a push-over-an-existing-tag confirmation; the history) and the Docker Hub card on the Connections page.
- Docs: [`docs/docker-builds.md`](../../docs/docker-builds.md), an image with a secret in the example workspace, a README link.

### Found by testing

- A hard link of the helper to the running devdeck program **can't be deleted on Windows** (Access is denied), so the private config would have been left behind after every build. The helper is now a copy.
- Tried by hand with the real Docker Desktop: a build with a temporary `DOCKER_CONFIG` that names a credential helper works when the config keeps the person's `currentContext`, `contexts/` and the plugin folder, and fails with "executable file not found" when the helper isn't on the PATH of the docker process. The real exe, run under the helper's name, answers docker's protocol over pipes (the no-console build too).

### Checked

- Go: workspace images and secrets (accepted and refused shapes), `Update` and `YAML`; accounts, the store (strict, atomic, private), Docker Hub calls against a fake server, the helper's protocol, the service (accounts, tokens never in an answer, resolving by namespace including none and several, build secrets), the plan (every refusal; no secret on a command line), a build against a fake docker (private config, helper present, nothing left behind, the person's config untouched, masked secrets, failure messages, one at a time, timeout, cancel), the history (retention); the API (accounts, build secrets, the images list, a build and its history, an existing tag, Docker Hub unreachable, a failure, refusals, an ambiguous namespace, no token, a GitHub secret without a rule, Claude unable to use any of these routes, editing a workspace); `gitx.Git.Head`.
- Web: the Docker Hub page, the Images page, editing a workspace, nav. `npm run typecheck`, `lint`, the whole suite and the build.

### Not done or not tried

- **A real push to Docker Hub** (needs a token): the runner is tested against a fake docker and, for the docker config and helper lookup, by hand against Docker Desktop without a push.
- **`from: github` against a real `gh`**: the account lookup is the same code the git credential helper uses; the build path is tested only up to "no rule matches".
- The deploy button after a build (it needs the Versions panel), Docker Hub tag listing, scans, other registries, and MCP tools for images (Claude can't reach these routes: the connector's allow-list doesn't include them).
