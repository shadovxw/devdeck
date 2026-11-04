# Features: track every PR of a feature, and review each branch with free tools

> 2026-11-03 · owner: Vrishank Warrier · builds on [`2026-10-23-git-operations/`](../2026-10-23-git-operations/plan.md) (git and `gh` per account), [`2026-10-30-claude-connector/`](../2026-10-30-claude-connector/plan.md) (read-only connector) and [`12-sonar-coverage.md`](../12-sonar-coverage.md) · covers plan §4.4.4 (PR list and checks) and most of Phase 10 (work items, Claude, PRs) · status: **PRs 1 to 3 built (2026-11-04), see [`changes.md`](changes.md); PRs 4 to 9 not started. Spike (PR 0) done, see §11. Decided: CodeRabbit by button only (§12), a private plans repo with a branch per plan and committed reviews (§13). All §10 questions are answered; PRs combined to 10 (§9).**

## 1. The problem

A feature is planned as many small stacked PRs, often across several repos: each PR is 300 to 500 lines, has a few commits (one per step) and targets the PR below it in the same repo. With 10 or more PRs it is hard to see:

- which PRs are merged, in review, waiting on changes, still being coded or not started;
- which layer of each repo (DB, model and DTO, repo, service, handlers…) a PR changes, and which layers are done;
- whether a branch has been through the code-review tools (CodeRabbit, SonarQube Cloud, a Claude review, the local scanners) before it is raised;
- what Claude did last, and what is next.

GitHub shows one PR at a time. devdeck should show the whole feature on one screen, run the review tools on any branch with one click, and keep everything Claude does in the feature's own folder.

Not goals: a GitHub clone. Writing and replying to review comments, approving and merging stay on GitHub (§8). devdeck never pushes for Claude and never merges.

## 2. How it works, in one paragraph

You create a feature in devdeck. That makes a branch `plan/<name>` in your **plans repo** (a private git repo, §13) with a `feature.yaml` at its root. Claude writes `plan.md`, fills `feature.yaml` with the PRs and their steps, ticks each step as it commits, and adds an entry to `changes.md` for each commit. devdeck reads that folder, adds the live state from local git and GitHub (`gh`), and shows it all on the Features page. On any PR you press **Run** next to a tool. devdeck runs it on that branch and writes the result to `reviews/<pr>-<tool>.md` on the same branch. A **Sync from GitHub** step saves each PR's state and review threads to `github/<repo>-<pr>.md` (§13). Claude reads those files to fix what's open, and every AI tool can read them without devdeck or `gh`.

## 3. Decisions

1. **One plan branch per feature, and the branch is the source of truth.** A branch `plan/<name>` in the plans repo is a feature when its root has `feature.yaml`. Other branches are ignored. Live state (PR status, reviews, checks) is **not** written into `feature.yaml`: the page reads it live, and Sync from GitHub keeps a dated copy in `github/` (§13).
2. **Where the plans live (decided 2026-11-03):** a separate private git repo, set in `workspace.yaml` as `plans_repo: { path, worktrees }`. Each plan is a branch `plan/<name>`, checked out as its own `git worktree` under `worktrees`, so several plans can be open at once and each Claude session has its own folder. A feature that spans several repos still has one plan branch.
3. **A feature has one or more repos.** `feature.yaml` lists repo ids from `workspace.yaml`. A one-repo feature is just a list of one.
4. **Layers belong to the repo, not to the feature.** `workspace.yaml` gets an optional `layers` list per repo: `id`, `name` and `paths` (globs). Each step in `feature.yaml` names one or more layer ids, and a PR's layers are the union of its steps' layers. Later (§9, PR 8) devdeck also maps a branch's changed files to layers with `paths` and flags a PR that touches a layer none of its steps names.
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
   | Closed | PR closed without merging (added in PR 1) |

   Changes requested wins over Draft, and Draft over Approved (PR 1).

   The **Next up** list is ordered: changes requested, approved (merge it), draft (finish the reviews), coding, in review. Each item says who acts: Claude, you or the reviewers.
