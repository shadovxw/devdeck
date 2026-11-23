# devdeck as the hub: one desktop app for all dev work

> 2026-11-21 · owner: Vrishank Warrier · status: **proposal, for review. Nothing built.** Builds on the desktop app ([`2026-10-24-desktop-app/`](../2026-10-24-desktop-app/plan.md)), git accounts ([`2026-10-22-git-accounts/`](../2026-10-22-git-accounts/plan.md)), custom themes ([`2026-11-01-custom-themes/`](../2026-11-01-custom-themes/plan.md)), the Claude connector ([`2026-10-30-claude-connector/`](../2026-10-30-claude-connector/plan.md)) and main plan Phases 7 (flows), 11 (VS Code) and 12 (desktop). Replaces the "devdeck OS" idea: devdeck stays a Windows app (Linux build later), not a distro.

## 1. The goal

Everything goes through devdeck. From one window you open and arrange VS Code, Claude Code, terminals and the browser, switch between them and between screens, run pipelines that chain them, and flip the whole setup from the **work** account to the **personal** one with one click.

devdeck still sits **on top of** VS Code and Claude Code. It starts, arranges and drives them; it does not replace or re-implement them.

## 2. What exists today (2026-11-21)

| Have | Missing for the hub |
|---|---|
| Wails window, tray, installer with "start when I sign in" | Full-screen mode, global hotkeys, window control |
| Git accounts: `gh` per account, credential helper, per-repo identity | One switch that changes every tool's account (§4.1) |
| Custom themes (colours only), Light/Dark/System | Effects, glow, glass; a terminal theme (§4.7) |
| Claude connector (`devdeck mcp`), Claude review on features | Claude Code running *inside* devdeck (§4.3) |
| Repos page, Features page, Doctor, Stacks, Logs, system metrics plugin | Cross-repo git status, push all, secret fix-ups (§4.6) |
| Flow engine planned (Phase 7), not built | n8n-style pipelines with VS Code and Claude steps (§4.5) |
| — | Command palette, launcher, terminal, layouts, multi-screen |

## 3. Decisions (proposed)

1. **Profiles are the base of everything.** A profile (Work, Personal, any number) decides which accounts, folders and settings every launched tool gets. Built first, because the launcher, terminal, Claude tab, layouts and pipelines all launch *under* a profile.
2. **Launch with the profile, don't flip global state.** Where a tool lets us, devdeck starts it with the profile's settings (environment, command-line flags, config folders) instead of changing machine-wide settings. Work and personal windows can then be open side by side. Global changes (for example `gh auth switch`) are a last resort, previewed and confirmed.
3. **Drive the real VS Code, don't embed it.** VS Code can't run inside another window reliably. devdeck opens it (`code` CLI), places its windows, and talks to it through the thin devdeck extension already planned in Phase 11. Embedding code-server is not planned (different extension store, second sign-in, heavy).
4. **Claude Code runs in a real terminal inside devdeck.** A terminal tab (ConPTY in Go, xterm.js in the UI) runs `claude` in a project folder, exactly as typing it in Windows Terminal. Pipelines use headless runs (`claude -p --output-format stream-json`). Claude Code hooks tell devdeck when a session is waiting for you or done.
5. **Windows and screens through Win32, no admin.** Enumerate windows and monitors, move, resize and focus them, and register global hotkeys with the normal user APIs (`EnumWindows`, `EnumDisplayMonitors`, `SetWindowPos`, `RegisterHotKey`). No hooks into other processes, no driver.
6. **Pipelines are the Phase 7 flow engine**, plus new step types for VS Code, Claude Code, the launcher and profiles. YAML is the source of truth; the xyflow canvas edits it. Every write step (push, delete, SQL, Claude with edit rights) has an approval step in front of it unless the flow's owner turns that off for that step.
7. **n8n is connected, not built in** (decided 2026-11-21, §4.5.1). devdeck's own engine runs the dev steps; n8n, run as an optional devdeck stack, brings the hundreds of outside services (Slack, mail, Notion, sheets…). They talk through webhooks both ways. Windmill was also looked at and not chosen: it needs PostgreSQL and workers, more than one developer's machine needs.
8. **Effects are optional.** Paper stays the default and stays flat, as `CLAUDE.md` says. A **Neon** look (glow, glass, motion) is a theme plus an effects level (Full / Reduced / Off), Off by default, and Off whenever Windows asks for reduced motion or the machine is on battery saver.
9. **Not a shell replacement.** "Boots into devdeck" means: start at sign-in, full screen, borderless, on the chosen monitor. Replacing `explorer.exe` (Shell Launcher, Assigned Access) needs Windows Pro or Enterprise and breaks too much.
10. **Security as today.** Everything listens on `127.0.0.1` with the Host/Origin check, including the terminal WebSocket and any pipeline webhook. Secrets stay in the keyring and are only handed to the child process that needs them, never logged, never sent to Claude or MCP. A terminal endpoint can run any command, so the deferred auth (main plan §6.1) is reconsidered before it ships (§7, question 5).

