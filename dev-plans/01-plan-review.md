# devdeck: Plan Review

> 2026-10-17 · reviews [`00-implementation-plan.md`](00-implementation-plan.md) (including the Phase 5.5 notifications section on branch `plan/notification`)
> Three parts: **logical gaps** (things the plan gets wrong or misses), **features to add** (prioritised), and a **business review** (effort, risk, positioning).

---

## Summary

| | |
|---|---|
| **Overall** | The architecture is sound (Go core, static plugins, flows, local-first). The plan is **too big for one person** and has a few real holes in daily-use areas: env/secrets, first-run bootstrap, debugging, and crash recovery. |
| **Biggest risk** | Scope. The phase sizes add up to **~16–28 focused full-time weeks**. Part-time, that's most of a year before M6. |
| **Most urgent** | The GitHub repo is **public**, has **no LICENSE**, and **11 files describe company internals** (Citiuscloud repo names, DB/table names, image tags, eks_deployment layout, a work email). Decide before pushing more (§3.5). |
| **Recommendation** | Re-cut to a slim **MVP (~6–9 focused weeks)**: shell + one 3D hero, one-click stacks, logs, notifications, env manager and port manager. Use it daily for 2 weeks, then re-plan everything after M1. |
| **Features found** | **27** worth adding: 8 must-have, 10 should-have, 9 could-have/later (§2). |

---

## 1. Logical gaps

Ordered by how much they'd hurt daily use.

| # | Gap | Why it matters | Fix (and where) |
|---|---|---|---|
| G1 | **No env/secrets management.** Doctor only checks that `.env` exists. | Most "service won't start" problems are a missing or wrong env var. 2 of 16 infrabot services already lack `.env.local`. | **Env manager**: diff each `.env` against `.env.example` (missing/extra keys), named env profiles per stack (e.g. "frontend → dev API"), secret values injected from the keyring at start. Phase 2. |
| G2 | **No first-run bootstrap or reset.** Stacks assume the databases, Keycloak realm and seed data already exist. | On a new PC (a stated goal) the first `full` start fails. infrabot already has `auth_service_setup/01–03_*.sh` and migration scripts for exactly this. | **Bootstrap tasks** per stack: create DBs → migrations → seed → Keycloak realm setup, run once and recorded. Plus **"Reset environment"** (fresh DBs). Phase 2 (+ Phase 6 for migrations). |
| G3 | **Debugging loses the logs.** Phase 11.2 restarts a service under VS Code's debugger, so its output goes to VS Code's Debug Console and disappears from devdeck. | Logs, error grouping and notifications go blind exactly when you're debugging. | devdeck starts **Delve headless** itself (`dlv exec --headless`) and keeps owning stdout; VS Code **attaches** to it. Phase 11. |
| G4 | **No crash recovery for devdeck itself.** Undefined what happens to running services if devdeck crashes or is closed. | With Job Objects set to kill-on-close, every service dies with devdeck. Docker containers survive, so state goes out of sync. | Decide the policy (recommended: services **keep running**; on restart devdeck **re-adopts** them by PID file, port and container label and reconciles state). Phase 2.3. |
| G5 | **No hot reload for Go.** Build-then-run is planned, but nothing rebuilds on save. | Developers expect save → restart. Without it, people go back to running `go run` in a terminal, and devdeck loses the logs (same as G3). | Opt-in **watch mode** per service (fsnotify → debounce → rebuild → restart), like `air`. Phase 2. |
| G6 | **Three separate event lists.** Notification events (5.5.1), flow triggers (7.3.3) and WS topics (§6) are each defined separately. | They drift, and new features have to be wired three times. | One **versioned event catalog** (`service.crashed`, `image.build.failed`, …) used by WS, notifications, flow triggers and a new Activity timeline. Phase 0.2.3. |
| G7 | **No locking between concurrent actions.** Two flows can build the same image, a migration can run while the service is mid-request, two stacks can claim the same port. | Flaky, confusing failures that look like bugs in devdeck. | Resource locks (repo, image, DB, port) in the flow engine and supervisor; the UI shows "waiting for lock: infrabot_catalog_db". Phase 7.3 + 2.3. |
| G8 | **Solo-parallel scheduling.** Phase 1 (XL) is planned "alongside Phases 2–3", but it's one developer. | M1 slips silently, or the UI work gets dropped. | Cut Phase 1 into **1a (tokens, shell, kit basics, one 3D hero: 1–1.5 weeks)** before Phase 2, and **1b (signature visuals)** spread into each page's phase. |
| G9 | **No versioning for devdeck's own data.** Workspace YAML has no `apiVersion`, and SQLite migrations exist but upgrade and rollback of devdeck itself aren't planned. | The first breaking change to a stack file breaks every workspace. | `apiVersion: devdeck/v1` in every YAML file, plus a migrate-on-load step with a backup. Phase 0.5. |
| G10 | **Tool versions aren't pinned per workspace.** Doctor installs "latest" via winget. | "Works on my PC" across the two PCs you'll use. Scanner output changes between versions (see the Trivy incident). | Pin tool versions in the workspace (mise or a `tools:` block) and have Doctor install those exact versions. Phase 2.1. |
| G11 | **Processes started outside devdeck are invisible.** For example, `go run` in a VS Code terminal. | Port conflicts with no explanation; "service down" alerts while it's actually up. | **Port manager**: who owns each port (PID/container/devdeck service) with "stop/adopt". Phase 2. |
| G12 | **Every 3D view needs a 2D equivalent.** §7.5 covers reduced motion and performance mode, but not accessibility or performance mode for *content*. | In performance mode the Home constellation would just vanish, taking its information with it. | Rule: every 3D or animated visual has a 2D/table equivalent that the toggle switches to. In the design-system plan. |
| G13 | **No limits on Claude usage.** Flows and triggers can call `claude -p` automatically. | A trigger loop can burn through your Claude usage; logs sent to Claude may contain secrets. | Claude steps are **manual by default**, with a per-day cap and a redaction pass on every prompt. Phase 10. |
| G14 | **Work items vs branches made by hand.** Only devdeck-created branches are linked to work items. | You create branches yourself (you run git manually), so work items would never find them. | Link by branch-name convention (`feature/<work-item>`) and an "adopt this branch" action. Phase 10.1. |
| G15 | **Git actions vs your workflow.** devdeck plans buttons that pull, push and commit, but you prefer to run git yourself. | Mistrust of the buttons, or surprises. | Every git action shows the **exact command** first, with **Copy** (you run it) and **Run** (devdeck runs it). Default: Copy. Phase 4. |
| G16 | **Releases across repos are missing.** Branch rulesets now force PRs for dev → uat → main, and infrabot has 16 repos. | Promoting a release means opening up to 32 PRs by hand. | **Promotion / release train**: open dev→uat (or uat→main) PRs for every changed repo, with a combined changelog, then tag. Phase 10.3. |
| G17 | **Acceptance criteria skip UI quality.** "Done when" is functional only. | The "amazing UI" goal has no gate, so polish becomes the thing that's always cut. | Every phase's "done when" adds: within §7.5 perf budget, keyboard reachable, 2D fallback works, light + dark checked. |
| G18 | **Effort notes are stale.** 0.1.1 still says `git init` and "work account". | Minor. The repo already exists on `shadovxw` (personal) with CI and rulesets. | Update 0.1 to "done: repo, CI workflows, rulesets". |