7. **GitHub through `gh`, with the account the repo's rule picks** (the same as the Repositories page). One call per repo: `gh pr list --state all --search "head:<feature>-" --json number,headRefName,baseRefName,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,url,mergedAt,reviews`. The result is cached for 60 s and refreshed while the page is open, or on demand. Size, files and commits come from local git (`git diff --shortstat base...branch`, `git log base..branch`), so they work before a PR exists.
8. **Review tools run on a branch, in a separate git worktree.** devdeck checks the branch out with `git worktree add` into its data folder, runs the tool there and removes the worktree afterwards. Your working copy and the branch you have checked out are never touched. Only one run per tool per branch at a time. Output streams to the page over the existing event bus.
9. **Each run writes one file:** `reviews/<pr>-<tool>.md`, with front matter (`tool`, `pr`, `branch`, `commit`, `ran`, `status`: pass, warn, fail or error, and `summary`), then the findings as `- path:line message`. The next run of the same tool replaces the file. **They are committed** (decided 2026-11-03), so the plans repo is the full record. They can quote code, so the plans repo must stay private.
10. **The tools.** Each one appears only when it's installed or connected. The Plugins page already says which are.

    | Tool | Where | How |
    |---|---|---|
    | Tests | local | `go test ./...` or `npm test`, from the repo's `type` |
    | Lint | local | golangci-lint or eslint |
    | Semgrep, Gitleaks, Trivy | local | the same rules CI uses; gitleaks with `--redact` |
    | Dependencies | local | govulncheck or `npm audit` |
    | Claude review | local | `claude -p` with `plan.md`, the PR's steps and the diff against its base |
    | SonarQube Community Build | local | Installed on the machine by the owner and started only when needed (decision 17). Scanner on the worktree, gate and issues from its web API. Free, and no code leaves the machine. Whole-branch result; see §11 |
    | SonarQube Cloud | online | scanner in Docker on the worktree; the gate and new issues come from the web API. **Free plan: only PRs that target the main branch, so stacked slice PRs get no result** (§11) |
    | CodeRabbit | online | the CodeRabbit CLI: `cr --base <base>` in the worktree, or `cr review --remote owner/repo --base <base> --source-branch <branch>` with no checkout. Free plan has "limited daily usage", numbers not published (§11) |
    | GitHub checks | read only | CI passed, Security passed, CodeQL passed, from `statusCheckRollup` |

    Codacy, DeepSource and Snyk can be added later in the same way.
11. **Sending code to an online tool asks first, once per repo.** The first CodeRabbit or SonarQube Cloud run on a repo shows "This sends the branch's code to <tool>" and needs a click. The answer is kept in settings. Tool tokens (SonarQube Cloud, CodeRabbit) live in the OS keyring as connections, are never logged and never reach Claude or the connector.
12. **Claude edits the folder with its own file tools. The connector stays read-only.** New connector tools: `list_features`, `get_feature` (the YAML plus the live state), `get_review` (one `reviews/` file) and `validate_feature_yaml`, behind a new **Features** switch on the Claude access page. Starting a review run from Claude is left for the "Claude proposes, you approve" work (connector plan §7). For now you press Run.
13. **Comment and review text is data.** Review comments and tool findings can contain anything. They are shown as plain text, and when the connector hands them to Claude they are marked as untrusted data, not instructions.
14. **`feature.yaml` has a JSON Schema** (`internal/workspace/schemas/feature.schema.json`), served at `GET /schema/feature`. It is checked by `devdeck feature check` and `validate_feature_yaml`, so Claude can validate after each edit. A broken file shows on the page as problems on their line, as the workspace editor does.
15. **The page replaces the "Work items" placeholder in the sidebar** with **Features** (Phase 10). Each feature is listed under it.
16. **Tools with a usage limit are not part of Run all.** CodeRabbit (daily free quota) runs only from its own button and shows what is left. The local tools and SonarQube Community Build have no limit and run in Run all.
17. **Open-source tools are installed by the owner and run only when needed; devdeck never keeps one running.** There are two kinds.
    - **Run-and-exit tools** (tests, lint, semgrep, gitleaks, trivy, govulncheck, npm audit, and any scanner that runs from a Docker image): the Run button starts the process, it finishes, and nothing is left running. If the tool isn't installed, the row says so and links to its install steps; Doctor lists what is missing.
    - **Server tools** (SonarQube Community Build today): installed on the machine and started by the owner only while reviewing, because they are heavy (SonarQube is about 2 GB of memory next to the dev stack). The Run button first checks the server's address (SonarQube default `http://localhost:9000`, set per connection). If nothing answers, the row says "SonarQube isn't running" and shows the start command, instead of failing. Run all skips a server that is down; it isn't counted as a failed check. Tokens go in the keyring.
    - **Start and Stop buttons are optional and come after the basics:** they run the owner's own command, kept in the connection and shown before it runs. After a review the owner stops the server (or presses Stop). devdeck can show "SonarQube is still running" as a reminder on the Features page, and does not stop it unasked.
    - **Another open-source tool is added the same way:** a small adapter that says how to check it is installed, how to run it on a worktree, and how to read its result into `reviews/`. Which of the two kinds it is decides whether it needs the "is it running?" check.