## 4. Features

### 4.1 Profiles and account switching

A profile is a YAML entry in devdeck's data folder (not the public repo). What it sets, per tool:

| Tool | How devdeck applies it | Side by side? |
|---|---|---|
| Git (commits, push) | The existing account rules and per-repo identity; the profile picks the default connection | Yes |
| `gh` | `GH_CONFIG_DIR` per profile for terminals devdeck starts; devdeck's own calls already pass `--user` | Yes |
| Claude Code | `CLAUDE_CONFIG_DIR` per profile: its own login, settings, MCP servers and history | Yes |
| VS Code | `code --profile <name>` (settings, extensions); `--user-data-dir` for fully separate sign-ins | Yes |
| Browser | Chrome or Edge with `--profile-directory=<dir>` | Yes |
| AWS, Docker Hub | `AWS_PROFILE`; the Docker account already chosen per image | Yes |
| Projects | Which workspaces, repos and features show | n/a |

- A profile switch in the top bar changes what devdeck shows and what it launches next. Running windows keep their profile and carry a small profile tag in the switcher (§4.4).
- Doctor gets a Profiles check: each profile's `gh` user, Claude login and VS Code profile exist.
- **Done when:** with Work selected, the launcher opens VS Code, Claude Code and a terminal that all use the work accounts; switching to Personal and opening the same project gives personal ones, both sets open at once.

### 4.2 Command palette and launcher

- **Ctrl+K** inside devdeck (`cmdk`): projects, repos, features, apps, layouts, pipelines, pages, actions ("push all", "open in VS Code", "new Claude tab").
- **A global hotkey** (default Ctrl+Alt+Space, changeable) brings devdeck forward with the palette open from anywhere in Windows.
- **Apps** is a list: VS Code, Claude Code, Windows Terminal, the browser, plus anything you add (path, arguments, working folder, icon). Each launch runs under the current profile.
- **Done when:** from any app, the hotkey then "acme api code" opens that repo in VS Code under the current profile.

### 4.3 Terminals and Claude Code inside devdeck

> **Changed 2026-11-21 (owner):** the owner works in the Claude desktop app and VS Code and wants devdeck to switch to them, not host them. That comes first, as the **switchboard** ([`2026-11-21-switchboard/`](../2026-11-21-switchboard/plan.md)): open and focus the right VS Code window and Claude app session per feature, repo and stack, with status from Claude Code hooks. The terminal tabs below stay planned for later, for quick sessions and pipelines.

- **Terminal tabs:** ConPTY (Go, Windows 10 1809+) streamed over the existing WebSocket hub to xterm.js. PowerShell by default, any shell per tab. Tabs survive closing the window (the tray keeps them) but not a devdeck restart in v1.
- **Claude tab:** a terminal tab that runs `claude` in the project folder with the profile's `CLAUDE_CONFIG_DIR`. One per project or several.
- **Claude status:** devdeck offers to add Claude Code hooks (`Notification`, `Stop`) that call `devdeck claude-event` and post to the local server. The tab, the palette and a toast then show "waiting for you" or "done", like a CI badge. Installing hooks changes the user's Claude settings, so it is previewed and confirmed (same pattern as git setup).
- **Headless runs** (for pipelines and buttons): `claude -p` with `stream-json`, a permission mode chosen per step, output saved to the run.
- **Done when:** three Claude sessions run in three projects, and the one that asks a question lights up in the sidebar and in a toast.