---

## 2. Features to add (27)

**Value:** H/M/L for daily use. **Size:** S ≈ 1–2 days, M ≈ 3–5 days, L ≈ 1–2 weeks.

### 2.1 Must-have (fold into the MVP, 8)

| # | Feature | What it does | Value | Size | Phase |
|---|---|---|---|---|---|
| F1 | **Env manager** | `.env` vs `.env.example` diff, env profiles per stack, secrets from the keyring (G1) | H | M | 2 |
| F2 | **Bootstrap & reset** | One-time setup steps per stack, and "fresh environment" (G2) | H | M | 2 |
| F3 | **Port manager** | Who uses which port; stop or adopt (G11) | H | S | 2 |
| F4 | **Watch mode** | Rebuild/restart Go services on save (G5) | H | S | 2 |
| F5 | **Activity timeline** | One feed of everything: crashes, builds, migrations, git, flows. Answers "what changed right before it broke?" (G6) | H | M | 3 |
| F6 | **Follow a request** | Group log lines from all services by `request_id`/`trace_id` (zerolog fields) to follow one API call across services | H | S | 3 |
| F7 | **Keycloak token helper** | One click: a JWT for a test user/tenant, copied to the clipboard or used by the HTTP runner (infrabot is Keycloak-per-tenant) | H | S | 4 |
| F8 | **DB snapshots** | `pg_dump` "save point" before a risky migration, then restore in one click | H | S | 6 |

### 2.2 Should-have (10)

