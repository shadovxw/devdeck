# Features: track every PR of a feature, and review each branch with free tools

> 2026-11-03 · owner: Vrishank Warrier · builds on [`2026-10-23-git-operations/`](../2026-10-23-git-operations/plan.md) (git and `gh` per account), [`2026-10-30-claude-connector/`](../2026-10-30-claude-connector/plan.md) (read-only connector) and [`12-sonar-coverage.md`](../12-sonar-coverage.md) · covers plan §4.4.4 (PR list and checks) and most of Phase 10 (work items, Claude, PRs) · status: **planned, nothing built. Waiting for the owner's OK on §9 (PR order) and §10 (questions).**

## 1. The problem

A feature is planned as many small stacked PRs, often across several repos: each PR is 300 to 500 lines, has a few commits (one per step) and targets the PR below it in the same repo. With 10 or more PRs it is hard to see:

- which PRs are merged, in review, waiting on changes, still being coded or not started;
- which layer of each repo (DB, model and DTO, repo, service, handlers…) a PR changes, and which layers are done;
- whether a branch has been through the code-review tools (CodeRabbit, SonarQube Cloud, a Claude review, the local scanners) before it is raised;
- what Claude did last, and what is next.

GitHub shows one PR at a time. devdeck should show the whole feature on one screen, run the review tools on any branch with one click, and keep everything Claude does in the feature's own folder.

Not goals: a GitHub clone. Writing and replying to review comments, approving and merging stay on GitHub (§8). devdeck never pushes for Claude and never merges.

## 2. How it works, in one paragraph

You create a feature in devdeck. That makes a folder `dev-plans/<date>-<name>/` with a `feature.yaml`. Claude writes `plan.md`, fills `feature.yaml` with the PRs and their steps, ticks each step as it commits, and adds an entry to `changes.md` for each commit. devdeck reads that folder, adds the live state from local git and GitHub (`gh`), and shows it all on the Features page. On any PR you press **Run** next to a tool. devdeck runs it on that branch and writes the result to `reviews/<pr>-<tool>.md` in the same folder. Claude reads those files (and the GitHub threads, with `gh`) to fix what's open.

## 3. Decisions

1. **One folder per feature, and the folder is the source of truth.** A folder under the workspace's features directory is a feature when it contains `feature.yaml`. Other `dev-plans` folders are ignored. Live state (PR status, reviews, checks) is **not** written into the YAML. devdeck reads it from git and GitHub each time.
2. **Where the folders live:** a new optional `features_dir` in `workspace.yaml`, relative to the workspace root, default `dev-plans`. It can point inside a repo (for example a private notes repo) or at a plain folder next to the repos. A feature that spans several repos still has one folder.
3. **A feature has one or more repos.** `feature.yaml` lists repo ids from `workspace.yaml`. A one-repo feature is just a list of one.
4. **Layers belong to the repo, not to the feature.** `workspace.yaml` gets an optional `layers` list per repo: `id`, `name` and `paths` (globs). Each step in `feature.yaml` names one or more layer ids, and a PR's layers are the union of its steps' layers. Later (§9, PR 11) devdeck also maps a branch's changed files to layers with `paths` and flags a PR that touches a layer none of its steps names.
5. **Branch and base are derived, and can be overridden.** The branch is `<feature>-<pr id>-<slug>`. The base is the previous PR in the same repo, or the feature branch for the first PR (and once the PR below is merged, since GitHub retargets then). `branch:` and `base:` on a PR override both. `after:` lists PRs (from any repo) that must be merged first. For example, a "drop the old columns" PR waits for the readers to stop using them.
6. **The state of a PR is worked out, never typed by hand:**

   | State | When |
   |---|---|
   | Planned | No branch yet (local or remote) |
   | Waiting | Planned, and a PR in `after:` isn't merged |
   | Coding | Branch exists, no PR |
   | Draft | PR is a draft |
   | In review | PR open, no review decision yet |
   | Changes requested | `reviewDecision` is `CHANGES_REQUESTED` |
   | Approved | `reviewDecision` is `APPROVED` |
   | Merged | PR merged (into the base or the feature branch) |

   The **Next up** list is ordered: changes requested, approved (merge it), draft (finish the reviews), coding, in review. Each item says who acts: Claude, you or the reviewers.