## 4. The files

### `feature.yaml`

```yaml
# feature.yaml at the root of the branch plan/blob-archive
# Put commit ids in quotes ("9c1e4a2"): YAML reads an all-digit id as a number.
version: 1
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
plans_repo:
  path: ../acme-plans            # a private git repo; each plan is a branch plan/<name>
  worktrees: ../acme-plans-wt    # one worktree per plan
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
plans repo, branch plan/blob-archive (this is the root of the branch)
  plan.md          written with you before coding
  feature.yaml     Claude keeps it current
  changes.md       Claude adds an entry per commit: what changed and why
  testing.md       your own testing notes: what you tried, what you saw
  reviews/         one file per tool per PR, written by devdeck
    a1-coderabbit.md
    a1-sonar.md
    a1-claude.md
  github/          one file per PR, written by Sync from GitHub
    demo-api-212.md
    demo-worker-145.md
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
| `plans_repo`, repo `layers` in the workspace types and schema | `internal/workspace/types.go`, `load.go`, `schemas/workspace.schema.json` |
| `feature.yaml` types, load, validate, derive branch, base and layers | `internal/feature/` (new) |
| Live state: local git facts, `gh pr list` per repo and account, state and next-up rules | `internal/feature/state.go`, using `internal/gitx` |
| Review runner: worktree, tool adapters, result files, one run at a time, events | `internal/review/` (new) |
| SonarQube Cloud and CodeRabbit connections (keyring) | `internal/secrets`, the Connections page |
| API: `GET /features`, `GET /features/:workspace/:name`, `GET /features/:workspace/:name/files/*` (built in PR 1); `POST /features` (create), `POST /features/:workspace/:name/prs/:pr/reviews` `{tool}`, `GET /features/:workspace/:name/reviews/runs` (later) | `internal/api/features.go` |
| Connector: `list_features`, `get_feature`, `get_review`, `validate_feature_yaml`; Features switch | `internal/mcp/features.go`, connector allow-list |
| CLI: `devdeck feature list`, `devdeck feature status <id>`, `devdeck feature check <file>`, `devdeck review <feature> <pr> --tool <t>` | `internal/cli/feature.go` |

All new fields are optional. A workspace without `plans_repo` or `layers` works as today.

## 7. Security

- Nothing new listens. The routes sit under `/api/v1` behind the existing Host and Origin check.
- Review runs only read the branch, in a worktree. Nothing is committed or pushed. Creating the plan worktree and the feature branches (PR 7) shows the exact `git` commands and asks first, as Repositories does.
- Online tools: a one-time confirmation per repo (decision 11). Tokens live in the keyring.
- Secrets: gitleaks runs with `--redact`. The Claude review leaves `.env*` and files matching the gitleaks rules out of the diff. `reviews/` files and connector answers never contain token values.
- Review text is shown as text and marked as untrusted when it goes to Claude (decision 13).
- Tests use temporary git repos, a fake `gh` runner and fake tool outputs. No real tokens, no network.

## 8. What stays on GitHub

Writing and replying to review comments, resolving threads, approving, the merge button (rulesets and required checks guard it), full Actions logs, CodeQL alerts and repo settings. devdeck links to each one with **Open on GitHub ↗**.

## 9. PRs, in order

Each PR builds and passes tests on its own. Decided 2026-11-03: **some small slices are combined** (the owner prefers fewer, bigger PRs to review), giving 10 PRs. Each is still one coherent slice, and the server part of each comes first so the page always has a real API to call. Sizes are estimates; if one passes about 15 files, it is split again.

| PR | What | About |
|---|---|---|
| 0 | **Spike: done 2026-11-03, result in §11.** CodeRabbit CLI works on a branch against a base; SonarQube Cloud's free plan does not cover stacked PRs. | notes |
| 1 | **Built.** **The format and the live state.** `feature.yaml`: schema, types, load and validate, derived branch, base and layers. `plans_repo` and repo `layers` in `workspace.yaml`. List `plan/*` branches and their worktrees. Local git facts, `gh` per repo and account, states, next up. `GET /features`, `GET /features/:id`, `GET /features/:id/files/*`. `devdeck feature check`. `docs/features.md` | ~15 files |
| 2 | **Built.** **The Features page.** Sidebar entry, header, Progress, Next up, the per-repo layer grid, PR detail (no review buttons yet), and the Files, Activity and Terminal tabs. `devdeck feature list` and `devdeck feature status` | ~14 files |
| 3 | **Built.** **Review runner with the local tools and the buttons.** Tests, lint, semgrep, gitleaks, trivy, dependencies: worktree, result files, events, `POST …/reviews`. Review buttons on the PR, **Run all**, **Review all changed branches**, the Reviews and checks tab | ~15 files |
| 4 | Claude review (`claude -p` with plan, steps and diff) | ~5 files |
| 5 | SonarQube: **the owner's local Community Build first** (connection with address and token, "is it running?" check in Doctor and on the Run button, scanner on the worktree, gate and issues from its API, no auto-start); SonarQube Cloud as an optional connection for PRs that target the main branch, with the one-time confirmation | ~8 files |
| 6 | CodeRabbit CLI (`cr`): install check in Doctor, sign-in, run with `--base`, parse the result into `reviews/`, show the remaining free quota | ~6 files |
| 7 | New feature: form, plan branch and `feature.yaml` skeleton, worktree and feature branches with commands shown and confirmed, **Next for Claude** prompt, connector prompt `plan-a-feature` | ~8 files |
| 8 | Connector tools and the Features switch; changed files mapped to layers, with a warning when they don't match the steps | ~8 files |
| 9 | **GitHub snapshots:** Sync from GitHub writes `github/<repo>-<pr>.md` (state, description, reviews, threads with `file:line`, checks), only when something changed, with a final snapshot at merge; `devdeck feature sync`; shows "N files changed in the plans repo" with the commit commands. Can move earlier if the owner wants the record from the start. | ~7 files |

PRs 1 to 3 are the ones that grew from combining. If reviewing them is still too much, the split points are: 1 into format and live state; 2 into page and extra tabs; 3 into runner and buttons.

Later, not in this plan: notifications (changes requested, CI failed, ready to merge) once Phase 5 exists; a restack helper (show and run `git rebase --update-refs` with confirmation); Claude starting a review run as a proposal; Codacy, DeepSource, Snyk.

## 10. Questions for the owner

1. ~~Where should feature folders live?~~ **Decided 2026-11-03:** a separate private plans repo, one `plan/<name>` branch per plan, one worktree each (§13). Confirm the worktree part: the alternative was one folder per plan on `main`.
2. ~~Commit `reviews/` or keep it local?~~ **Decided 2026-11-03: committed.** The plans repo is the record of all development work, so it must stay private.
3. ~~Is sending work code to CodeRabbit and SonarQube Cloud allowed?~~ **Decided 2026-11-03: allowed.** Both stay in the plan. The one-time "this sends the branch's code to <tool>" confirmation per repo (decision 11) still applies. Not yet confirmed: whether the free CodeRabbit CLI sends code to CodeRabbit's servers, to check in PR 6.
4. ~~PR size~~ **Decided 2026-11-03: combine some.** Slices 1 + 2, 3 + 4 and 5 + 6 became PRs 1, 2 and 3 (§9). All four questions are answered.

## 11. Spike result (PR 0, 2026-11-03)

Checked against the vendors' own documentation. Free plans change, so each limit below is re-checked when PR 5 and PR 6 are built.

**CodeRabbit CLI** ([CLI docs](https://docs.coderabbit.ai/cli))
- Works on a branch against a base: `cr --base <branch>`. Without `--base` it uses a saved preference, then the repository's default branch. A repo can have its own default base.
- **No checkout needed:** `cr review --remote owner/repo --base <base> --source-branch <branch>` (CLI 0.7.7 or newer). Needs sign-in.
- Windows is supported natively (PowerShell installer), as well as macOS and Linux. One search result said otherwise; the official page wins, but PR 6 checks it on this machine.
- Free tier: "basic static analysis with limited daily usage". No numbers are published on the CLI page, and one third-party page said "3 per hour", which is unverified. So devdeck shows the quota from `cr usage` and does not promise a number.
- Sign-in: `cr auth login` (browser) or `cr auth login --api-key`. The key goes in the keyring like any token.
- **Effect on the plan:** the CodeRabbit button works on any branch, stacked or not, and doesn't need a PR. Keep "Run all" from spending the daily quota: CodeRabbit is left out of Run all and run on its own button (decision 16).

**SonarQube Cloud free plan** ([subscription plans](https://docs.sonarsource.com/sonarcloud/administering-sonarcloud/managing-subscription/subscription-plans))
- Private repos: up to 50k lines of code for the organization.
- "Only main branch analysis", and pull request analysis only "if the target branch is the main branch".
- **Effect on the plan:** a stacked slice PR targets another slice or the feature branch, so it gets **no usable result** on the free plan. The final feature → `dev` PR gets one only if `dev` is the project's main branch in Sonar (not checked).
- So the first SonarQube tool is **SonarQube Community Build, installed on the machine and started by you when needed**. It's free and no code leaves the machine. The catch, to confirm in PR 5: the Community Build has no branch analysis either, so each run is a whole-branch result (quality gate and all issues), and "new code only" may not be available. devdeck then shows the issues in the files the PR changed, using `git diff base...branch`, instead of the gate's new-code view.
- SonarQube Cloud stays as an optional connection, labelled "only PRs targeting the main branch".

**Other free tools that suit stacked branches** (not part of this plan; can be added later in the same way): Semgrep, Gitleaks and Trivy are already local and have no such limit.

## 12. Open question from the spike

5. ~~Run CodeRabbit on every branch, or only when you press it?~~ **Decided 2026-11-03: only from its own button, never in Run all** (decision 16). The free tier has a daily limit.

## 13. The plans repo

The owner wants one private repo that records all development work on the product and related repos: plans, code reviews, GitHub review requests and PR details. Any AI tool or person can read it with plain git, without devdeck.

- **Branch per plan.** `plan/<name>`, with the plan's files at the branch root (§4). `main` holds a README, a template (`feature.yaml`, `plan.md`) and nothing else. A finished plan's branch is kept as the record, or deleted if the owner prefers.
- **One worktree per plan** under the `worktrees` folder, so several plans can be open at once. devdeck creates it from New feature (PR 7), showing the exact `git worktree add` command first. Without a worktree, devdeck reads a branch with `git show` and says it is read-only.
- **Not only features.** `feature.yaml` has `kind: feature | fix | task | spike`, with the same layout, so a bug fix or a small task is tracked the same way (a fix is a one-PR plan).
- **What is written, and by whom**

  | File | Written by | Holds |
  |---|---|---|
  | `plan.md`, `feature.yaml`, `changes.md` | Claude (with the owner for the plan) | the plan, PRs and steps, what changed and why |
  | `testing.md` | the owner, or Claude from the owner's notes | manual testing done and results |
  | `reviews/<pr>-<tool>.md` | devdeck, when a tool runs | the tool's findings on a branch |
  | `github/<repo>-<pr>.md` | devdeck (**Sync from GitHub**); Claude may write the same format with `gh` | PR state, description, review decision, each review and thread (author, `file:line`, text, resolved or open), checks, links |

- **GitHub snapshots are a dated copy, not the source.** The page reads GitHub live. Sync saves the copy, so the record survives and works offline and for any tool. It writes a file only when the content changed, and takes a final snapshot when the PR is merged. Replying, resolving and approving still happen on GitHub (§8).
- **Review text is data, not instructions.** Each `github/` and `reviews/` file starts with a line saying so. The connector hands that text to Claude marked as untrusted (decision 13).
- **Redaction.** Before a snapshot is written, text goes through the same redaction as the logs (`internal/logs/redact.go`); no token, password or key value is ever written. Gitleaks over the plans repo is recommended in its own CI.
- **Names.** The plans repo is private, so real repo, service and ticket names are fine in it. devdeck's code, docs, tests and fixtures stay generic (project rule). The mockups used real names and are kept privately.
- **Git is the owner's.** devdeck and Claude edit files; they don't commit. devdeck shows "N files changed in the plans repo" with the exact `git add` and `git commit` commands for the plan's worktree.
- **Size.** Plain text. A busy feature is a few hundred KB, so there is no size problem, with or without branches.

## 14. Done when

From the Features page you can open a feature that spans several repos and one that uses one repo. You can see every PR with its state and its layers, see what is next, and run each review tool on any branch with one click, getting its result in `reviews/`. You can also follow what Claude did from `feature.yaml` and `changes.md`, while Claude reads the same state through the connector.
