# devdeck with Claude Code: quick start

For a teammate who has devdeck installed and wants their own Claude Code to connect to it. Copy the block under **Give this to Claude Code** into a Claude Code session; it does the rest and tells you what it needs from you. These guides are also inside devdeck, under **Docs** in the sidebar, with a **Copy** button on every block.

Is this needed? Only for the setup. Once the connector is installed, Claude already knows what it can do: devdeck tells it, when it connects, what the connector is, which tools it has (with what each one is for) and four ready prompts. It can also read these guides itself (the `get_guide` tool), so after `devdeck mcp install` you can just ask, including "how do I update the agent on my host?" or "how do I build and push an image?". The block below exists because the steps *before* that are easy to get wrong (Claude Code's `claude` program not being on the PATH, a first check, what to leave switched off), and so Claude does not guess.

## Give this to Claude Code

```text
Connect my Claude Code to devdeck, my local developer cockpit, and check that it works.

Do this, in order, and tell me what you found at each step:

1. Check devdeck is installed. On Windows it is normally at %LOCALAPPDATA%\Programs\devdeck\devdeck.exe. If it isn't, stop and tell me to run the devdeck installer.
2. Run `devdeck mcp install`. It needs the `claude` program on the PATH. If `claude` isn't found (Claude Code can live inside the Claude desktop app, under %LOCALAPPDATA%\Claude-Data\...\claude-code\<version>\claude.exe), run the command once with that folder added to the PATH for that one command only. Do not change my system PATH.
3. Run `claude mcp list` and tell me whether `devdeck` says Connected.
4. Tell me to start a NEW Claude Code session (the connector only loads when a session starts), and that devdeck must be open for it to read anything.
5. Call get_guide with no id and tell me which guides devdeck has. Tell me, in a few lines, what the devdeck connector can read (use its own tool list), and give me three example questions.

Rules:
- Never ask me for, read, print or store a token, password or key. devdeck keeps them in my OS keychain and the connector never exposes them.
- The connector is read-only. Do not try to start, stop, deploy or change anything on my machine or on a host through it.
- Do not switch on "Remote hosts" on devdeck's Claude access page for me. Tell me what it does (lines from a server travel through my PC to you) and let me decide.
- Do not edit my devdeck workspace files unless I ask. When I ask, call get_schema first and validate_workspace_yaml until the file is valid.
```

## What Claude can read

| Ask | Tool behind it |
|---|---|
| "What is running in devdeck?" | `devdeck_status` |
| "Show the errors from the last hour in my stack" | `query_logs`, `log_groups`, `log_histogram` |
| "Is my setup healthy?" | `doctor` |
| "Which GitHub account does each repo use?" | `git_accounts`, `git_repos` |
| "What am I looking at?" | `get_ui_state` |
| "Check this workspace.yaml" | `get_schema`, `validate_workspace_yaml` |
| "How do I build and push an image / update the agent / set devdeck up?" | `get_guide` (always on): Claude reads the guide before answering |
| "What is running on my remote host? Show its logs" | `list_hosts`, `host_info`, `host_services`, `host_compose`, `host_logs`: **off by default** (switch on under **Claude access**, and open the host's tunnel on the Remote hosts page first) |

Claude never gets secrets, and the connector can't write. Details: [`claude-connector.md`](claude-connector.md).

## The short SOP (what to do when)

| I want to | Do this |
|---|---|
| Set devdeck up on my PC | [`teammate-setup.md`](teammate-setup.md): install the tools, get the workspace file, put my tokens in devdeck |
| Add or change a workspace | **Workspaces → Edit file** (YAML or Form, checked as I type, a review before saving). [`workspace-editor.md`](workspace-editor.md) |
| Build and push an image | **Images and tags**: type the tag, confirm. Several images can be ticked and built in a row. The `docker buildx` command is in each image's details, and **Copy log** copies the output. [`docker-builds.md`](docker-builds.md) |
| See what is on Docker Hub | The latest tag shows on each image; its details list the last 10 tags |
| Reach a remote host | **Remote hosts**. If it says the AWS sign-in expired, press **Sign in to AWS** (devdeck never keeps my password) |
| Change an image tag on a host | **Remote hosts → the stack → Versions**: Save only, then Deploy one service, then Roll back if needed. Needs an agent from release `agent-dev-3` or newer. [`remote-versions.md`](remote-versions.md) |
| Put a newer agent on a host | Download the new release's `devdeck-linux-amd64` and `SHA256SUMS` on the host, check them with `sha256sum -c`, keep the old binary as `devdeck.prev`, swap it in and `systemctl restart devdeck-agent`. Roll back by moving `devdeck.prev` back |
| Let Claude read my host's logs | Open the tunnel, switch on **Remote hosts** under **Claude access**, ask in a new Claude Code session |
| Update devdeck itself | Run the newest installer over the old one; my data in `%AppData%\devdeck` stays |

If something doesn't work, open **Doctor**: it checks each tool and says what to do.
