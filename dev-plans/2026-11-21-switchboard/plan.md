# Switchboard: one click to the right VS Code window and Claude session

> 2026-11-21 · owner: Vrishank Warrier · part of the hub ([`2026-11-21-desktop-hub/`](../2026-11-21-desktop-hub/plan.md)): replaces the "Claude tabs inside devdeck" idea of §4.3 as the first step, and takes the "open in VS Code" part of main plan Phase 11 · builds on Features ([`2026-11-03-features/`](../2026-11-03-features/plan.md)) · status: **plan, for review. Nothing built.**

## 1. The problem

The owner works in **VS Code** and the **Claude desktop app** (its Code tab), on 8 or 9 repos at once, with many windows and sessions open. Finding the right one with Alt+Tab is slow. Most features are **one Claude chat**, and each feature touches several repos and branches.

**Goal:** devdeck is the switchboard. From a feature, a repo or a stack, one click brings forward *that* VS Code window or *that* Claude session, or starts a new one in the right place. devdeck **replaces nothing**: VS Code and the Claude app stay where the work happens.

## 2. What the tools allow (checked 2026-11-21)

- **Claude app links** (official): `claude://code/new?folder=<path>&q=<prompt>` opens a **new** Code session in that folder with the prompt filled in (not sent). The app asks the user to confirm the folder every time, even a trusted one. Source: Claude Help Center, "Open Claude Desktop with a link".
- **Opening an existing app session by id** is documented for the **mobile** app (`claude://code/{session-id}`), **not** for the desktop app. To be tested (S3); the plan has a fallback.
- **Claude Code hooks** (user settings, `~/.claude/settings.json`) run a command on events such as session start, a notification (Claude waiting for you), and stop. Each event carries the **session id** and the **folder**. Hooks come from the user's settings, so they should run for app sessions as well as terminal ones. **To be tested** in S2 before anything depends on it.
- **VS Code:** `code <folder>` brings forward the window that already has that folder open, or opens one; `code -g <file>:<line>` opens a file at a line.
- **Terminal Claude** has its own links (`claude-cli://open?cwd=…&q=…`) and `claude --resume <id>`: the fallback when the app can't open a session.

## 3. Decisions

1. **devdeck opens and focuses; it never types or sends.** A Claude prompt is only filled in; the owner reads it and presses Enter. Nothing in VS Code or Claude is changed except the hooks, installed with consent (decision 5).
2. **A feature has one chat by default**, and can have more. The link between a feature and its sessions is kept by devdeck (decision 4), not in `feature.yaml`.
3. **Each feature has a "chat folder"**, where its Claude session starts. Default: the workspace folder that holds the feature's repos (so one chat can work across them); a single-repo feature uses that repo's folder. Changeable per feature. (Open question 1.)
4. **Sessions are recorded locally**, in devdeck's database: session id, folder, the feature it belongs to, state (working, waiting, idle, ended), the time of the last event, and a short label (the first line of the first prompt, cut to 80 characters, kept only on this PC). Never sent to Claude or MCP, and not in any repo.
5. **Hooks are installed like the git setup:** a preview of exactly what is added to `~/.claude/settings.json`, a confirmation, and an **Undo** that restores the earlier file. The hook command is `devdeck claude-event`, which reads the event and posts it to the local server. It must be fast (under 100 ms) and must never block or fail Claude: if devdeck isn't running, it exits quietly.
6. **Linking a session to a feature:** when devdeck starts a session (Start new feature, Open Claude here) it remembers the folder and the time; the first session that starts in that folder within a few minutes is linked to that feature. Sessions started elsewhere show up as "not linked" with a **Link to feature** action.
7. **Only known places open.** The open API takes a feature, repo or stack id (and a file and line from a log or finding); devdeck turns that into a folder it knows. The page never sends a raw path or command. Behind the Host/Origin guard as everything else.

## 4. What the owner sees

**Features page, per feature**
- **Start new feature:** makes the feature as today, then opens the Claude app on a **new session** in the feature's chat folder, with a starting prompt filled in ("Read `plan.md` in `<plan folder>` and start PR 1"; editable in Settings).
- **Open chat:** brings back the feature's Claude session (S3: exactly, or the fallback). With several, a small list (label, last active).
- **Per repo and branch:** **Open in VS Code** focuses that repo's window (or opens it); **Open plan** opens the plan worktree in VS Code.
- **Status on the card:** "Claude working / waiting for you / idle", from the hooks.

**Repos page:** **Open in VS Code** and **Open Claude here** (a new session in that repo) per repo.

**Stacks and Logs:** **Open in VS Code** at the file and line of an error or test failure; **Ask Claude** opens a new session in that repo with the error filled in.

**Now open (a panel, and later the palette):** every Claude session that is running or waiting and every open VS Code window, grouped by feature and repo. Click to jump. A "waiting for you" session shows first, with a toast when it starts waiting.

**Getting to devdeck:** a global hotkey brings devdeck forward from any app (hub H2's hotkey, done here first), so any switch is two steps: hotkey, click.

## 5. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| S1 | **Open in VS Code** (folder, plan worktree, file:line) and **Open Claude here / Start new feature** (`claude://code/new` with folder and prompt) on Features, Repos, Stacks and Logs. API `POST /api/v1/open` with ids, not paths. Chat folder per feature | From a feature, one click focuses its repo's VS Code window, and Start new feature opens the Claude app in the right folder with the prompt ready |
| S2 | **Hooks and sessions:** `devdeck claude-event`; hook install with preview, confirm and undo (Settings → Claude); a `claude_sessions` table; linking sessions to features; status on feature cards; a toast when a session waits. First, a spike: do hooks fire for **app** sessions? | A session started from a feature shows "working", then "waiting for you" with a toast, on that feature's card |
| S3 | **Open chat** for an existing session. Spike: does the desktop app accept `claude://code/{session-id}`? If yes, use it. If not: bring the Claude app's window forward and show the session's label to pick it (and offer **Open in terminal**: `claude --resume <id>`). The **Now open** panel, including VS Code windows (from their window titles) | Open chat lands in the feature's session, or one click from it; Now open lists sessions and VS Code windows and jumps to each |
| S4 | **Global hotkey** (default Ctrl+Alt+Space, changeable) to bring devdeck forward; the Now open panel reachable from it | From any app, hotkey then one click reaches any feature's VS Code or Claude session |

## 6. Risks

- **Hooks may not run for app sessions,** or may change between Claude Code versions. S2 starts with a test; without them, status and automatic linking fall back to "opened from devdeck at …" and manual linking.
- **No documented desktop link to an existing session.** Fallback in S3; a request to Anthropic for one is worth filing.
- **The Claude app's folder confirmation** shows every time a link sets a folder. That is the app's safety rule and stays.
- **VS Code window titles** are the only way to list its windows without an extension, and a custom `window.title` setting can hide the folder. The VS Code extension (main plan Phase 11) is the exact way later; until then, focusing works by folder anyway (`code <folder>`).
- **Prompt labels are private text.** Only the first 80 characters of the first prompt, only on this PC, never logged or sent.

## 7. Open questions

1. **Chat folder for a multi-repo feature:** the workspace folder that holds the repos (proposed), the plan worktree, or the main repo?
2. **Starting prompt for a new feature:** the proposed "read `plan.md` and start PR 1", or something else?
3. **Terminal sessions too:** should sessions you start with `claude` in a terminal also show and link (the hooks would report them), or only Claude app sessions?
