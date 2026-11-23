# Changes: Repository status and git operations (Phase 4, PR B)

## Status of every repository

- `gitx.Git.Work` runs `git status --porcelain=v2 --branch` once per repository and `ParseWork` reads it: the branch (or a detached HEAD), the upstream, how many commits ahead and behind, and how many files are changed (modified, staged, in conflict or untracked; ignored files don't count).
- `GET /git/repos` rows gain `work` and `commands` (the exact fetch, pull and push commands that can run right now, with the folder named), and, for a folder that is missing but whose workspace gives an https github.com address, `clone` (the address and the clone command).
- The Repositories page has a **Branch** column: the branch, `↑ahead ↓behind` (with the words for a screen reader), `up to date`, `no upstream` or `detached HEAD`, and `N changed`. The remote address moved to the tooltip of the repository name to make room.

## Actions

- Fixed commands, one per action, never with `--force`:
  - fetch: `git fetch --prune origin`
  - pull: `git pull --ff-only` (a diverged branch is refused by git and left exactly as it was; the test checks HEAD didn't move)
  - push: `git push`, or `git push -u origin <branch>` for a branch with no upstream; with nothing to push, or a detached HEAD, devdeck says so instead of running
  - clone: `git clone -- <address> <folder>`, then the identity of the account a rule picks is written into the new repository (the same thing **Set identity** does)
- `POST /git/repos/op {workspace, repo, op, confirm}` runs one of them. Everything except fetch needs `confirm: true`. A refusal is 422 with the reason; a git failure is 502 with git's own message (the last 4 KB). Two operations on one folder never run at once.
- git runs with `GIT_TERMINAL_PROMPT=0` and `GCM_INTERACTIVE=never`, so a missing credential fails with a message instead of waiting for a prompt nobody can see. The credential helper from PR A answers for the repositories a rule covers. Fetch, pull and push may take 2 minutes, clone 10.
- **Clone only takes `https://github.com/<owner>/<repo>`**: ssh, other hosts, local paths and anything that looks like an option are refused (`CloneAddress`), and the address is passed after `--`. The folder comes from the workspace and was already checked to stay inside its root.
- On the page, the buttons are small round pills. **Fetch** runs at once. **Pull** is on only when the branch is behind, **Push** only when there is something to push. Pull, Push and Clone first show the exact command with **Run**, **Copy command** (to run it yourself) and **Cancel**, as the plan review (G15) asks. The result (git's output, or the error) appears under the status.

## Bulk actions

**Fetch all**, **Pull all (n)** and **Clone missing (n)** run the single operations one after another from the page, so each repository reports for itself: "Pulling 2 of 5…", then "Pulled 4 of 5." with the failures listed. Pull all takes only the repositories that are behind and have no changes, and asks once, listing them. There is no Push all.

## Tests

- Go: `ops_test.go` runs real git against a bare repository on disk (clone with identity, status, push, fetch, fast-forward pull, `-u` for a new branch, a refused diverged pull that leaves HEAD alone, clone into a folder with files); tables for `ParseWork`, `Plan` (including that no plan ever forces) and `CloneAddress`. `api/git_test.go` covers the new fields and the route (confirmation, refusals, 404s, a push that makes the upstream appear).
- Web: `repos-actions.test.tsx` covers the Branch column, which buttons are on, fetch at once, confirm / copy / cancel / run for pull, a failed push, clone, and the three bulk actions.

## Not in this PR (PR C)

The pull-request list and checks (4.4.4), the repository detail page (changes, commits, branches, commit from devdeck, 4.5.2), and file watching to refresh the status on its own (the page refreshes when it is opened and after each action).

## Known limits

- HTTPS and github.com only, as in PR A.
- A repository's status is read when the page loads; use Fetch to learn what changed on GitHub.
- Pull all skips repositories with changes rather than trying and failing; pull those one at a time.