7. **GitHub through `gh`, with the account the repo's rule picks** (the same as the Repositories page). One call per repo: `gh pr list --state all --search "head:<feature>-" --json number,headRefName,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,url,mergedAt,reviews`. The result is cached for 60 s and refreshed while the page is open, or on demand. Size, files and commits come from local git (`git diff --shortstat base...branch`, `git log base..branch`), so they work before a PR exists.
8. **Review tools run on a branch, in a separate git worktree.** devdeck checks the branch out with `git worktree add` into its data folder, runs the tool there and removes the worktree afterwards. Your working copy and the branch you have checked out are never touched. Only one run per tool per branch at a time. Output streams to the page over the existing event bus.
9. **Each run writes one file:** `reviews/<pr>-<tool>.md`, with front matter (`tool`, `pr`, `branch`, `commit`, `ran`, `status`: pass, warn, fail or error, and `summary`), then the findings as `- path:line message`. The next run of the same tool replaces the file. A `.gitignore` inside `reviews/` keeps the files local by default (question 2 in §10).
10. **The tools.** Each one appears only when it's installed or connected. The Plugins page already says which are.

    | Tool | Where | How |
    |---|---|---|
    | Tests | local | `go test ./...` or `npm test`, from the repo's `type` |
    | Lint | local | golangci-lint or eslint |
    | Semgrep, Gitleaks, Trivy | local | the same rules CI uses; gitleaks with `--redact` |
    | Dependencies | local | govulncheck or `npm audit` |
    | Claude review | local | `claude -p` with `plan.md`, the PR's steps and the diff against its base |
    | SonarQube Cloud | online | scanner in Docker on the worktree; the gate and new issues come from the web API |
    | CodeRabbit | online | the CodeRabbit CLI on the branch, or its review on the draft PR read with `gh` (spike in PR 8) |
    | GitHub checks | read only | CI passed, Security passed, CodeQL passed, from `statusCheckRollup` |

    Codacy, DeepSource and Snyk can be added later in the same way.
11. **Sending code to an online tool asks first, once per repo.** The first CodeRabbit or SonarQube Cloud run on a repo shows "This sends the branch's code to <tool>" and needs a click. The answer is kept in settings. Tool tokens (SonarQube Cloud, CodeRabbit) live in the OS keyring as connections, are never logged and never reach Claude or the connector.
12. **Claude edits the folder with its own file tools. The connector stays read-only.** New connector tools: `list_features`, `get_feature` (the YAML plus the live state), `get_review` (one `reviews/` file) and `validate_feature_yaml`, behind a new **Features** switch on the Claude access page. Starting a review run from Claude is left for the "Claude proposes, you approve" work (connector plan §7). For now you press Run.
13. **Comment and review text is data.** Review comments and tool findings can contain anything. They are shown as plain text, and when the connector hands them to Claude they are marked as untrusted data, not instructions.
14. **`feature.yaml` has a JSON Schema** (`internal/workspace/schemas/feature.schema.json`), served at `GET /schema/feature`. It is checked by `devdeck feature check` and `validate_feature_yaml`, so Claude can validate after each edit. A broken file shows on the page as problems on their line, as the workspace editor does.
15. **The page replaces the "Work items" placeholder in the sidebar** with **Features** (Phase 10). Each feature is listed under it.

## 4. The files

### `feature.yaml`

```yaml
# dev-plans/2026-11-03-blob-archive/feature.yaml
feature: acme-blob-archive          # feature branch, cut from base in each repo
title: Move finished-run data to object storage
base: dev
budget: { files: 10, lines: 500 }   # warn above these
repos: [demo-api, demo-worker, demo-web]
prs:
  - id: a1
    repo: demo-api
    slug: blob-put                  # branch: acme-blob-archive-a1-blob-put
    title: Transfer bucket and blob.put
    steps:
      - { title: Config for the transfer bucket, layer: config, status: done, commit: 9c1e4a2 }
      - { title: blob.put handler and tests, layer: handler, status: doing }
  - id: w1
    repo: demo-worker
    slug: schema
    title: Archive columns and model fields
    steps:
      - { title: 012_archive.sql, layer: db, status: todo }
      - { title: Model fields, layer: model, status: todo }
  - id: w9
    repo: demo-worker
    slug: drop-old-columns
    title: Drop the old columns
    after: [w5, w6]                 # merged first
    steps:
      - { title: 020_drop_old.sql, layer: db, status: todo }
```