| # | Feature | What it does | Value | Size | Phase |
|---|---|---|---|---|---|
| F9 | **HTTP request runner** | Runs `.http` files (VS Code REST Client format, kept in git) against local services, with the token from F7; "replay request from a log line" | H | M | 4 |
| F10 | **Go profiling** | One-click pprof CPU/heap profile of a running service, shown as a flamegraph | M | M | 5 |
| F11 | **Test results** | `go test` / vitest results, flaky-test detection, coverage (also fed to SonarQube) | M | M | 8 |
| F12 | **Release train** | Multi-repo promotion PRs, combined changelog, tags (G16) | H | M | 10 |
| F13 | **GitHub CI board** | Actions status for every repo in the workspace in one view, plus Dependabot/code-scanning alerts across repos | M | S | 4 |
| F14 | **Service dependency map** | Built from compose files, env URLs and shared libraries (`infrabot-utils`): "changing this repo affects these services" | M | M | 7 |
| F15 | **SBOM + license scan** | Per image (Trivy/Syft): what's inside, which licenses. Often asked for in enterprise deals. | M | S | 9 |
| F16 | **Natural-language log search** | "errors from catalog about postgres in the last hour" turned into a filter (Claude, opt-in) | M | S | 10 |
| F17 | **Work report** | Daily/weekly summary of commits, PRs, work items and builds, ready for stand-ups or a manager update | M | S | 10 |
| F18 | **Command preview mode** | Every git/docker/db action shows the exact command with Copy/Run (G15) | H | S | 4 |

### 2.3 Could-have and later (9)

| # | Feature | What it does | Value | Size |
|---|---|---|---|---|
| F19 | NATS inspector | Live tap on subjects (infrabot uses NATS) as a workspace plugin | M | M |
| F20 | Object-store browser | S3/Garage buckets used by infrabot services | L | S |
| F21 | OpenBao/Vault viewer | Read dev secrets the services use | L | S |
| F22 | Mock external services | WireMock-style stubs for osTicket/CMDB while developing | M | M |
| F23 | Seed data manager | Named fixture sets per workspace, loaded via saved scripts | M | S |
| F24 | Runbooks | Markdown notes per service/workspace, linked from service pages | L | S |
| F25 | Custom quick actions | User-defined buttons and palette commands (the `script` plugin, surfaced in the UI) | M | S |
| F26 | Time per work item | Automatic from branch/commit activity | L | S |
| F27 | Linux/macOS support | Abstract Job Objects and keyring behind OS interfaces now, so teammates can run it later | M | L |

**MVP additions**: F1–F4 (+ F5/F6 at small scope) add about **2–3 focused weeks** to M1. They make M1 work on a fresh PC, not just this one.

---

## 3. Business review

### 3.1 Effort, honestly

| Size | Phases | Weeks (focused, full-time) |
|---|---|---|
| XL ×4 | 1, 6, 7, 10 | 8–12 |
| L ×6 | 0, 2, 3, 4, 5 (with notifications), 8 | 6–12 |
| M ×4 | 9, 11, 12, 13 | 2.5–4 |
| **Total** | | **≈ 16–28 weeks** |

Next to infrabot work (say ~10 hours a week), that's **well over a year** for the full plan. That isn't a reason to stop. It's a reason to **ship M1 fast and let real use decide the rest**.

### 3.2 Value (assumptions, to check against your own week)

| Pain today | Assumed time | devdeck feature |
|---|---|---|
| Starting 7–9 repos + Docker every morning, fixing what didn't start | 15–25 min/day | Stacks, Doctor, env manager, bootstrap |
| Finding which service logged the error | 10–30 min/day | Logs, errors panel, follow-a-request |
| Rework after CI/review catches issues | 1–2 h/week | pre-PR flow, findings |
| Manual image build/tag/push | 15 min per release | Images & tags |

If those numbers are right, that's **~3–5 hours a week** for you, and more if teammates adopt it. **Measure it**: log the start-to-ready time and errors caught pre-PR from M1 on, so the value is shown with data.

### 3.3 Competition and what's different

| Existing tool | Covers | Doesn't cover |
|---|---|---|
| Tilt / process-compose | starting services, logs | git accounts, DBs, scans, work items, Windows-first polish |
| Docker Desktop (+ extensions) | containers | `go run`/npm processes, git, pipelines |
| Backstage | service catalog, portal | local runtime; very heavy to run |
| Dozzle / Portainer | container logs/management | non-container services, everything else |
| DBeaver / pgAdmin | databases | the rest of the workflow |
| GitHub Desktop / VS Code git | git | multi-account rules, multi-repo views |