### 4.4 Windows, tabs and screens

- **Switcher:** a hotkey shows the windows that devdeck knows (started by it, or matched by app and folder) grouped by project and profile, with search. Enter focuses one. It is not a full Alt+Tab replacement.
- **Monitors:** devdeck lists the screens and their arrangement. Each app in a layout has a target screen and a zone (full, left half, right half, top-right quarter, or a custom rectangle).
- **Layouts (workspaces):** a saved set of "open these, here". For example *Portfolio work*: VS Code on the repo on screen 1 left, Claude tab on screen 1 right, browser on `http://localhost:5173` on screen 2. Open a layout from the palette, a pipeline or at sign-in. "Save current" captures what is open.
- When a screen is unplugged, its windows move to the main screen and a layout remembers which screens it was made for.
- **Done when:** one palette command opens and places three apps across two monitors, and the same command on a laptop with one screen puts them in sensible zones on that screen.

### 4.5 Pipelines (n8n-style)

The Phase 7 plan (YAML DAG, `expr` gates, triggers, runs, xyflow builder) with these step types added:

| Group | Steps |
|---|---|
| Apps | Open layout, open in VS Code (file and line), open URL, launch app, switch profile |
| Claude | Run a prompt in a repo (headless), review a branch (exists on Features), wait for a Claude tab to finish |
| Git | Status, pull, commit (with message from a step), push (approval), create PR with the profile's account |
| Shell | Run a script or command in a folder, with a timeout; output as step output |
| Data | HTTP request (with an allow-list of hosts), read or write a file, JSON transform |
| Control | Gate, approval (a toast with Approve / Reject), wait, for-each repo, notify |

- **Triggers:** manual, palette, hotkey, schedule, file change, git commit, a Claude tab finishing, and a local webhook (`127.0.0.1` only, token per pipeline).
- **Example starter pipelines:** *Start my day* (pull all repos, open the layout, show what changed); *Pre-PR* (lint, tests, scanners, Claude review, then a PR on approval); *Fix and re-check* (Claude fixes a finding, tests run, the diff waits for approval).
- **Done when:** *Pre-PR* runs on a branch from the palette, stops at a failing test, and resumes from that step after the fix.
- **Ideas borrowed** (from n8n and Windmill, §4.5.1): each step's settings form generated from a JSON Schema of its inputs; a run history that shows every step's input and output; approval steps that wait in the UI.

#### 4.5.1 n8n alongside (outside services)

devdeck's engine is for the dev loop on this machine. For outside services it connects to n8n instead of re-building hundreds of integrations. Nothing of n8n is bundled: its licence (Sustainable Use) allows self-hosting for your own use but not shipping it inside a product, and it is its own Node server.

- **n8n as a stack.** A ready-made, optional Compose stack (`examples/`: the `n8nio/n8n` image pinned to a version, a data volume, port 5678 on `127.0.0.1` only), so devdeck starts, stops and shows the logs of n8n like any other stack. Off unless added to a workspace.
- **devdeck → n8n:** a step type *Call n8n* (a webhook URL from the n8n stack, a JSON body from earlier steps, the answer as step output). Uses the HTTP step's allow-list: only the n8n address.
- **n8n → devdeck:** the pipeline webhook trigger (`POST /api/v1/pipelines/{id}/run`, token per pipeline). n8n in Docker reaches devdeck as `host.docker.internal`, which the Host check refuses today, so that host is allowed **only** on the webhook route and only with a valid pipeline token. The rest of the API keeps the plain `127.0.0.1` rule.
- **Secrets:** a webhook token is a secret like the others (keyring, masked, never logged, never sent to Claude).
- **Examples to ship:** *PR merged → n8n posts to a chat channel*; *new issue labelled bug → devdeck opens the repo in VS Code with a Claude tab* (n8n catches the GitHub event, calls the devdeck webhook).
- **Done when:** the n8n stack starts from devdeck, a devdeck pipeline calls an n8n workflow, and an n8n workflow starts a devdeck pipeline, all on this machine.

