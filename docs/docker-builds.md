# Building and pushing Docker images with devdeck

devdeck can build an image from one of your repositories and push it to Docker Hub when you type a tag. It works like devdeck's GitHub accounts: several Docker Hub accounts side by side, each repository pushed with the account that owns its namespace, and your own `docker login` left alone.

## Set it up

**1. Add your Docker Hub accounts** (Connections, Docker Hub). For each: a short name, the Docker Hub username, and the organisations the account can push to. Then add its **access token**: make one on hub.docker.com (Account settings, Personal access tokens) with *Read & Write* permission. devdeck keeps it in your OS keychain and never shows it again. **Test** signs in and shows who the account is and which namespaces it can use.

**2. Say what each repository builds**, in its `workspace.yaml` (edit it from Workspaces with the pencil, or with a text editor):

```yaml
repos:
  - id: auth-service
    path: auth-service
    images:
      - id: auth-service
        repository: acme/auth-service     # the Docker Hub repository, no tag
        # dockerfile: Dockerfile          # relative to the repo (default)
        # context: .                      # relative to the repo (default)
        # platforms: [linux/amd64]        # default
        # account: work                   # only if two accounts own the namespace
        secrets:
          - id: gh_token                  # what the Dockerfile asks for
            from: github                  # see "Build secrets" below
  - id: frontend
    path: frontend
    images:
      - id: frontend
        repository: acme/frontend         # no secrets
```

A repository can list several images (several Dockerfiles or several Docker Hub repositories).

**3. Build** (Images and tags): each image has a field `acme/auth-service:` and you type the tag, for example `1.0.4`. devdeck shows what it is about to do (the branch and commit, the account, and whether the folder has uncommitted changes, which are built into the image) and asks before it starts. The output streams as it runs, and the result goes into the history.

If Docker Hub already has that tag, devdeck says so and asks before pushing over it.

## Which account pushes

The part of the repository before the slash is the namespace: `acme` in `acme/auth-service`. devdeck pushes with the account whose username is that namespace, or that lists it as an organisation. If **two** accounts own it, add `account: <name>` to the image. If **none** does, the Images page says so and links to the Docker Hub page. Accounts live in `docker-accounts.yaml` in devdeck's data folder, per person and per machine: a workspace never names a person's account unless it says `account:`.

## Build secrets

A Dockerfile that needs a token while it builds (a private Go module, a private npm package) asks for it with `RUN --mount=type=secret,id=gh_token ...`. The workspace file says only where each secret comes from, never its value:

| `from:` | The value is |
|---|---|
| `github` | the token of the GitHub account devdeck's rules already pick for this repository (the one git pushes with), fetched with `gh` when the build starts. Nothing to paste. |
| `keyring` | a named secret you saved on the Docker Hub page (Build secrets), kept in your OS keychain. `name:` picks it; the secret's `id` is the default name. |

devdeck hands the value to docker through the environment of the docker process alone, with `--secret id=<id>,env=<variable>` (the same as running `docker buildx build --secret id=gh_token,env=GH_TOKEN ...` yourself, without exporting anything). It is never on a command line, in a file, in the image or in the output: the output is also masked for it.

## How the push is signed in

A build runs `docker buildx build --push` with a **private, temporary** docker configuration, deleted when the build ends. It keeps what docker needs to work (your current context, so Docker Desktop is found, and the folder of its plugins, so buildx is found) and replaces the credentials: its only credential helper is `docker-credential-devdeck`, a copy of devdeck's own program, which hands docker the chosen account's token straight from your keychain, for Docker Hub only. Your `~/.docker/config.json` and your own `docker login` are never read for credentials or changed.

## Safety

- Tokens and secret values are in the OS keychain only: not in YAML, not in SQLite, not in logs, not in the build output, not sent to Claude.
- A tag is checked (`letters, digits, . - _`, 128 at most) and every value that reaches docker is checked and passed as an argument, never as shell text. The Dockerfile and context must be inside the repository.
- One build per Docker Hub repository at a time. A build runs to its end even if you close the page, so a push is never left half done.
- Docker Hub's own web API (hub.docker.com) is asked three things, with the account's token: sign in (Test), which namespaces the account has, and whether a tag exists. The push itself goes from docker to the registry.

## Troubleshooting

| It says | What to do |
|---|---|
| Docker isn't installed or isn't on the PATH / Docker isn't running | Start Docker Desktop. |
| no Docker account owns the namespace | Add an account on the Docker Hub page whose username or organisations include it. |
| several Docker accounts own the namespace | Add `account: <name>` to the image. |
| no token is saved for this account | Add its access token on the Docker Hub page. |
| Docker Hub refused the username or token | The token is expired, revoked, or not a personal access token: make a new one with Read & Write and save it again. |
| Docker Hub refused the push | The account can't write to that repository: check the namespace, the account's role in the organisation and the token's permission. |
| no GitHub account rule matches this repository | Add a rule on the Connections page (GitHub) for the repository's remote. |
| the build secret ... has no value saved | Save it on the Docker Hub page under the name the workspace file uses. |
| the repository isn't on this machine | The folder in `workspace.yaml` doesn't exist here: clone it, or fix the path. |

Not built yet: deploying the pushed tag to a remote host from the Images page (it arrives with the Versions panel), listing the tags that exist on Docker Hub, a vulnerability scan before the push, and registries other than Docker Hub.
