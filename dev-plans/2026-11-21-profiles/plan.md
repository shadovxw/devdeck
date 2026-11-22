# Profiles: work and personal, side by side

> 2026-11-21 · owner: Vrishank Warrier · milestone H1 of [`2026-11-21-desktop-hub/`](../2026-11-21-desktop-hub/plan.md) (§4.1, decisions 1 and 2) · builds on git accounts ([`2026-10-22-git-accounts/`](../2026-10-22-git-accounts/plan.md)) · status: **plan, for review. Nothing built.**

## 1. The problem

The owner works in two worlds on one PC: work and personal. Each has its own GitHub account, maybe its own Claude Code login, its own VS Code sign-ins and extensions, its own browser profile, its own cloud profile, and its own projects. Today the switch is by hand and easy to get wrong: a terminal still signed in to the other Claude, a browser on the wrong Google account, a commit with the wrong email.

**Goal:** pick **Work** or **Personal** in devdeck, and everything devdeck opens from then on uses that world's accounts, with both worlds open at once if you like.

## 2. What already exists

- **Git** is already right per repository: devdeck is git's credential helper and picks the `gh` account and the commit identity from the remote (`github.com/<owner>/*` rules). That stays: a repo's identity comes from its remote, never from the profile. A personal terminal in a work repo still commits as work, which is what you want.
- **Docker Hub** accounts are chosen per image, and **AWS** profiles per remote host. They stay where they are; a profile only adds the default for new ones.

## 3. Decisions

1. **A profile is a set of launch settings, not a sign-in.** devdeck never stores a password or token for a profile. Each tool keeps its own sign-in in its own place; the profile only says *which* place.
2. **Launch with the profile, don't flip the machine** (hub decision 2). devdeck starts a tool with the profile's flags and environment. Nothing machine-wide changes, so a Work VS Code and a Personal VS Code can be open together.
3. **What a profile sets, per tool:**

   | Tool | Setting | How devdeck applies it |
   |---|---|---|
   | Claude Code | config folder (empty = Claude's default) | `CLAUDE_CONFIG_DIR` for what it launches: its own login, settings, MCP servers and history |
   | VS Code | VS Code profile name, and optionally a separate user-data folder | `code --profile <name>`; with a folder, `--user-data-dir` and `--extensions-dir` for fully separate sign-ins |
   | Browser | Chrome or Edge, and which of its profiles | `--profile-directory=<dir>` |
   | `gh` (in terminals) | optional config folder | `GH_CONFIG_DIR`; empty = the normal one (devdeck's own git calls already pick the account per repo) |
   | AWS | profile name | `AWS_PROFILE` in terminals, and the default for new hosts |
   | Terminal | shell (PowerShell by default), start folder | the program devdeck starts |
   | Environment | a few extra variables, **no secrets** | added to what it launches. A value that looks like a key or token is refused; secrets go through the keyring later |
   | Projects | which workspaces show | the Workspaces and Repos pages, Home, the workspace picker |

4. **Profiles live in devdeck's data folder** (`profiles.yaml`), like `git-accounts.yaml`: never in a repo, never in this public one. Export and import come with hub milestone H9.
5. **One active profile for the whole app** (kept on the server, so the window and a browser tab agree), shown in the top bar as a name and a colour mark; switching is instant and changes what is shown and what launches next. Windows already open keep their profile. With no profiles defined, devdeck behaves exactly as today.
6. **Launching only opens known things.** The launch API opens a folder devdeck knows (a workspace repo or the workspace folder), a URL that is `http` or `https`, or nothing; the programs and flags are fixed by devdeck, never sent by the page. Behind the Host/Origin guard as everything else.
7. **Profile ids and names are plain text, colours come from the theme** (one of the status/accent tokens, so every theme still works).

## 4. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| P1 | `internal/profile`: model, `profiles.yaml`, validation (no secret-looking values), table tests. API `GET/PUT /profiles`, `PUT /profiles/active`. A **Profiles** page (list, add, edit, delete with confirm) and the top-bar switcher. The workspace pages show only the active profile's workspaces | Two profiles can be made and switched; Workspaces shows each one's projects; no profiles = today's app |
| P2 | Launching: `POST /profiles/{id}/open` for **VS Code**, **terminal**, **Claude Code** (a terminal running `claude` in the folder) and **browser**; buttons on the repo and workspace cards. Pickers fill themselves from what's installed: VS Code profiles (from VS Code's own list), Chrome and Edge profiles (from their `Local State`) | With Work active, one click opens a repo in VS Code, a terminal and Claude Code, all with the work settings; switching to Personal and clicking again opens the personal ones, both sets open at once |
| P3 | `devdeck profile list | use <name> | env <name>` (`env` prints PowerShell lines, so any terminal can adopt a profile: `devdeck profile env work | Invoke-Expression`). Doctor: per profile, the Claude folder exists and is signed in, the VS Code profile exists, the browser profile exists, the `gh` folder has the expected user | `devdeck profile env` works in a fresh terminal; Doctor flags a profile whose Claude folder was never signed in |
| P4 | Polish: Ctrl+Alt+P to switch, the profile's colour on the top bar, `docs/profiles.md` (how to set up a separate Claude login and VS Code sign-ins, step by step) | The guide takes a new user from nothing to two working profiles |

## 5. First-time setup the owner will do (P2 and later)

- **Claude Code, separate login:** make a folder for the second profile (for example `%USERPROFILE%\.claude-work`), set it on that profile, open Claude Code from devdeck under that profile and run `/login` once. From then on that profile is signed in there.
- **VS Code:** create a VS Code profile (Profiles → New Profile) per world, or give the profile its own user-data folder for separate GitHub/Microsoft sign-ins.
- **Browser:** nothing new: pick the existing Chrome or Edge profile from the list.

## 6. Risks

- **Claude Code or VS Code changing a flag or variable:** Doctor checks the installed versions and that the profile's settings still work.
- **A separate VS Code user-data folder doesn't share extensions or settings** with the normal one; the guide says so and suggests a VS Code profile first.
- **Thinking the profile changes git identity:** the page says that commits use the repository's account (Connections), whatever profile is active.
- **Secrets in environment variables:** refused by a pattern check, and the field says "no secrets".

## 7. Open questions

1. Which tools should differ between your two profiles? (Claude login, VS Code sign-ins, browser profile, AWS, others like Slack or Teams.)
2. Separate Claude Code logins per profile (each signs in once in its own folder), or one Claude login for both?
3. Chrome, Edge, or both?
4. Should the active profile be one for the whole app (proposed), or per window when there are several windows later?