### 4.6 Projects at a glance

- **All repos** in a folder or workspace: branch, ahead/behind, uncommitted changes, stashes, no remote, wrong identity for the profile.
- **Push all:** a list of what would be pushed, per repo and account, then one confirmation. Never force.
- **Secret check:** gitleaks (already a review tool) on the working tree and history, plus a quick "tracked `.env`" check. The fix button *untracks* the file (`git rm --cached`) and adds it to `.gitignore`, shown as a diff first. It also says plainly that a leaked secret must be **rotated**: removing it from the repo does not remove it from history or from anyone who cloned it.
- **Notes per project:** a Markdown file per project in devdeck's data folder (or `tmp/` in the repo when git-ignored), shown beside the project, readable by Claude through the connector when allowed.

### 4.7 Look and feel

- **Neon theme:** a dark theme made with the existing theme editor (your own colours and accent; keep a personal theme file in the private config repo, not here).
- **Effects level** (Settings → Appearance): Full / Reduced / Off. Full adds glow on hover and focus, glass panels (backdrop blur), spring motion when dragging, a short glitch on page change, optional scanlines and an animated background. All from tokens, all CSS and Motion (no new animation library), all lazy and paused when the window is hidden.
- **Terminal theme:** xterm.js colours come from the active theme's tokens, so every theme has a matching terminal.
- **Budget:** main plan §7.5 still holds. Effects that miss it at Full are cut, not shipped slower.
- The `CLAUDE.md` UI rules (flat, no shadows) stay for Paper and the default; the Neon look is the one place glow and blur are allowed, and only above Off.

### 4.8 The "OS" feel

- **Full-screen dashboard:** borderless, on a chosen screen; F11 or a palette command toggles it.
- **Widgets:** CPU, RAM, disk, battery (the system metrics plugin), GPU use, memory and temperature through `nvidia-smi` when an NVIDIA GPU is present, clock, calendar, quick note. CPU temperature on Windows needs a kernel driver, so it is left out.
- **Network:** devices the machine already sees (the neighbour table, no active scan), with names you give them and a flag for devices you mark as old or untrusted.
- **Start at sign-in:** already an installer option; the app can open full screen and open a chosen layout.

### 4.9 Setup, sync, other platforms

- **First run:** Doctor checks and offers to install VS Code, Claude Code, Git, `gh`, Node and the fonts (through `winget`, each confirmed).
- **Export / import:** one file with themes, profiles (names and settings, no tokens), apps, layouts and pipelines. It can live in the private config repo.
- **Linux:** Wails, ConPTY → `pty`, and window control (X11 or Wayland differ) are the parts to port. Later.

### 4.10 Phone and tablet companion

A phone or tablet beside the PC becomes devdeck's remote: status at a glance, a deck of buttons, and approvals. Added 2026-11-21 after looking at WinDock (an MIT-licensed app that turns an Android phone into a dock for a PC).

