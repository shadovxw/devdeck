# Setting devdeck up on your own machine

This is for someone who has been given the devdeck installer and wants to use it with their own accounts. It also holds a **prompt you can give to your own Claude Code**, which writes the configuration files for you.

Everything personal stays on your PC: your Docker Hub accounts and tokens, your GitHub accounts, your AWS profile and your agent token are in your own OS keychain and your own devdeck data folder (`%AppData%\devdeck`). Nothing is shared between people except what you put in a workspace file, and a workspace file holds no secret.

## 1. Install what devdeck uses

| For | Install |
|---|---|
| Building images | Docker Desktop (start it) |
| GitHub accounts | the GitHub CLI: `winget install --id GitHub.cli -e`, then `gh auth login` once per account |
| Remote hosts | the AWS CLI and the Session Manager plugin, and an SSO profile of your own: `aws configure sso --profile <your-name>` then `aws sso login --profile <your-name>` |
| Claude Code (optional) | Claude Code, then **Connect devdeck to Claude Code** in the installer, or `devdeck mcp install` |

devdeck's **Doctor** page checks each of these and says what to do.

## 2. Ask the person who runs the project for

- the workspace file (or the repository list and which images each builds) and which Docker Hub repositories they push to;
- for a remote host: its **instance id and region**, and your **own agent token** (`devdeck agent token` run on the host by whoever administers it, listed under `tokens:` in the agent's `agent.yaml` with your name).

Never share a token in chat or email: it goes straight into your own devdeck (below).

## 3. Write your workspace

A workspace is a folder in `%AppData%\devdeck\workspaces\<name>\` with a `workspace.yaml` (repos, images, hosts) and optional `stacks\` and `flows\` files. You can create it from **Workspaces** (scan the folder that holds your repositories, review, save; the pencil edits it later), or have Claude write it (section 5). Check any file with:

```powershell
devdeck workspace check <name>
```

Example (neutral names):

```yaml
version: 1
name: acme
root: ~/code/acme
repos:
  - id: api
    path: api
    remote: github.com/acme/api
    images:
      - id: api
        repository: acme/api              # Docker Hub repository, no tag
        secrets:
          - id: gh_token                  # what the Dockerfile asks for
            from: github                  # the GitHub account your rules pick for this repo
  - id: frontend
    path: frontend
    images:
      - id: frontend
        repository: acme/frontend
hosts:
  - id: dev-box
    name: Dev box
    type: aws-ssm
    aws:
      instance: i-0123456789abcdef0       # from the project owner
      region: ap-south-1
      profile: your-sso-profile           # YOUR profile, not theirs
```

## 4. Put your secrets in devdeck (never in a file, never in chat)

In the app, each of these goes to your OS keychain and is never shown again:

- **Connections, GitHub**: add a connection per account, and rules that say which repositories use which (see the page).
- **Connections, Docker Hub**: add your account(s): your Docker Hub username, the organisations you push to, and an **access token** (hub.docker.com, Account settings, Personal access tokens, *Read & Write*). **Test** checks it. Build secrets that aren't a GitHub token (an npm token, say) go under **Build secrets**.
- **Remote hosts**: open the host and paste **your** agent token.

Then **Images and tags**: type a tag and build, and **Remote hosts, Versions** to change a tag on a host (see [`remote-versions.md`](remote-versions.md) and [`docker-builds.md`](docker-builds.md)).

## 5. Have your own Claude write the YAML

With the connector installed ([`claude-connector.md`](claude-connector.md)), give Claude Code this prompt (fill in the brackets). It reads devdeck's schemas and checks its own file until it is valid, and never touches a secret:

> Set up a devdeck workspace for me. Use devdeck's tools: call `get_schema` for the `workspace` kind first and follow it exactly, write the file, then call `validate_workspace_yaml` until it says the file is valid (read every warning).
>
> My repositories are in [folder] and the project is [name]. For each repository I build an image from, add `images:` with its Docker Hub repository ([list: repository ← which repo]). The Dockerfile is in the repo root unless I say otherwise. These need a build secret named [id] taken from [github | a keychain secret called ...]: [list]; the others need none. The remote host is [instance id] in [region] and I use the AWS profile [my profile name].
>
> **Hard rules:** never ask me for, read, print or write a token, password or key; never put a secret value in the YAML (only where each comes from); if something needs a secret, tell me which page of devdeck to put it on. Don't run anything that changes my machine. Show me the final file and where to save it (`%AppData%\devdeck\workspaces\<name>\workspace.yaml`), and tell me to run `devdeck workspace check <name>`.

Without Claude Code, `devdeck schema workspace` prints the format for any editor, and `devdeck workspace check <name>` checks the file.

## 6. What a teammate's Claude can and can't see

The connector gives Claude **read** access to what devdeck shows on your machine, switchable per area on the **Claude access** page (remote hosts are off until you turn them on). It never gets tokens, keychain contents or `.env` values, and it can't start, stop, build or deploy anything. Keep Claude Code's own permission prompts on. See [`claude-connector.md`](claude-connector.md).

## Is the program itself secret?

No. The installer holds devdeck's compiled program and its web interface; the source is public in the repository. Nothing in it is private to anyone: there are no tokens, hosts or accounts inside. Your configuration and secrets are in your own data folder and keychain. Someone who gets the installer can read it the way they can read any program, and sees nothing of yours.
