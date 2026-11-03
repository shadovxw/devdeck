# Changes

## PR 1: the format and the live state (2026-11-03)

What was built, and why. The plan is [`plan.md`](plan.md); this is its §9 PR 1. No web changes: the page is PR 2.

### Added

- **`plans_repo` and per-repo `layers` in `workspace.yaml`** (`internal/workspace/types.go`, `schemas/workspace.schema.json`, `semantic.go`). Both optional, so a workspace without them works as before. A layer id used twice in one repo is an error.
- **`feature.yaml`** (`internal/workspace/features.go`, `schemas/feature.schema.json`): types, a JSON Schema, and the checks a schema can't make. It is a new `Kind` (`feature`) next to workspace, stack and flow, so it uses the same parsing, line numbers and issue format. Checked: repos exist and are listed in the feature, PR ids and branches are unique, `after` names real PRs and doesn't loop, a branch name is one git accepts, and (given the workspace's repos) every layer exists in its repo.
- **`internal/feature`**: finds plans (`plan/<name>` branches with a `feature.yaml`; read from the worktree when one exists, else with `git show`), works out each PR's branch, base and layers, and its state from git and `gh`, and builds Next up and the PR to hand Claude next.
- **`internal/gitx`**: read-only branch questions (`Branches`, `DiffStat`, `Commits`, `Worktrees`, `Files`, `Show`) and `GH.PullRequests`.
- **Routes** (`internal/api/features.go`): `GET /features`, `GET /features/:workspace/:name` (`?refresh=1`), `GET /features/:workspace/:name/files/*`, and `GET /schema/feature`.
- **`devdeck feature check [--json] [--workspace <name>] <file or folder>`**, and `devdeck schema feature`.
- **`docs/features.md`**, listed in the in-app guides.

### Decisions made while building, and why

- **The id in the URL is `<workspace>/<name>`, not one id.** A plan belongs to a workspace's plans repo, so two workspaces can each have a `plan/x`. The plan said `GET /features/:id`.
- **A step's `layer` is one id or a list.** The mockup showed steps that touch two layers (a handler and a config).
- **`version: 1` is required in `feature.yaml`**, like every other devdeck file. The plan's example left it out.
- **Closed is a state of its own.** A PR closed without merging isn't "coding" or "planned", and showing it as either would hide it. It is not in the plan's table.
- **Changes requested wins over Draft, and Draft over Approved.** Something needs doing in the first case, and an approved draft isn't mergeable.
- **The base of a PR moves to the feature branch once the PR below is merged**, as GitHub does. Without that, the size of the next PR would be worked out against a branch that no longer exists.
- **Only github.com remotes are read.** The workspace writes remotes as `host/owner/repo`; that form and git's own addresses are both understood.
- **The connector can't reach the new routes.** Its allow-list is a list of what it may read, and these are not on it (a test checks). They are added in PR 8, with the Features switch.
- **GitHub's answer is kept for a minute per repository and account**, and `?refresh=1` skips it. A feature with ten PRs in three repos would otherwise be three calls on every look.
- **A problem with one repo doesn't stop the rest**: it is listed under `problems` and the other repos' PRs are still shown.

### Found by the tests

- An all-digit commit id (`commit: 1234567`) is read by YAML as a number, and `0123456` loses its zero. About 1 in 40 seven-character hashes is all digits. The schema now says the commit is text, and the error says to put it in quotes. The guide and the prompt for Claude say so too.
- In a git worktree `.git` is a file, not a folder, so the file list showed it. Fixed.
- A repository name like `-x/y` passed the `gh pr list` check. Owners must now start with a letter or digit.

### Not done in this PR

The Features page and its tabs (PR 2), the review runner, buttons and tools (PRs 3 to 6), New feature and the worktree creation (PR 7), the connector tools (PR 8), and the GitHub snapshots (PR 9). `plans_repo.worktrees` is read and resolved but nothing creates a worktree yet.

### Not tried

Nothing was run against GitHub or a real plans repository of the owner's. The `gh pr list` call and its JSON are tested with answers written from `gh`'s documented fields; the first real run may find a field that differs. The race detector can't run on the owner's Windows PC (see `2026-10-31-next-steps.md`); the live state reads each repo in its own goroutine and the test fakes are guarded, so CI's `-race` run is the real check.