**devdeck's difference**: one **workspace-aware** cockpit connecting runtime, logs, DB, git accounts, pre-PR checks and Claude, built around **how infrabot actually works**, on Windows. Nobody sells exactly that, which is also the risk: it's a niche until it's generic.

### 3.4 Positioning options (decide at M1)

| Option | Needs beyond the plan | Fit |
|---|---|---|
| **A. Personal tool** | nothing | Lowest risk; matches the plan as written |
| **B. Team tool at Citiuscloud** | remote environments, auth (Keycloak), Linux/macOS (F27), company-owned repo | Highest business value if teammates have the same pain |
| **C. Open source** | generic examples, no company data, docs, a license, issue triage | Portfolio and community value, plus maintenance load |
| **D. Commercial product** | B + C + support, licensing, onboarding | Only after B proves value |

**Recommendation**: build for **A**, keep the core generic so **B** stays possible, and decide **C** consciously (next section).

> **Update 2026-10-17 (Vrishank):** the direction is now **observability + control for infrabot first, then for any SaaS product**. That points toward **B → C/D**. The scaling plan, with deep plugins for infrabot's stack and open standards (OpenTelemetry, Prometheus) for everything else, is in [`03-plugin-catalog.md`](03-plugin-catalog.md). This raises the importance of §3.5 (IP and the public repo) and of keeping company-specific config out of the core.

### 3.5 Ownership, IP and the public repo

- **Repo is public with no LICENSE.** That legally means "all rights reserved", but the code is visible to everyone. Choose deliberately: **private**, or public with a license (MIT/Apache-2.0).
- **Company internals are public.** Infrabot repo names, the `citiuscloud-services` org, DB and table names, image tags, the `eks_deployment` layout and a work email appear in **11 files** (`ui-mockup/*`, `dev-plans/00-…`). None are secrets, but together they map a company product's architecture. **Check your employer's policy.** The safe options are to make the repo **private**, or to move infrabot-specific content into a **private `devdeck-workspaces` repo** and use generic examples in the public one (this also settles open question 2).
- **Trade-off**: on a free personal account, a **private** repo loses free branch rulesets/protection enforcement and CodeQL code scanning (they need GitHub Pro or a public repo).
- **IP**: if devdeck is built partly on work time, or for work use, it may belong to the employer, depending on your contract. Clarify before options C or D.
- **Name**: check "devdeck" for existing products and trademarks before going public as a product.

### 3.6 Success metrics (start measuring at M1)

| Metric | Target |
|---|---|
| Cold start → full stack ready | under 2 min, without touching a terminal |
| Time to find an error's source | under 30 s (click from the error to `file:line`) |
| PRs passing CI on the first push | above 90% (pre-PR flow catches the rest) |
| devdeck's own idle CPU | 3% or less (§7.5) |
| Days per week you actually use it | 5/5 by two weeks after M1 |

---

## 4. Recommended re-sequencing

```
MVP (≈ 6–9 focused weeks)
  P0  Foundations (+ event catalog G6, apiVersion G9)
  P1a Design system basics: tokens, shell, kit, ONE 3D hero (Home)
  P2  Stacks + Doctor + env manager F1 + bootstrap F2 + ports F3 + watch F4 + re-adopt G4
  P3  Logs + activity timeline F5 + follow-a-request F6
  P5.5 Notifications (from branch plan/notification)
→ use it daily for 2 weeks → re-plan
v1.1  P4 Repos/accounts (+ command preview F18, token helper F7, HTTP runner F9)
      P5 Resources · P6 Databases (+ snapshots F8)
v1.2  P7 Flows · P8 Quality · P9 Images (+ SBOM F15)
v1.3  P10 Work items + Claude (+ release train F12) · P11 VS Code (+ Delve attach G3)
v1.4  P12 Desktop app · P13 polish
P1b  signature 3D/motion visuals, built page by page alongside each phase
```

---

## 5. Decisions needed from you

1. **Repo visibility**: private, or public with a license plus company data moved to a private workspaces repo? (§3.5)
2. **MVP cut**: accept the re-sequencing in §4?
3. **Must-haves**: accept F1–F8 into the plan?
4. **Positioning**: personal (A), with the core kept generic for B?

Once you answer, I'll fold the accepted items into `00-implementation-plan.md`, after `plan/notification` is merged so the edits don't conflict.
