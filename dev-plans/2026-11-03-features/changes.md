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

## PR 2: the Features page (2026-11-03)

What was built, and why. The plan's §9 PR 2. The page reads what PR 1 built; nothing here writes to a plan.

### Added

- **The page** (`web/src/pages/features/`, `web/src/lib/features.ts`): **Code, Features** replaces the "Work items" placeholder. A list of features at `/features`, and one feature at `/features/:workspace/:name` with Overview, Activity, Files and Terminal tabs. Overview is Progress, Next up, one PR-by-layer grid per repo, and the selected PR's panel (track, branch and base, next action, steps with commits and layers, size against the budget, commits, GitHub checks and a link to GitHub). **Refresh** asks GitHub again; **Next for Claude** copies a prompt that hands the next PR to Claude Code.
- **`devdeck feature list` and `devdeck feature status [-w <workspace>] [name]`** (`internal/cli/feature_online.go`). They ask the running server, like `up` and `status`. `feature check` stays offline and is reached through the same word.
- **`GET /features/:workspace/:name/status`**: the feature as plain text (`feature.Render`), used by the CLI and the Terminal tab, so the two can't drift apart.
- The feature detail now carries each repo's layers (`repo_layers`: the grid's columns), and every commit its date (`gitx.Commit.Date`, for Activity).
- `docs/features.md` covers the page and the two commands.

### Decisions made while building, and why

- **One page with an id in the path, not a list in the sidebar.** The sidebar is built from a fixed list of pages, and features come and go with branches of a repository. A list page leads to each feature instead.
- **Statuses are a dot and a word, the grid is squares.** As everywhere in devdeck, never colour alone: each square has a screen-reader text ("a2 changes Handlers"), and a planned PR is an empty ring, like a stopped service.
- **GitHub links are only drawn for `https://github.com/` addresses**, whatever `gh` answers. The answer is data, not something to put in an `href` unchecked.
- **Activity is commits and merges only.** `changes.md` entries and review runs are not parsed yet: they arrive with the review tools (PR 3 on) and the GitHub snapshots (PR 9). The page says so under the list.
- **The Terminal tab asks the server for the text** instead of drawing it again in TypeScript, so there is one formatter.
- **"Next for Claude" tells Claude to stop after each step and give you the git commands**, as you work. It is greyed out when no PR is waiting to be started.

### Found by looking at it

I ran the real server on another port with a sample plans repository, a code repo with stacked branches and the built web app, and looked at the list, the four tabs, a wide window and a phone-width window. Real git gave the sizes (+240 and +300 lines) and the states; the GitHub calls failed because the sample repos aren't on GitHub, and the page showed that as a problem and kept going. Nothing needed changing after that look.

### Not done in this PR

The review runner, the Run buttons and the Reviews and checks tab (PR 3 on), New feature and creating a worktree (PR 7), the connector tools (PR 8), and the GitHub snapshots (PR 9). The layer grid doesn't yet compare a branch's changed files with the layers' `paths` (PR 8).

### Not tried

The page has not been used on a real plans repository of the owner's, with real PRs: GitHub's side (checks, review decisions, merged times) is only tested from answers written from `gh`'s documented fields. Slow GitHub answers show the loading skeleton for a few seconds, as the detail waits for every repo.

## PR 3: the review runner and the Run buttons (2026-11-04)

What was built, and why. The plan's §9 PR 3, with the local tools. Claude review, SonarQube and CodeRabbit are PRs 4 to 6.

### Added