### Layers in `workspace.yaml`

```yaml
features_dir: dev-plans
repos:
  - id: demo-worker
    path: demo-worker
    layers:
      - { id: db, name: DB / migrations, paths: ["migrations/**"] }
      - { id: model, name: Model / DTO, paths: ["internal/**/model.go", "internal/**/dto.go"] }
      - { id: repo, name: Repo, paths: ["internal/**/repository*.go"] }
      - { id: service, name: Service, paths: ["internal/**/service*.go"] }
      - { id: handler, name: Handlers, paths: ["internal/api/**"] }
```

### The folder

```
dev-plans/2026-11-03-blob-archive/
  plan.md          written with you before coding
  feature.yaml     Claude keeps it current
  changes.md       Claude adds an entry per commit: what changed and why
  reviews/         one file per tool per PR, written by devdeck
    .gitignore
    a1-coderabbit.md
    a1-sonar.md
    a1-claude.md
```

## 5. The page

The owner reviewed a mockup in this session. It is kept privately because it uses real work data. The parts:

- **Sidebar:** Features, with each feature under it (name, repo count, merged/total) and **+ New feature**.
- **Header:** title, `feature → base`, repo and PR counts, when `feature.yaml` last changed, and the folder with its files (`plan.md`, `feature.yaml`, `changes.md`, `reviews/`). Buttons: **Review all changed branches** and **Next for Claude** (copies a prompt naming the next PR to pick up).
- **Overview tab:**
  - **Progress:** a strip with one segment per PR, and counts by state.
  - **Next up** (decision 6).
  - **Per repo, a grid:** rows are PRs, columns are that repo's layers, and a square shows the PR touches that layer, coloured by its state. The row also shows state, size, steps done and a dot per tool.
  - **Selected PR detail:**
    - where the PR is (Planned → Coding → Draft → Review → Approved → Merged), its branch, base, repo and layers, and the next action;
    - **Code review on this branch:** one row per tool with its last result, a link to its `reviews/` file, and **Run** or **Re-run**, plus **Run all**;
    - GitHub checks and the review summary with **Open on GitHub ↗**;
    - the steps with commit ids and layers;
    - size against the budget.
- **Reviews and checks tab:** every PR against every tool, and the connected tools.
- **Activity tab:** newest first, each line naming its source. The sources are commits on the branches, `changes.md` entries, `reviews/` runs, and PR reviews and merges from `gh`.
- **Files tab:** the folder's files, read-only (Claude edits them; you edit them in VS Code).
- **Terminal:** the same overview from `devdeck feature status <feature>`.

Paper look, tokens only, flat, Geist, light and dark: the same rules as every page.

## 6. Server pieces

| Piece | Where |
|---|---|
| `features_dir`, repo `layers` in the workspace types and schema | `internal/workspace/types.go`, `load.go`, `schemas/workspace.schema.json` |
| `feature.yaml` types, load, validate, derive branch, base and layers | `internal/feature/` (new) |
| Live state: local git facts, `gh pr list` per repo and account, state and next-up rules | `internal/feature/state.go`, using `internal/gitx` |
| Review runner: worktree, tool adapters, result files, one run at a time, events | `internal/review/` (new) |
| SonarQube Cloud and CodeRabbit connections (keyring) | `internal/secrets`, the Connections page |
| API: `GET /features`, `GET /features/:id`, `GET /features/:id/files/*`, `POST /features` (create), `POST /features/:id/prs/:pr/reviews` `{tool}`, `GET /features/:id/reviews/runs` | `internal/api/features.go` |
| Connector: `list_features`, `get_feature`, `get_review`, `validate_feature_yaml`; Features switch | `internal/mcp/features.go`, connector allow-list |
| CLI: `devdeck feature list`, `devdeck feature status <id>`, `devdeck feature check <file>`, `devdeck review <feature> <pr> --tool <t>` | `internal/cli/feature.go` |

