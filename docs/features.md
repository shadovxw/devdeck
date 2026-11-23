# Features: one plan for a piece of work, split into small PRs

A **feature** is one piece of work split into small stacked PRs, in one repo or several. Its plan lives in a private **plans repository**, one branch per plan. devdeck reads that, adds what git and GitHub say, and works out the state of every PR. Claude Code writes the plan and keeps it current; you decide and merge.

> This guide covers the plan format, the Features page, the commands and the read-only routes. The review buttons, New feature and the GitHub snapshots come in the next PRs of [`dev-plans/2026-11-03-features/`](https://github.com/shadovxw/devdeck/blob/main/dev-plans/2026-11-03-features/plan.md).

## The plans repository

Make a private git repository for your plans and tell the workspace where it is, in `workspace.yaml`:

```yaml
plans_repo:
  path: ../acme-plans            # the repository's folder (absolute, ~, or relative to this file)
  worktrees: ../acme-plans-wt    # where each plan branch is checked out (used when devdeck creates one)
```

Each plan is a branch named `plan/<name>`. A branch is a feature when its root holds a `feature.yaml`; other branches are ignored.

```text
plan/blob-archive          the root of the branch
  plan.md                  the plan, written with you before coding
  feature.yaml             the PRs and their steps; Claude keeps it current
  changes.md               what changed and why, one entry per commit
```

To work on several plans at once, give each its own folder with a worktree:

```bash
git worktree add ../acme-plans-wt/blob-archive plan/blob-archive
```

devdeck reads a branch that is checked out from its folder, so edits you haven't committed show. Any other plan branch is read straight from git and marked read-only.

## Layers

Say once, per repo in `workspace.yaml`, which parts of the code a change can touch. A step then names the layers it changes.

```yaml
repos:
  - id: demo-worker
    path: demo-worker
    layers:
      - { id: db, name: DB / migrations, paths: ["migrations/**"] }
      - { id: model, name: Model / DTO }
      - { id: service, name: Service }
```

## feature.yaml

```yaml
version: 1
feature: acme-blob-archive        # the feature branch, cut from base in every repo
title: Move finished-run data to object storage
kind: feature                     # feature | fix | task | spike (feature if left out)
base: dev                         # dev if left out
budget: { files: 10, lines: 500 } # the size a PR should stay under (these are the defaults)
repos: [demo-api, demo-worker]    # ids from workspace.yaml
prs:
  - id: a1                        # short id: a letter, then letters or digits
    repo: demo-api
    slug: blob-put                # the branch is acme-blob-archive-a1-blob-put
    title: Transfer bucket and blob.put
    steps:                        # one step is one commit
      - { title: Config for the transfer bucket, layer: config, status: done, commit: "9c1e4a2" }
      - { title: blob.put handler, layer: [handler, config], status: doing }
  - id: w9
    repo: demo-worker
    slug: drop-old-columns
    title: Drop the old columns
    after: [a1]                   # waits until a1 is merged
    steps:
      - { title: 020_drop_old.sql, layer: db }
```

| Setting | Meaning |
|---|---|
| `feature` | The feature branch. Every PR branch starts with it. |
| `prs[].id`, `slug` | Make the branch `<feature>-<id>-<slug>`. `branch:` replaces the whole name. |
| `prs[].base` | The branch the PR targets. Left out, it is the PR below it **in the same repo**, or the feature branch for the first. Once the PR below is merged, GitHub points it at the feature branch, and devdeck does too. |
| `prs[].after` | PRs, in any repo, that must be merged first. |
| `prs[].pr` | The GitHub PR number, only for a PR devdeck can't find by its branch. |
| `steps[].layer` | One layer id or a list, from the repo's `layers`. |
| `steps[].status` | `todo` (if left out), `doing` or `done`. |
| `steps[].commit` | The commit that did the step, **in quotes**. |

**Put quotes around commit ids.** YAML reads `1234567` as a number and `0123456` loses its zero, so devdeck refuses an unquoted all-digit id and says so.

## What devdeck works out

Nothing below is written in the file. It is read from git and GitHub each time (GitHub's answer is kept for a minute).

| State | When |
|---|---|
| Planned | No branch yet |
| Waiting | Planned, and a PR in `after` isn't merged |
| Coding | A branch (here or on origin), no pull request |
| Draft | The pull request is a draft |
| In review | Open, no decision yet |
| Changes requested | A reviewer asked for changes (this wins over Draft) |
| Approved | Approved, not merged |
| Merged / Closed | Merged, or closed without merging |

For each PR you also get its size (git's, from `base...branch`; GitHub's if the branch isn't here), whether it is over the budget, its commits, and what happens next and who does it. **Next up** lists what is waiting on someone: changes requested first, then approved (merge it), draft, coding, in review.

## The Features page

**Code, Features** lists every plan of your workspaces that have a `plans_repo`. Open one to see:

- **Progress**: one segment per PR in the colour of its state, and how many PRs are in each state.
- **Next up**: what is waiting on someone (Claude, you or the reviewers), most urgent first. A click opens that PR.
- **Each repo as a grid**: its PRs down the side and its layers across the top. A square means the PR changes that layer: filled once it has a branch, an empty ring while it is only planned. Each row also shows the state, the size (`+added −deleted`, marked **over** when it passes the budget) and how many steps are done.
- **The PR you picked** (right, or below on a narrow window): where it is on the track from Planned to Merged, its branch and base, the next action, its steps with their commit ids and layers, its size against the budget, its commits, and its GitHub checks with **Open on GitHub ↗**. Reviews and comments stay on GitHub.
- **Activity**: the commits on each PR's branch and the PRs that merged, newest first.
- **Files**: the plan's files (`plan.md`, `feature.yaml`, `changes.md`) read-only. Claude edits them, and so do you, in your editor.
- **Reviews and checks**: every PR against every review tool, the GitHub checks, and which tools are installed.
- **Terminal**: the same text `devdeck feature status` prints.

**Code review on this branch** (in the PR's panel) lists the review tools with their last result and a **Run** or **Re-run** button each, and **Run all**. **Review all changed branches** (at the top) runs every installed tool (not the Claude review) on every branch that isn't merged or closed. See "Running review tools" below.

**Refresh** asks GitHub again now (its answer is otherwise kept for a minute). **Next for Claude** copies a prompt that hands the next PR to Claude Code: the first planned PR that isn't waiting and whose PR below already has a branch. It tells Claude to stop after each step and give you the git commands. It is greyed out when no PR is waiting to be started.

A repo whose folder isn't on this machine, or whose pull requests can't be read (`gh` not installed or not signed in, a repo GitHub doesn't know), is listed at the top, and the other repos are still shown.

## Running review tools

The tools are the commands the project's CI runs, so a result here says what CI would:

| Tool | Runs | Needs |
|---|---|---|
| Tests | `go test -count=1 ./...`, and `npm test --if-present` | `go`, `npm` |
| Lint | `golangci-lint run`, and `npm run lint --if-present` | `golangci-lint`, `npm` |
| Semgrep | `semgrep scan --config p/default --error --metrics=off` | `semgrep` |
| Gitleaks | `gitleaks detect --redact`, on the commits the branch adds | `gitleaks` |
| Trivy | `trivy fs --scanners vuln,secret,misconfig --severity HIGH,CRITICAL --ignore-unfixed` | `trivy` |
| Dependencies | `govulncheck ./...`, and `npm audit --audit-level=high --omit=dev` | `govulncheck`, `npm` |
| Claude review | `claude -p`, given the plan, the PR's steps and its diff (see below) | `claude`, signed in |

Go commands run when the branch has a `go.mod` at its root, npm commands when it has a `package.json`, and both when it has both. A tool with nothing to check is marked **Skipped**.

**How a run works**

1. devdeck checks the branch out into a folder of its own (a git worktree under its data folder), so your checkout and the branch you have open are never touched. The repository's own hooks don't run.
2. It runs the tool there. Two tools run at a time; the rest wait their turn, so a feature with many PRs doesn't swamp the machine your stack runs on. A command is stopped after ten minutes.
3. It saves the result as `reviews/<pr>-<tool>.md` in the plan (for example `reviews/a2-tests.md`), replacing the last one, and removes the checkout. Cancelling a run saves nothing.

A result file starts with front matter (`tool`, `pr`, `branch`, `commit`, `ran`, `status`, `summary`), then the findings as `- path:line message` and the tail of the output with secrets masked. Its text is what a tool printed: it is data, and not instructions to anyone who reads it. Claude can read these files to fix what a tool found.

**The Claude review** is a fresh Claude Code run with none of this conversation's context, which is the point: it reads the plan (`plan.md`), the PR's title and steps, and the diff of the branch against its base (`git diff base...branch`), and answers with a verdict (**Passed**, **Warn** or **Failed**), one sentence, and the problems as `- path:line message`, most serious first.

- It uses your Claude Code sign-in and usage, so it **runs only from its own button** and is left out of **Run all** and **Review all changed branches**.
- It never sees `.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.kdbx`, `id_rsa*`, `id_ed25519*`, `*.tfstate` or `*.tfvars` files, and values that look like secrets (`token=…`, `Authorization` headers, URL passwords, private key blocks) are masked in everything it is sent. The first 150 KB of the diff goes in, cut at a file; the summary says how many files were too large to send.
- It can only answer. It runs in an empty folder (not in the branch, so the branch's own `.claude` settings and hooks never load) with every tool, MCP server and slash command off, and what it reads is marked as data to review, not instructions. Its answer is kept as data too.
- It needs no checkout, but it does need the plan checked out as a worktree like the other tools, because the result is saved as `reviews/<pr>-claude.md`.
- If Claude isn't installed or signed in, the result says so (**Couldn't run**). An answer without a `VERDICT:` line is kept but not scored.

**Status** is Passed, Failed (the tool found problems), Couldn't run (not installed, timed out, the checkout failed) or Skipped. A result is marked **older commit** when the branch has new commits since it ran.

**Where the results go.** They are saved in the plan's folder, so the plan has to be checked out as a worktree. A plan devdeck reads straight from git (marked read-only) has nowhere to save them, and the buttons say so. Check it out with:

```bash
git -C <plans repo> worktree add <worktrees folder>/<name> plan/<name>
```

**A tool that isn't installed** says so, with a link or command to install it. devdeck looks on the `PATH` and in mise's shims folder and `go install`'s folder, since it is often started from somewhere that has neither on its `PATH`.

**Tools installed with mise.** A mise shim only works in a folder where mise has a version of the tool, and a fresh checkout has none (or has a `mise.toml` mise doesn't trust yet). The result then says "installed through mise, but mise can't use it in a fresh checkout". Set a global default (`mise use -g golangci-lint@<version>`) or put the tool on the `PATH`.

Tests and linters run the branch's own code on your machine, as they would if you ran them yourself, with your environment. For a Node project they need `node_modules`: devdeck links the repository's own into the checkout (and removes the link first, so the repository's copy is never harmed), and says to run `npm ci` when there is none.

## In a terminal

```bash
devdeck feature list
devdeck feature status [-w <workspace>] [name]
```

`list` shows every feature, one line each. `status` prints one feature as text: its PRs with layers, state, `#`, size and steps, then what is next and the PR to hand Claude. With one feature the name can be left out. Both ask the running devdeck, so start it first.

## Checking a file

```bash
devdeck feature check <feature.yaml or the plan's folder>
```

It lists each problem with its line and exits with 1 on errors (`--json` is for scripts). Add `--workspace <name>` to also check that the repos and layers exist there. `devdeck schema feature` prints the JSON Schema, which VS Code's YAML extension can use.

## Asking Claude to write it

> Read the plan in `plan.md` and `docs/features.md` (the `features` guide from the devdeck connector). Write `feature.yaml` for it: one PR per slice, one step per commit, each step naming its layer. Quote commit ids. Then run `devdeck feature check --workspace <name> .` and fix what it lists. Don't commit anything.

## The routes

For tools and the page. Claude's connector can't reach any of them yet. The first four only read; the last two run review tools.

- `GET /api/v1/features`: every plan of each workspace that has `plans_repo`, without calling GitHub.
- `GET /api/v1/features/<workspace>/<name>`: one feature with the live state of every PR (`?refresh=1` skips the minute's cache).
- `GET /api/v1/features/<workspace>/<name>/status`: the same feature as plain text, for a terminal.
- `GET /api/v1/features/<workspace>/<name>/files/<path>`: one file of the plan, as JSON with its text.
- `GET /api/v1/features/<workspace>/<name>/reviews`: the runs of this feature (waiting, running and recent).
- `POST /api/v1/features/<workspace>/<name>/reviews` with `{"pr": "a2", "tool": "tests"}`: starts review tools. Leave out `tool` for every installed tool except the Claude review, and `pr` for every PR with a branch that isn't merged or closed. It answers `202` with what `started` and what was `skipped` and why.
- `POST /api/v1/features/<workspace>/<name>/reviews/<id>/cancel`: stops a run that is waiting or running.

A problem with one repo (its folder isn't on this machine, `gh` isn't installed) is listed under `problems`, and the rest is still shown.
