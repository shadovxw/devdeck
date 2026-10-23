# Phase 4, PR B: Repository status and git operations

> Status: **built (2026-10-23), see `changes.md`** · covers plan §8 items 4.4.1 (status scan, on load rather than watched), 4.4.2 (fetch, pull, push, bulk) and 4.4.3 (clone a workspace onto a new PC) and the table part of 4.5.1. The pull-request list (4.4.4), file watching and the repository detail page (4.5.2) are PR C.

## 1. The problem

PR A tells you which account each repository uses. It doesn't tell you where the repository stands (which branch, whether it has changes, whether it is behind or ahead) and it can't do anything about it. On a new PC the workspace lists every repository and its remote, but each one still has to be cloned by hand.

## 2. Decisions

1. **Status is one git call per repository**: `git status --porcelain=v2 --branch`. It gives the branch, the upstream, ahead/behind and every changed file in one go. The Repositories page shows branch, `↑ahead ↓behind` and a count of changed files. A state is a word and a shape, never colour alone.
2. **Every action shows the exact command first** (review item G15). The button's tooltip is the command; a **Copy command** pill puts it on the clipboard so you can run it yourself. **Run** is the default for fetch (it changes nothing in the working tree); pull and push ask for an inline confirmation that shows the command.
3. **The commands are fixed and safe:**
   - fetch: `git fetch --prune origin`
   - pull: `git pull --ff-only` (never a merge or rebase: if it can't fast-forward, devdeck says so and leaves the repository as it was)
   - push: `git push` for a branch with an upstream, `git push -u origin <branch>` for one without. **Never `--force`.** A detached HEAD can't be pushed.
   - clone: `git clone <remote> <folder>`, then the identity of the account a rule picks is written to the new repository's own config (as "Set identity" does).
4. **The server runs git with `GIT_TERMINAL_PROMPT=0`** (and `GCM_INTERACTIVE=never`) and a time limit (2 minutes, 10 for a clone), so a missing credential fails with a message instead of hanging on a prompt. The credential helper from PR A answers for the repositories a rule covers.
5. **Bulk actions are a loop over single ones** in the page (so progress and failures show per repository): *Fetch all*, *Pull all* (only repositories that are behind, have a clean working tree and an upstream; confirmed once) and *Clone missing* (only repositories whose folder isn't there and whose workspace gives a remote). Push has no bulk action.
6. **Only github.com HTTPS remotes are cloned** (the same limit as PR A). The folder comes from the workspace (`root` + repo `path`) and must stay inside the root.
7. Tests use real git against temporary repositories and a local bare repository as the remote; no network, no real config (`GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` as in PR A).

## 3. Pieces

- `internal/gitx/ops.go`: `Status` (parse porcelain v2), `Operation` (fetch/pull/push with the command it will run), `Clone`.
- `internal/api/git.go`: `GET /git/repos` rows gain `work` (branch, upstream, ahead, behind, changed) and `commands`; `POST /git/repos/op` `{workspace, repo, op, confirm}` runs fetch, pull, push or clone and answers with the output and the refreshed row.
- Web: Repositories page gets Branch and Changes columns, the action pills with inline confirmation and Copy command, and the bulk bar.

## 4. Done when

From the Repositories page you can see which repositories are behind or have changes, fetch all, pull the ones that can fast-forward, push one with confirmation, and clone the repositories missing on a fresh machine, each using the right account without a popup.