All new fields are optional. A workspace without `features_dir` or `layers` works as today.

## 7. Security

- Nothing new listens. The routes sit under `/api/v1` behind the existing Host and Origin check.
- Review runs only read the branch, in a worktree. Nothing is committed or pushed. Creating the feature branches (PR 9) shows the exact `git` commands and asks first, as Repositories does.
- Online tools: a one-time confirmation per repo (decision 11). Tokens live in the keyring.
- Secrets: gitleaks runs with `--redact`. The Claude review leaves `.env*` and files matching the gitleaks rules out of the diff. `reviews/` files and connector answers never contain token values.
- Review text is shown as text and marked as untrusted when it goes to Claude (decision 13).
- Tests use temporary git repos, a fake `gh` runner and fake tool outputs. No real tokens, no network.

## 8. What stays on GitHub

Writing and replying to review comments, resolving threads, approving, the merge button (rulesets and required checks guard it), full Actions logs, CodeQL alerts and repo settings. devdeck links to each one with **Open on GitHub ↗**.

## 9. PRs, in order

Each PR builds and passes tests on its own. The server PRs come first, so the page always has a real API to call. They can be combined if the owner prefers one PR per area.

| PR | What | About |
|---|---|---|
| 0 | **Spike, no code merged:** check that CodeRabbit (CLI on a branch, or review on a draft PR) and SonarQube Cloud (branch analysis) work on the free plans for a private repo. Write the answer in this plan. | notes |
| 1 | `feature.yaml` format: schema, types, load and validate, derived branch, base and layers; `features_dir` and repo `layers` in `workspace.yaml`; `devdeck feature check`; `docs/features.md` (the file format) | ~9 files |
| 2 | Live state: local git facts, `gh` per repo and account, states, next up; `GET /features`, `GET /features/:id`, `GET /features/:id/files/*` | ~7 files |
| 3 | Features page: sidebar entry, header, Progress, Next up, the per-repo layer grid, PR detail without review buttons | ~9 files |
| 4 | Files, Activity and Terminal tabs; `devdeck feature list` and `devdeck feature status` | ~7 files |
| 5 | Review runner with the local tools (tests, lint, semgrep, gitleaks, trivy, dependencies): worktree, result files, events, `POST …/reviews` | ~9 files |
| 6 | Review buttons on the PR, **Run all**, **Review all changed branches**, the Reviews and checks tab | ~6 files |
| 7 | Claude review (`claude -p` with plan, steps and diff) | ~5 files |
| 8 | SonarQube Cloud: connection, scanner in Docker, gate and new issues, the one-time confirmation | ~8 files |
| 9 | CodeRabbit, the way PR 0 found works | ~6 files |
| 10 | New feature: form, folder and `feature.yaml` skeleton, feature branches with commands shown and confirmed, **Next for Claude** prompt, connector prompt `plan-a-feature` | ~8 files |
| 11 | Connector tools and the Features switch; changed files mapped to layers, with a warning when they don't match the steps | ~8 files |

Later, not in this plan: notifications (changes requested, CI failed, ready to merge) once Phase 5 exists; a restack helper (show and run `git rebase --update-refs` with confirmation); Claude starting a review run as a proposal; Codacy, DeepSource, Snyk.

## 10. Questions for the owner

1. **Where should feature folders live** for the work workspace: `dev-plans` at the workspace root (not in any repo), or inside the private config repo? Recommendation: the private config repo, so the folders are versioned and stay out of the work repos.
2. **Commit `reviews/` or keep it local?** Recommendation: local by default (the `.gitignore` in decision 9). The results are cheap to re-run and can quote code.
3. **Is sending work code to CodeRabbit and SonarQube Cloud allowed?** If not, those rows stay hidden and the local tools and the Claude review still work.
4. **PR size:** the table above is small slices. Merge some (for example 1 + 2, 3 + 4, 5 + 6) if you'd rather review fewer PRs.

## 11. Done when

From the Features page you can open a feature that spans several repos and one that uses one repo. You can see every PR with its state and its layers, see what is next, and run each review tool on any branch with one click, getting its result in `reviews/`. You can also follow what Claude did from `feature.yaml` and `changes.md`, while Claude reads the same state through the connector.