- **Any number of devices** pair with the same devdeck, each in its own way:
  - **Phone:** compact. Alerts, **approvals** (a pipeline's "push to `dev`?" with Approve / Reject), a few big buttons (start a stack, run a pipeline, open a layout).
  - **Tablet:** a full **deck** beside the keyboard. Stack status, CI and Claude-tab status, a grid of pipeline and layout buttons, live logs, the system widgets (§4.8). A spare tablet can stay on it all day.
- **It is devdeck's own web app**, laid out for a touch screen (a `/companion` view), not a separate app. Nothing new to install on the phone beyond a browser and a home-screen shortcut. A native Android app is only considered if the browser can't do something needed (for example notifications while closed).
- **Pairing, devices and permissions:**
  - **Pairing** is one-time: devdeck shows a QR code and a short code; the device scans it and gets **its own token**. The code expires in a few minutes and works once.
  - **Settings → Devices** lists each device (name, last seen) with **Remove**, which cuts it off at once.
  - **Per-device permissions:** *view*, *buttons* (run what is already defined: start/stop a stack, run a pipeline, open a layout) and *approve* (answer approval steps). A device never gets more than that: no terminal, no editing pipelines or settings, no secrets (names only, as for Claude).
  - Every action from a device goes into an audit list with the device's name.
- **The network change, which is the real work:**
  - Today devdeck listens on `127.0.0.1` only (`CLAUDE.md`, plan §6.1). The companion needs an **opt-in second listener** on the home network, **off by default**, serving only the companion's routes, and only with a device token. The main API and the window stay on `127.0.0.1` exactly as now.
  - The device's traffic must be **encrypted** (a token over plain HTTP on Wi-Fi can be read). Options for its own plan: HTTPS with a certificate devdeck makes and the device trusts at pairing (the QR code carries its fingerprint); or **Tailscale** (devdeck on the tailnet address, with a real `*.ts.net` certificate), which also works away from home; or **USB tethering** only. A browser shortcut that installs like an app (a PWA) needs HTTPS anyway.
  - This is the first time devdeck accepts anything from another device, so it gets its own plan and a security review before any code.
- **Live state** goes over the WebSocket hub that the window already uses (the same events), read-only for *view* devices.
- **WinDock: ideas, not code.** devdeck doesn't run or bundle WinDock: it is a separate Node host (118 MB on Windows) with its own pairing, and it doesn't know devdeck's stacks, pipelines or approvals. Its MIT licence would allow reusing pieces with credit, but devdeck's server is Go and its app is React, so little would carry over. What is worth borrowing: PIN or QR pairing, a dock of big touch targets that can be rearranged, a status "notch", and a performance mode for the glass look. WinDock can still sit beside devdeck as a general PC dock (it can launch devdeck like any app); they don't conflict.
- **Done when:** a phone and a tablet pair with one devdeck; the tablet shows live stacks and runs a pipeline from a button; the phone approves that pipeline's push step; removing the phone in Settings → Devices locks it out at once; and with the companion turned off, nothing listens beyond `127.0.0.1`.

### 4.11 Code map (Graphify)

Optional: a map of each repo's code for the owner and for Claude, built with [Graphify](https://github.com/Graphify-Labs/graphify) (Apache-2.0). Added 2026-11-21. Graphify parses about 40 languages (Go and TypeScript included) locally with tree-sitter and resolves `calls`, `imports` and `inherits` across files; it writes a report (`GRAPH_REPORT.md`) and a `graph.json`, answers `graphify query` and `graphify path A B`, and has a local MCP server (`graphify-mcp`).

- **Off by default, nothing bundled.** Doctor checks whether `graphify` is installed and shows the install command (`uv tool install graphifyy`, with `[mcp]` for the server). devdeck runs it; it doesn't ship it.
- **Code-only by default.** Graphify sends docs, PDFs and images to whichever AI provider it finds an API key for (several, some outside the owner's control). devdeck always runs it with `GRAPHIFY_BACKEND=none` (and `GRAPHIFY_QUERY_LOG_DISABLE=1`), so a map is built from code alone and nothing leaves the machine. A repo can be switched to "code and docs" explicitly, with the provider named on the switch.
- **Output outside the repo:** maps go to devdeck's data folder (`maps/<workspace>/<repo>/`), never into the repo, so nothing reaches git. devdeck doesn't run `graphify install`, which would edit `CLAUDE.md` and add hooks.
- **Repo page:** **Build code map** / **Rebuild**, when it was built, and the report. **Workspace:** **Merge** (`graphify merge-graphs`) for one map of all its repos. Links between repos through HTTP or NATS are runtime, not code, so the merged map shows few of them; Flow trace (below) is what follows those.
- **Claude:** optionally register `graphify-mcp` for a workspace's map in Claude Code (preview, confirm, undo), so sessions query the map instead of searching file by file.
- **With Flow trace** ([`2026-11-21-flow-trace/`](../2026-11-21-flow-trace/plan.md)): a trace step (an HTTP route, a NATS subject) links to the handler in the map, and the map can show which flows go through a function before it is changed.
- **Pipelines (H5):** a step *Rebuild code maps* after *Pull all*.
- **Done when:** a Go repo and a frontend repo each get a map from the Repos page with no network traffic, the report shows on the page, and a Claude session in that workspace answers "what calls X" from the map.

## 5. Order of work

Each milestone is several small PRs (under about 10 files each), planned in its own folder before coding.

| # | Milestone | Why here |
|---|---|---|
| H1 | Profiles (§4.1) | Everything else launches under a profile |
| H2 | Palette, global hotkey, launcher (§4.2) | Makes devdeck the place you start things |
| H3 | Switchboard first (VS Code and Claude app per feature, hooks, global hotkey: [`2026-11-21-switchboard/`](../2026-11-21-switchboard/plan.md)), terminal tabs later (§4.3) | The most-used piece day to day |
| H4 | Windows, screens, layouts (§4.4) | Turns launches into arranged workspaces |
| H5 | Pipelines (§4.5, main plan Phase 7), then n8n alongside (§4.5.1) | Needs H1 to H4 for its best steps; n8n comes once the engine and its webhook trigger exist |
| H6 | Projects at a glance (§4.6) | Mostly on top of the Repos page; can start any time |
| H7 | Neon theme and effects (§4.7) | Independent; can run alongside any milestone |
| H8 | Full screen, widgets (§4.8) | Small once H4 and H7 exist |
| H9 | First run, export / import, Linux (§4.9) | Last |
| H10 | Phone and tablet companion (§4.10): its own plan and security review first | Most useful once pipelines (approvals, H5) and the system widgets (H8) exist; the view-only part can come earlier |
| H11 | Code map with Graphify (§4.11) | Independent and small; can come any time. Most useful next to Flow trace |
| H12 | Flow trace ([`2026-11-21-flow-trace/`](../2026-11-21-flow-trace/plan.md)): follow one request across repos over HTTP and NATS | **Last**, by the owner's choice. Uses the switchboard, the logs and the Code map |

The Features stack (PRs 5 to 10) and release builds (next-steps §2) are already in flight; H1 can start after the current PR or alongside it.

**Changed 2026-11-21 (owner):** H7, the look, goes first. Its plan is [`2026-11-21-neon-look/`](../2026-11-21-neon-look/plan.md). H1 (profiles) follows.

## 6. Risks

- **Window control is fiddly:** some apps (Electron, UWP) report odd sizes or ignore moves; elevated windows can't be moved from a normal process. Layouts retry once and report what didn't move.
- **Terminal security:** a WebSocket that runs commands is the most sensitive endpoint devdeck would have (§3.10).
- **Claude Code changes:** flags and hooks can change between versions. Doctor checks the installed version against the one tested.
- **Effects and performance:** blur and glow are costly on WebView2 with many panels; the effects level and the budget guard it.
- **Hotkey conflicts** with other apps: the hotkey is changeable and devdeck says when registering fails.

## 7. Open questions

1. **Look:** keep Paper as the default with Neon opt-in (as proposed), or make the Neon look the default? The second changes the UI rules in `CLAUDE.md`.
2. **Claude Code inside devdeck:** a real terminal first (proposed), or a chat-style panel on headless runs first?
3. **VS Code:** drive and arrange the real VS Code (proposed), or also try code-server inside devdeck?
4. **Profiles:** is the tool list in §4.1 right? Anything else that must switch (Slack, Teams, a mail client, a VPN)?
5. **Terminal and auth:** add a per-start token for the terminal WebSocket (a small step, not full auth), or rely on the Host/Origin check alone?
6. ~~**Order:** start with H1 (profiles) as proposed, or with H7 (look)?~~ Answered 2026-11-21: H7 first (§5).
7. **Companion network:** for the phone and tablet (§4.10), HTTPS on the home network with a certificate trusted at pairing, or Tailscale (works away from home too), or USB tethering only?
8. **Companion app:** devdeck's web app in the phone's browser (proposed), or a native Android app later for notifications while it's closed?
9. **Code map:** build maps for every repo of a workspace at once (proposed), or only on request per repo?