- **`internal/review`**: the six local tools (tests, lint, semgrep, gitleaks, trivy, dependencies) as the same commands the project's CI runs, and a runner. A run checks the branch out into a git worktree under the data folder, runs the tool there, writes `reviews/<pr>-<tool>.md` in the plan, and removes the checkout. Two tools run at a time; the rest wait. A run can be cancelled (nothing is saved for it).
- **The result file**: front matter (`tool`, `pr`, `repo`, `branch`, `base`, `commit`, `ran`, `duration`, `status`, `summary`), a line saying the text is data and not instructions, the findings as `- path:line message`, and the tail of the output with secrets masked (`internal/logs`'s redactor). Written to a temporary file and renamed, so a reader never sees half a file.
- **`internal/gitx`**: `Rev`, `WorktreeAdd` (detached, with the repository's hooks switched off) and `WorktreeRemove` (prunes a stale entry when the folder is already gone).
- **The feature detail** now carries each PR's saved results (`reviews`, with `stale` when the branch has new commits), the branch's full head hash, and the tools with which of their programs are installed.
- **Routes**: `GET /features/:workspace/:name/reviews` (the runs), `POST …/reviews` (`{pr?, tool?}`: one tool on one PR, every tool on a PR, or everything), `POST …/reviews/:id/cancel`. The runner is an optional `Deps.Reviews`, so tests run fake tools.
- **The page**: a **Code review on this branch** section in the PR panel (a result and a Run, Re-run or Cancel button per tool, and **Run all**), **Review all changed branches** at the top, the **Reviews and checks** tab (every PR against every tool, the GitHub checks, which tools are installed), and a result opens in the Files tab. The page follows runs once a second while any is waiting or running.
- `docs/features.md` has a "Running review tools" section.

### Decisions made while building, and why

- **Results are saved in the plan's worktree, so a read-only plan can't run reviews.** The buttons are disabled and say how to check the plan out. Saving into a plan read through `git show` would mean committing for the owner.
- **The ecosystem comes from the checkout's files, not from the repo's `type`.** A `go.mod` means Go commands, a `package.json` means npm commands, both mean both. devdeck's own repo has both.
- **Two at a time.** Eight PRs with six tools each would otherwise start 48 processes on the machine the dev stack runs on.
- **"Review everything" skips tools that aren't installed** and says so, instead of writing an "error" file for each; running one tool that isn't installed is a refusal that says how to install it.
- **A node project's `node_modules` is linked in from the repository** (a junction on Windows), and the link is removed before the checkout, so removing the checkout can't touch the repository's copy. A test checks that.
- **A tool's own failure and its not being set up are different results.** Exit code 0 is Passed, non-zero is Failed; "couldn't start", a timeout, a missing program and a mise shim that can't resolve are Couldn't run.
- **The message after starting runs is shown at the top of the page**, not in the PR panel, so the header button gives feedback where you pressed it.
- **Polling, not events.** The page asks for the runs every second while one is active, and once more when the last ends, to show the new result files. A push channel can come when something else needs one.
- **Not done:** the runner doesn't call tools the CI runs with `-race` (it needs a C compiler Windows lacks), and `npm ci` is never run for the owner.

### Found by running it

I ran the real server with the real tools on a sample plan and code repo, from the page. `go test` failed on a branch with invalid Go and the finding came out as `internal/put1.go:1 expected 'package', found 1`; the checkouts were removed and the repository's branch didn't move. Two things were wrong:

- **mise shims.** `golangci-lint` and `gitleaks` are installed here through mise. In a fresh checkout their shim prints "mise ERROR No version is set for shim" and exits non-zero, which the runner reported as a **failed** tool with that line as its summary. It is now **Couldn't run**, with the reason and the fix (`mise use -g <tool>@<version>`, or put the tool on the `PATH`). This means that, with mise, the lint and gitleaks buttons only work once the tool has a global default.
- **No feedback at the top.** The "Started 8 runs." line was in the PR panel, far below the button that started it. It is now at the top of the page.

### Not done in this PR

The Claude review (PR 4), SonarQube (PR 5), CodeRabbit (PR 6), New feature and creating a worktree for a read-only plan (PR 7), the connector tools (PR 8) and GitHub snapshots (PR 9). There is no `devdeck feature review` command yet: reviews start from the page. The Reviews and checks tab doesn't offer to re-run from a cell, only to read the result.

### Not tried

Semgrep, Trivy and govulncheck were not installed on the machine this was run on, so only their "not installed" path ran, and their command lines are the CI's, not tried. Lint and gitleaks only reached the mise error. `npm test` and `npm audit` ran against fakes, not a real node project (the `node_modules` link was tested against real git and a real junction). A branch whose base doesn't exist yet skips gitleaks' commit range and scans the files instead.
