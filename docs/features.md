# Features: one plan for a piece of work, split into small PRs

A **feature** is one piece of work split into small stacked PRs, in one repo or several. Its plan lives in a private **plans repository**, one branch per plan. devdeck reads that, adds what git and GitHub say, and works out the state of every PR. Claude Code writes the plan and keeps it current; you decide and merge.

> This guide covers the plan format, the check and the read-only routes. The Features page, the review buttons and the GitHub snapshots come in the next PRs of [`dev-plans/2026-11-03-features/`](https://github.com/shadovxw/devdeck/blob/main/dev-plans/2026-11-03-features/plan.md).

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

## Checking a file

```bash
devdeck feature check <feature.yaml or the plan's folder>
```

It lists each problem with its line and exits with 1 on errors (`--json` is for scripts). Add `--workspace <name>` to also check that the repos and layers exist there. `devdeck schema feature` prints the JSON Schema, which VS Code's YAML extension can use.

## Asking Claude to write it

> Read the plan in `plan.md` and `docs/features.md` (the `features` guide from the devdeck connector). Write `feature.yaml` for it: one PR per slice, one step per commit, each step naming its layer. Quote commit ids. Then run `devdeck feature check --workspace <name> .` and fix what it lists. Don't commit anything.

## The routes

For tools and the page that comes next. They only read, and Claude's connector can't reach them yet.

- `GET /api/v1/features`: every plan of each workspace that has `plans_repo`, without calling GitHub.
- `GET /api/v1/features/<workspace>/<name>`: one feature with the live state of every PR (`?refresh=1` skips the minute's cache).
- `GET /api/v1/features/<workspace>/<name>/files/<path>`: one file of the plan, as text.

A problem with one repo (its folder isn't on this machine, `gh` isn't installed) is listed under `problems`, and the rest is still shown.
