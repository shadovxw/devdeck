# devdeck: Implementation Plan (v1, local machine only)

> Status: draft for review · 2026-10-16 · owner: Vrishank Warrier
> Source of truth for *what* the UI shows: [`ui-mockup/`](../ui-mockup/sitemap.html) (27 bare pages).
> This document says *how* we build it, in what order, and when each part is done.

---

## Contents

1. [What we are building](#1-what-we-are-building)
2. [Key decisions](#2-key-decisions)
3. [Architecture](#3-architecture)
4. [Core concepts and data model](#4-core-concepts-and-data-model)
5. [Plugin SDK](#5-plugin-sdk)
6. [API surface](#6-api-surface)
7. [UI, motion and 3D system](#7-ui-motion-and-3d-system)
8. [Phases, parts and sub-parts](#8-phases-parts-and-sub-parts)
9. [Milestones](#9-milestones)
10. [Testing strategy](#10-testing-strategy)
11. [Risks and mitigations](#11-risks-and-mitigations)
12. [Later (out of scope for v1)](#12-later-out-of-scope-for-v1)
13. [Open questions](#13-open-questions)

---

## 1. What we are building

A personal **developer cockpit** that runs on this Windows machine, works for **any codebase**, and sits **on top of VS Code** (never replaces it). Infrabot is the first workspace.

**Goals for v1**
- One click starts a named stack (Docker deps + Go + Node services), after checking the machine is ready.
- One place for all live logs, with zerolog-aware level / regex / JSON-field filters and clickable `file:line`.
- CPU / RAM / disk per service and for the machine; stop what you don't need.
- Repos across **two GitHub accounts** (work + group), each pushing as the right identity.
- Postgres: explorer, SQL console, saved scripts, migrations (using the repos' existing SQL files and scripts).
- Tools as **plugins**; **flows** chain plugin steps (infrabot-workflow style); **runs** record results.
- Security + quality checks (gitleaks, trivy, semgrep, golangci-lint, govulncheck, SonarQube…) feeding one **Findings** list.
- Build, scan and push Docker images with auto-incremented tags in each service's own format.
- **Work items** tied to `dev-plans/` folders; Claude writes plan/changes/review/PR summary; PRs created with the right account.
- A UI that feels like a **3D, animated, crafted product**, not a plain SaaS admin panel.
- Ships as a **desktop app** (`.exe` + installer) in the final phase.

**Non-goals for v1**: remote/dev environments, deploying to dev, teammates/multi-user, prod access. (See §12.)

---

## 2. Key decisions

| Area | Decision | Why |
|---|---|---|
| App shape | **Go backend + React SPA**, served on `localhost:7070` during dev; wrapped as a **Wails** desktop app in Phase 12 | One binary; the same UI works in a browser, in VS Code's Simple Browser and in the desktop window |
| Frontend framework | **React 19 + Vite + TypeScript** (not Next.js) | Next.js is built for server-rendered websites (SSR, server components, API routes). Here the server is Go and the app is local, so those features are dead weight, and they don't work inside a Wails/`go:embed` bundle. Vite gives the fastest HMR for heavy animation work, is what infrabot-frontend already uses, and Wails supports it. |
| Routing | React Router v7 (data routers + `viewTransition`) | Same as infrabot; built-in View Transitions hook |
| Styling | Tailwind v4 + Radix / Base UI primitives (shadcn-style, fully re-skinned) | Accessible primitives; all visual identity is ours |
| Animation | **Motion** (`motion/react`) for UI and layout transitions; **GSAP** (now fully free, incl. SplitText/MorphSVG) for timelines and signature sequences | Motion = declarative React layout/exit animations; GSAP = choreographed multi-element sequences |
| 3D | **React Three Fiber v9** (pairs with React 19) + drei + postprocessing | Declarative three.js inside React |
| Charts | **ECharts** for heavy live time-series and treemaps; custom SVG + Motion for signature visuals | ECharts handles 10k-point streams with built-in animation; custom SVG for hero graphics |
| Graph canvas | **@xyflow/react** (flow builder, ER diagram, service map 2D) | Already used in infrabot's workflow builder |
| Editor / terminal | Monaco (SQL, YAML) · xterm.js (psql / shell) | Industry standard |
| Client state | TanStack Query (server state) + Zustand (UI state) | Zustand already in infrabot |
| Backend | **Go 1.26**, Echo v4, zerolog | Same stack as infrabot services |
| Local storage | **SQLite** via `modernc.org/sqlite` (pure Go, no CGO) | Runs, history, findings, migration history, metrics |
| Config | **YAML files** in a workspace folder (git-trackable) | Diffable, editable in VS Code, portable to a new PC |
| Secrets | Windows Credential Manager via `go-keyring` | Never in YAML, never in SQLite |
| Realtime | **WebSocket** hub (logs, status, metrics, run events, terminal) | One connection, many topics |
| Process supervision | **Own supervisor in Go** (Windows Job Objects) instead of Tilt | We need exact PIDs (metrics), log capture, restart buttons and readiness. Tilt can still be a plugin later |
| Plugins | **Static Go code** behind interfaces + a registry (one line to add a tool) | You asked for "easily addable", not runtime-dynamic |
| Flow engine | DAG from YAML, `expr-lang/expr` for gates, Go templates for inputs | Same mental model as infrabot workflows |
| Git multi-account | devdeck acts as a **git credential helper** + per-repo `user.name/email` | Works for git CLI, VS Code Source Control and devdeck itself |
| Desktop packaging | **Wails v2** (stable). Re-check v3 (in beta) at Phase 12 | WebView2 = Chromium on Windows, so WebGL/animations behave like Chrome |

---

## 3. Architecture

```
┌──────────────────────────── devdeck.exe (Go) ────────────────────────────┐
│                                                                          │
│  HTTP + WS API (Echo)  ──  embedded React SPA (go:embed web/dist)        │
│        │                                                                 │
│  ┌─────┴──────── core services ───────────────────────────────────────┐  │
│  │ workspace  · supervisor · logs hub · metrics · flow engine         │  │
│  │ git/accounts · db (pg) · findings · work items · events bus        │  │
│  └─────┬──────────────────────────────────────────────────────────────┘  │
│        │ plugin registry (static Go)                                     │
│  ┌─────┴────────────────────────────────────────────────────────────┐    │
│  │ git github docker regctl golang node postgres zerolog sonarqube  │    │
│  │ gitleaks trivy semgrep hadolint claude vscode system-metrics …   │    │
│  └──────────────────────────────────────────────────────────────────┘    │
│  storage: SQLite (state.db) · YAML (workspaces/) · JSONL logs · keyring  │
│  MCP server (stdio/HTTP) for Claude Code                                 │
└──────────────────────────────────────────────────────────────────────────┘
        │ spawns / talks to
  go build+run · npm run dev · docker (Engine API) · psql · gh · scanners · claude -p
```

**Process model**: one devdeck process. Child processes per service are placed in a **Windows Job Object** so stop/crash kills the whole tree (no orphaned `node.exe`/`go-build` processes).

**Repo layout**

```
devdeck/
├─ cmd/devdeck/            main: server, CLI subcommands (git-credential, mcp, doctor)
├─ internal/
│  ├─ api/                 HTTP handlers, WS hub, DTOs
│  ├─ core/                workspace, stack, supervisor, flow engine, events
│  ├─ store/               SQLite migrations + repositories
│  ├─ logs/                ingest, parse, ring buffers, search, error grouping
│  ├─ metrics/             sampler, rollups
│  ├─ gitx/                git ops, credential helper, account rules
│  ├─ pg/                  introspection, console, scripts, migrations
│  ├─ findings/            SARIF normalisation, dedupe, fingerprints
│  ├─ workitems/           dev-plans folders, stage machine
│  └─ mcp/                 MCP server tools
├─ sdk/                    plugin interfaces + helpers (exec, schema, findings)
├─ plugins/<name>/         one folder per tool (manifest.yaml + Go)
├─ web/                    React app (Vite)
│  ├─ src/app/             router, providers, shell, transitions
│  ├─ src/scene/           persistent 3D canvas + per-route scenes
│  ├─ src/design/          tokens, motion presets, components
│  ├─ src/charts/          ECharts theme + chart components
│  └─ src/pages/<route>/
├─ workspaces/             example workspace YAML (infrabot)
├─ ui-mockup/              bare HTML mockup (reference)
├─ dev-plans/              this plan + per-feature plans
└─ build/                  Wails config, installer, icons
```

**Local data locations**
| Data | Where |
|---|---|
| Workspace config (YAML) | `devdeck/workspaces/<name>/` (or any folder you point at) |
| State DB | `%APPDATA%\devdeck\state.db` |
| Logs | `%LOCALAPPDATA%\devdeck\logs\<workspace>\<service>\YYYY-MM-DD.jsonl` (retention: 14 days) |
| Built service binaries | `%LOCALAPPDATA%\devdeck\bin\<workspace>\<service>.exe` |
| Scan reports | `%LOCALAPPDATA%\devdeck\reports\<run-id>\` |
| Claude context | `<workspace>/.devdeck/context/` (schema snapshots, findings summaries) |

---

## 4. Core concepts and data model

| Concept | infrabot equivalent | Stored in | Notes |
|---|---|---|---|
| Workspace | Tenant | YAML | folder, repos, default account |
| Repo | none | YAML + git | type, start cmd, port, image, sonar key, migrations config |
| Connection | Provider instance | YAML (+ keyring secret) | github, registry, sonarqube, postgres… |
| Account rule | none | YAML | remote pattern → connection |
| Stack | none | YAML | services, order, readiness, env |
| Service (runtime) | none | memory + SQLite | status, pid, port, restarts |
| Plugin | Plugin | Go code | manifest + actions |
| Action | Node type / executor | Go code | inputs/outputs schema |
| Flow | Workflow template | YAML | trigger + DAG of steps |
| Run / Step | Workflow execution / step | SQLite | status, timings, outputs, logs |
| Finding | none | SQLite | normalised from SARIF etc., fingerprinted |
| Work item | Ticket | `dev-plans/` folder + SQLite | stage machine |
| Database / Migration | none | SQLite | applied history, checksums |
| Saved script | none | `.sql` files with header | params, allowed envs |
| Metric sample | none | SQLite (rolled up) | 5 s raw for 1 h, 1 min for 24 h |
| Log line | none | ring buffer + JSONL | parsed fields, level, caller |

**SQLite tables (v1)**: `services_state`, `runs`, `run_steps`, `run_step_logs`, `findings`, `finding_events`, `work_items`, `work_item_stages`, `migration_history`, `sql_history`, `metric_samples`, `metric_rollups`, `log_error_groups`, `image_builds`, `audit_log`, `settings`.

---

## 5. Plugin SDK

**One interface, optional capabilities.** A plugin implements `Plugin` plus any capability interfaces it supports.

```go
type Plugin interface {
    Manifest() Manifest                       // id, category, needs, actions, connection type
    Check(ctx) ToolStatus                     // installed? version? healthy?
}
type Installer interface   { Install(ctx, method) error }           // winget / scoop / docker pull
type ActionRunner interface { Run(ctx, action string, in Inputs, out Emitter) (Outputs, error) }
type ConnectionTester interface { TestConnection(ctx, Connection) error }
type DataSource interface   { Options(ctx, source string, params) ([]Option, error) }
type LogParser interface    { Parse(line []byte) (LogRecord, bool) }        // zerolog, vite, go-panic
type FindingsProducer interface { Findings(ctx, report Path) ([]Finding, error) }
type MetricsSource interface { Sample(ctx) ([]Metric, error) }
```

`Emitter` streams step logs, progress and partial findings to the UI. `Inputs`/`Outputs` are validated against the JSON Schema in the manifest, and the UI renders forms from the same schema.

**Manifest (embedded YAML, one per plugin)**: `id, name, category, icon, needs[] (binary + min version + install methods), connection_type (fields + secret flags), data_sources, actions{inputs, outputs, fail_when}`.

**Add-a-tool checklist** (target: under 1 hour for a CLI scanner)
1. `plugins/<tool>/manifest.yaml`
2. `plugins/<tool>/<tool>.go` implementing `Plugin` + `ActionRunner` (+ `FindingsProducer` if it outputs SARIF/JSON)
3. One line in `plugins/registry.go`
4. A test with a recorded tool output fixture

**v1 plugin list**: git, github, docker, regctl, golang, node, python, zerolog, vite-log, go-panic, postgres, system-metrics, sonarqube, gitleaks, trivy, semgrep, govulncheck, golangci-lint, eslint, npm-audit, hadolint, claude, vscode, notify, script (run any command).

---

## 6. API surface

REST under `/api/v1`, WebSocket at `/ws` with topic subscriptions.

| Group | Endpoints (examples) |
|---|---|
| Workspaces | `GET /workspaces` · `GET /workspaces/:ws` · `POST /workspaces/:ws/clone` |
| Repos | `GET /repos?ws=` · `POST /repos/:id/pull|push|fetch|branch` · `GET /repos/:id/status|commits|prs` |
| Accounts | `GET/POST /connections` · `POST /connections/:id/test` · `GET/PUT /account-rules` |
| Stacks | `GET /stacks` · `POST /stacks/:id/start|stop|restart` · `POST /services/:id/restart|stop|debug` |
| Logs | `GET /logs/search?svc=&level=&re=&field=&since=` · `GET /logs/errors` · saved filters CRUD |
| Metrics | `GET /metrics/machine?range=` · `GET /metrics/services` · `GET /disk` · `POST /disk/cleanup/:kind` |
| DB | `GET /db/servers` · `GET /db/:conn/:db/tables|table/:t` · `POST /db/:conn/:db/query` · scripts CRUD + run · migrations status/run/dry-run/baseline/sync |
| Plugins | `GET /plugins` · `POST /plugins/:id/check|install` · `GET /plugins/:id/datasource/:name` |
| Flows/Runs | flows CRUD · `POST /flows/:id/run` · `GET /runs` · `GET /runs/:id` · `POST /runs/:id/cancel|retry` |
| Findings | `GET /findings` · `POST /findings/:id/ignore|fix-with-claude` |
| Images | `GET /images` · `POST /images/:repo/build|push` · `GET /images/:repo/next-tag` |
| Work items | CRUD · `POST /work-items/:id/stage` · `POST /work-items/:id/review|pr-summary|create-prs` |
| Doctor | `GET /doctor` · `POST /doctor/install` |

**WS topics**: `svc.status`, `logs.<svc>`, `logs.errors`, `metrics.machine`, `metrics.svc`, `run.<id>`, `findings`, `term.<session>`, `toast`.

### 6.1 Authentication and local security

**Decision (2026-10-16): no authentication in v1.** Only two cheap safety checks are built now (Phase 0.2.7):
1. Listen on `127.0.0.1` only. Nothing on the network can reach devdeck.
2. Host/Origin check on every HTTP request and the WebSocket upgrade. A website open in your browser can't call `localhost:7070`, which matters because devdeck can run commands, SQL and `docker exec`.

Connection secrets (GitHub, Docker Hub, SonarQube, Postgres) still go in Windows Credential Manager. That's simply where the connection code stores them.

Everything below is **deferred until devdeck is deployed or shared**, and gets revisited then.

**Deferred: full local hardening + login**

| Threat | Protection |
|---|---|
| Other machines on the network | Listen on `127.0.0.1` only, never `0.0.0.0` |
| A malicious web page calling `localhost:7070` (CSRF) | Every request needs a session token. At launch devdeck creates a random secret and opens the UI with a one-time code, which is exchanged for an `HttpOnly`, `SameSite=Strict` cookie. No CORS is allowed. |
| DNS rebinding (an evil domain pointing at 127.0.0.1) | Reject requests whose `Host` isn't `localhost:7070`/`127.0.0.1:7070`; check `Origin` on every write and on the WebSocket upgrade |
| Desktop app (Phase 12) | The Wails UI calls Go in-process; no open HTTP port is needed for the app window |
| VS Code extension, CLI | Read the token from `%APPDATA%\devdeck\session.token` (permissions: current user only), rotated each launch |
| Claude via MCP | stdio transport (no network port); read-only DB role; secrets redacted from tool output |
| Secrets for GitHub, Docker Hub, SonarQube, Postgres | Windows Credential Manager (encrypted with your Windows login); never in YAML, SQLite, logs or Claude context |
| Dangerous actions | Confirmation dialogs + audit log (who/what/when) for: SQL writes, migrations, clean-ups, pushes, stopping containers |

**Signing in to other systems** (the "connections"): GitHub via `gh auth login` per account (browser/device flow), Docker Hub via `docker login`, SonarQube via a token, Postgres via user/password. All are stored in the keyring.

**Later (remote/team, §12)**: if devdeck is ever hosted or shared, add real login with **OIDC against your existing Keycloak** and roles (viewer / developer / admin).

---

## 7. UI, motion and 3D system

### 7.1 Design direction
Working name: **"Deck"**, an instrument panel for your codebase. Dark-first, with depth (layers, light, parallax), precise typography, and data that moves. Three moodboard directions are produced in Phase 1 and one is picked:
- **A. Holo HUD**: dark glass, cyan/amber light lines, scanline details, sci-fi cockpit.
- **B. Soft depth**: calm gradients, frosted layers, soft shadows, rounded 3D objects (Apple-like).
- **C. Blueprint**: technical drawing aesthetic, grid paper, ink lines that draw themselves, monochrome + one accent.

### 7.2 Shell
- **Persistent 3D background canvas** (one WebGL context for the whole app; scenes swap per route, never re-created).
- **Dock-style sidebar** with magnetic hover, active-route light trail, collapsible to icons.
- **Command palette** (Ctrl+K): jump to any entity (service, repo, table, finding, run) or action ("start full stack").
- **Everything is linked**: every entity chip (service, repo, DB, table, finding, run, work item) is a link with a hover preview card. Example: a log error links to its service, repo, file:line, open work item and related findings.
- Global status strip: stack state, error count, running flows, CPU/RAM mini-meters.

### 7.3 Motion grammar (tokens, so it stays coherent)
| Token | Use | Value (initial) |
|---|---|---|
| `instant` | hover, press | 80–120 ms |
| `quick` | small state changes, toasts | 180 ms |
| `move` | layout moves, list reorder | 320 ms spring (stiffness 300, damping 30) |
| `scene` | route transitions, camera moves | 600–900 ms, ease-in-out-cubic |
| `story` | signature sequences (stack boot) | GSAP timeline, 1.5–3 s, skippable |

Rules: motion always **explains change** (where something came from or went). Live data animates in, never jumps. Every animation has a reduced-motion fallback.

### 7.4 Route transitions and signature visuals (per page)
| Page | Signature visual | Transition in / out |
|---|---|---|
| Home | **3D service constellation**: nodes = services (size = RAM, glow = status, pulse = errors), links = dependencies, particles = log rate | Camera dolly from the previous scene; clicking a node flies the camera into it → Service detail |
| Stacks | Boot sequence: services light up in dependency order as a wave | Stack card morphs (shared element) into the live view |
| Logs | Virtualized stream; level histogram timeline (brushable); errors leave a spark on the timeline | Slide-up panel; filters animate as chips |
| Resources | Animated rings for CPU/RAM/disk; live area chart; disk **treemap** that zooms into a category | Rings count up; treemap zoom transition |
| Repos | Git lane graph; account-coloured chips; push/pull particle flow up/down | Row → detail shared-element morph |
| Work items | Horizontal stage track (plan → code → checks → review → PR) with progress light | Card expands into the full work-item view |
| Flows | xyflow canvas with animated edges (data flowing); run playback lights steps in order | Builder opens with the canvas "unfolding" |
| Runs | Live Gantt/timeline; failed step shakes once and stays highlighted | Row → detail morph |
| Findings | Severity heat grid / bubble cluster; filters re-layout with Motion `layout` | Cluster explodes into a list on click |
| Images | Tag timeline per service; build progress as a filling capsule | |
| Databases | **ER diagram** (tables as nodes, FKs as edges, force layout); migration timeline | Zoom from server → DB → table |
| SQL console | Monaco; results grid reveals rows in a short stagger | |
| Plugins | Card grid with tilt/parallax; install progress ring | Card flips to the manifest view |
| Doctor | "System scan" checklist sweep; missing tools pulse | |
| Connections | Account identity cards (work vs group) with colour coding | |

### 7.5 Performance budget (non-negotiable; this UI sits next to a heavy dev stack)
- Idle (window visible, nothing changing): **≤ 3% CPU**, 3D at `frameloop="demand"`.
- Window hidden or minimised: **rendering paused** (0 GPU work).
- Animations at 60 fps on this laptop; long lists virtualized; log stream batched per animation frame.
- **Performance mode** toggle: 3D off, 2D motion kept. **Reduced motion**: respects the OS setting.
- devdeck shows its **own** CPU/RAM on the Resources page, so we see when the UI is the problem.

### 7.6 Charts rules
Follow the dataviz rules: one y-axis per chart, a single hue for magnitude, status colours only with icon + label, hover tooltips on every chart, and a table view for every chart. ECharts theme generated from the design tokens; light/dark validated.

---

## 8. Phases, parts and sub-parts

Size key: **S** ≈ 1–2 days · **M** ≈ 3–5 days · **L** ≈ 1–2 weeks · **XL** ≈ 2–3 weeks (focused work, Claude-assisted).
Each phase ends with a **demo checkpoint** and a short `dev-plans/NN-<phase>.md` describing what was built.

---

### Phase 0: Foundations (L)
**Goal**: an empty but real app: Go server + React shell + storage + plugin registry, running with one command.

- **0.1 Repo & tooling**
  - 0.1.1 `git init` devdeck under the **work account**; `.gitignore`, `README`, `CLAUDE.md` (project rules, incl. the dev-plans/changes.md rule)
  - 0.1.2 `mise.toml` pinning go, node; tasks `dev`, `build`, `test`, `lint`
  - 0.1.3 Dev loop: Go server with live reload (air) + Vite dev server proxying `/api` and `/ws`
- **0.2 Backend skeleton**
  - 0.2.1 Echo server, zerolog, config loading, graceful shutdown
  - 0.2.2 WebSocket hub with topic subscribe/unsubscribe + backpressure
  - 0.2.3 Event bus (in-process pub/sub) feeding the hub
  - 0.2.4 SQLite store + embedded migrations
  - 0.2.5 Keyring wrapper for secrets
  - 0.2.6 ~~Audit log helper~~ (deferred with authentication, see §6.1)
  - 0.2.7 Minimal local safety (§6.1): bind `127.0.0.1` only + Host/Origin check middleware on HTTP and the WS upgrade
- **0.3 Plugin SDK v0**
  - 0.3.1 Interfaces from §5, manifest loader, JSON-schema validation
  - 0.3.2 Exec helper (run a binary, stream stdout/stderr, timeout, Job Object)
  - 0.3.3 Registry + `GET /plugins` + first plugins: `git`, `docker`, `system-metrics` (check only)
- **0.4 Frontend skeleton**
  - 0.4.1 Vite + React 19 + TS + Tailwind v4 + Router + TanStack Query + Zustand
  - 0.4.2 API client + WS client with auto-reconnect and topic hooks (`useTopic('svc.status')`)
  - 0.4.3 Routes for every mockup page (placeholders) + sidebar from one config (same idea as `nav.js`)
- **0.5 Workspace config**
  - 0.5.1 YAML schemas (workspace, repo, stack, flow, connection, account rules) + validation errors shown in UI
  - 0.5.2 Infrabot example workspace generated by scanning the folder (16 repos, remotes, types)

**Done when**: `mise run dev` opens the shell at localhost; Plugins page lists git/docker with real versions; infrabot workspace loads from YAML.

---

### Phase 1: Design system, motion and 3D foundation (XL, runs alongside Phases 2–3)
**Goal**: the "amazing UI" groundwork, so every later page is built from the same kit instead of retrofitted.

- **1.1 Direction**
  - 1.1.1 Three moodboards (A/B/C from §7.1) as static HTML artifacts → you pick one
  - 1.1.2 Hero mock of Home in the chosen direction (static, high fidelity)
- **1.2 Tokens**
  - 1.2.1 Colour (surfaces, ink, accents, status, categorical series, validated for CVD + contrast, light & dark)
  - 1.2.2 Type scale, spacing, radii, elevation/depth, glass/blur levels
  - 1.2.3 Motion tokens (§7.3) as Motion presets + GSAP defaults
- **1.3 Shell**
  - 1.3.1 Dock sidebar, top status strip, command palette (Ctrl+K)
  - 1.3.2 Route transition system: AnimatePresence + View Transitions; shared-element (`layoutId`) helpers for list → detail
  - 1.3.3 Entity link chips + hover preview cards (generic, data-driven)
- **1.4 3D scene system**
  - 1.4.1 Persistent R3F canvas behind the app; scene registry per route; camera rig with tweened moves
  - 1.4.2 Visibility/perf controller: demand frameloop, pause when hidden, performance mode, reduced motion
  - 1.4.3 Postprocessing preset (bloom, vignette) with a quality switch
- **1.5 Component kit**
  - 1.5.1 Re-skinned primitives: button, input, select, tabs, dialog, sheet, toast, tooltip, table (virtualized), badge, chips
  - 1.5.2 Data components: stat tile with count-up, status pill (icon + label), progress capsule, live sparkline
  - 1.5.3 Loading/empty/error states with motion
- **1.6 Chart kit**
  - 1.6.1 ECharts theme from tokens; time-series, bar, treemap, heat grid, gauge ring
  - 1.6.2 Shared tooltip/crosshair; "show as table" toggle on every chart
- **1.7 Perf harness**
  - 1.7.1 FPS/CPU overlay (dev only), Playwright perf trace script; budget check in CI

**Done when**: the shell with transitions and a demo 3D scene runs within the §7.5 budget; the kit has a showcase page.

---

### Phase 2: Workspaces, Doctor and Stacks (one-click start) (L), MVP part 1
**Goal**: replace "start Docker, run commands, `go run`, `npm run dev`" with one button.

- **2.1 Doctor**
  - 2.1.1 Collect `needs` from all plugins used by the workspace; check binary + version
  - 2.1.2 Checks: Docker running, ports free, `.env` present per service, git identity (global identity present; per-repo identity matches the repo's account)
  - 2.1.3 Install missing via winget/scoop/docker pull with streamed output
  - 2.1.4 UI: "system scan" page, fix buttons
- **2.2 Stack definitions**
  - 2.2.1 Stack YAML: compose file, services (repo, kind, cmd, port, readiness, after, env_file, log parser)
  - 2.2.2 Generate default stacks for infrabot (full, backend-only, frontend-only, db-only)
- **2.3 Supervisor**
  - 2.3.1 Compose deps via `docker compose` CLI (up/down/ps) + Docker Engine API for status
  - 2.3.2 Go services: `go build -o bin/<svc>.exe` then run the exe (faster restarts, real PID, clean kill) instead of `go run`
  - 2.3.3 Node services: `npm run dev` under a Job Object
  - 2.3.4 Dependency ordering (DAG), readiness probes (HTTP/TCP/log line), restart with backoff, crash detection
  - 2.3.5 Pre-start gate: run Doctor checks for this stack; refuse with a clear reason
- **2.4 UI**
  - 2.4.1 Stacks list + Start/Stop; stack live view (status, port, uptime, restarts, last error)
  - 2.4.2 Boot sequence animation driven by real readiness events
  - 2.4.3 Home v1: services, quick actions, status strip wired to live data
- **2.5 CLI**
  - 2.5.1 `devdeck up <stack>` / `devdeck down` / `devdeck status` for terminal use

**Done when**: `full` stack starts all infrabot services in order from one click; crashes show within 2 s; stop leaves no orphan processes.

---

### Phase 3: Logs (L), MVP part 2
**Goal**: never hunt through terminals again.

- **3.1 Ingest**
  - 3.1.1 Capture stdout/stderr per service (process pipes, Docker logs stream)
  - 3.1.2 Ring buffer per service (50k lines) + JSONL files with daily rotation and retention
- **3.2 Parsing (plugins)**
  - 3.2.1 `zerolog`: level, time, message, caller, error, all fields
  - 3.2.2 `go-panic`: multi-line panic/stack trace grouping → top frame `file:line`
  - 3.2.3 `vite-log` / TS compile errors; plain-text fallback with level guessing
- **3.3 Query**
  - 3.3.1 Filters: services, level, regex, JSON field = value, time range; server-side over ring + files
  - 3.3.2 Saved filters (YAML in the workspace)
  - 3.3.3 Error grouping by fingerprint (message template + top frame), counts, first/last seen
- **3.4 UI**
  - 3.4.1 Virtualized live stream (batched per frame), JSON row expand, column view for fields
  - 3.4.2 Level histogram timeline (brush to filter), error sparks
  - 3.4.3 Errors panel; click `file:line` → VS Code (`vscode://file/...`)
  - 3.4.4 "Ask Claude about this error" (sends error + context to a Claude session, Phase 10 hook)

**Done when**: an error in any infrabot service appears in the Errors panel with a working VS Code link within 1 s; filtering 500k lines returns in under 1 s.

> **Milestone M1, daily driver**: Phases 0, 2 and 3 (with the Phase 1 shell) replace the current manual routine.

---

### Phase 4: Repos and Git accounts (L)
**Goal**: every repo shows which account it belongs to, and every git operation uses the right one.

- **4.1 Connections**
  - 4.1.1 GitHub connection type: sign-in via `gh auth login` per account (gh supports multiple accounts) or PAT; token in keyring
  - 4.1.2 Commit identity per connection (name, email, optional signing key)
  - 4.1.3 Test connection: token valid, scopes, org access
- **4.2 Account rules**
  - 4.2.1 Rules: remote pattern → connection (`github.com/citiuscloud-services/*` → github-group)
  - 4.2.2 Per-repo override
- **4.3 Git credential helper**
  - 4.3.1 `devdeck git-credential` subcommand implementing git's credential protocol (matches host + path → token)
  - 4.3.2 Setup: `credential.useHttpPath=true` + helper registration, with a preview of the config change and an undo
  - 4.3.3 Per-repo `user.name` / `user.email` written on clone/assign
- **4.4 Repo operations**
  - 4.4.1 Status scan (branch, dirty files, ahead/behind) with fsnotify refresh
  - 4.4.2 Fetch/pull/push/branch/commit; bulk "pull all"
  - 4.4.3 Clone workspace onto a new PC (from the workspace YAML)
  - 4.4.4 PR list + checks via the GitHub API (go-github)
- **4.5 UI**
  - 4.5.1 Repos table with account chips, filters, bulk actions
  - 4.5.2 Repo detail: changes, commits (lane graph), PRs, settings
  - 4.5.3 Connections + rules editor

**Done when**: pushing from VS Code in an infrabot repo uses the group account and correct identity, and devdeck's own push does too; a repo with no matching rule is flagged.

---

### Phase 5: Resources (M)
- **5.1 Sampling**
  - 5.1.1 Machine CPU/RAM/disk via gopsutil (5 s)
  - 5.1.2 Per-service process trees (Job Object PIDs) + Docker stats API for containers
  - 5.1.3 Docker VM (vmmem/WSL2) usage and `.wslconfig` limit
  - 5.1.4 Rollups: 5 s for 1 h, 1 min for 24 h
- **5.2 Disk**
  - 5.2.1 `docker system df` breakdown, Go caches, `node_modules` per repo, devdeck logs/reports
  - 5.2.2 Clean-up actions with a dry-run list and confirmation
- **5.3 Idle detection**: no log lines + near-zero CPU for N minutes → "idle" badge + "stop idle" action
- **5.4 UI**: rings, live CPU chart, RAM-by-service bars with stop buttons, disk treemap, devdeck's own usage

**Done when**: numbers match Task Manager / `docker stats` within 5%; stopping from the RAM list frees the memory.

---

### Phase 6: Databases (XL)
- **6.1 Connections**
  - 6.1.1 Postgres connection type (host, port, user, password in keyring, sslmode, env tag, read-only flag)
  - 6.1.2 Auto-discover from the compose file and each repo's `.env` (DB name per service, with mismatch warnings)
- **6.2 Explorer**
  - 6.2.1 Introspection (pg_catalog): schemas, tables, columns, indexes, FKs, row estimates, DDL
  - 6.2.2 "Defined in" (which migration file creates the table) + "used in code" (grep the repo)
  - 6.2.3 Data preview with filters; inline edit on `local` only
  - 6.2.4 ER diagram (xyflow, force layout)
- **6.3 SQL console**
  - 6.3.1 Monaco with schema-aware autocomplete
  - 6.3.2 Execute (multi-statement), explain, cancel; results grid; CSV/JSON export
  - 6.3.3 Safety: env badge, confirm on UPDATE/DELETE without WHERE, transaction mode with Commit/Rollback
  - 6.3.4 History
  - 6.3.5 psql terminal mode (xterm.js + ConPTY, or `docker exec` into the postgres container)
- **6.4 Saved scripts**
  - 6.4.1 `.sql` files with header (name, db, type, allowed_envs, params) in the workspace
  - 6.4.2 Param form, preview, run in transaction; usable as a flow step
- **6.5 Migrations**
  - 6.5.1 Per-repo config: folder, filename pattern (`V{n}__name.sql`, `{nnn}_name.sql`, `{nn}_name.sql`), database, copy_to, runner
  - 6.5.2 Status: files in repo vs eks_deployment copy vs applied here (history in SQLite, or optional `devdeck_schema_history` table)
  - 6.5.3 Runners: built-in (psql/pgx, one tx per file, stop on error) or existing scripts (`apply-postgres-schema.ps1`, `migrate.ps1`, `run_migrations.sh` with `PSQL_MODE`)
  - 6.5.4 Dry run (BEGIN … ROLLBACK; flags statements that can't run in a transaction)
  - 6.5.5 Baseline, checksum drift detection, lint (no IF NOT EXISTS, destructive statements)
  - 6.5.6 Sync to `eks_deployment/infrabot-migration/<svc>/`
- **6.6 Claude context**
  - 6.6.1 Schema snapshots → `.devdeck/context/db/<db>.md`, refreshed after migrate
  - 6.6.2 New migration with Claude: next file name, idempotent draft, opens in VS Code (wired fully in Phase 10)

**Done when**: catalog's 2 pending migrations can be dry-run and applied from the UI; saved scripts run with params; schema snapshot files exist for all infrabot DBs.

---

### Phase 7: Plugins catalogue, flow engine and runs (XL)
- **7.1 Plugins page**: health, versions, install, manifest viewer, connections using each plugin
- **7.2 Flow model**
  - 7.2.1 YAML: trigger, steps (plugin.action, inputs, `needs`), gates (`expr`), approval, parallel groups, `for_each repo`
  - 7.2.2 Templating: `{{ repo.path }}`, `{{ steps.trivy.outputs.findings_count }}`
  - 7.2.3 Validation with clear errors (unknown action, missing input, cycles)
- **7.3 Engine**
  - 7.3.1 DAG scheduler with a concurrency limit, cancellation, timeouts, retry policy
  - 7.3.2 Step log streaming + outputs persisted; resume/"re-run from failed step"
  - 7.3.3 Triggers: manual, work-item stage, schedule (cron), file change (fsnotify, debounced), git commit (post-commit hook installed by devdeck)
- **7.4 Built-in control steps**: gate, approval (UI prompt), stop, notify (Windows toast), script (any command)
- **7.5 UI**
  - 7.5.1 Flow builder on xyflow: palette from plugin manifests, schema-driven settings panel, animated edges
  - 7.5.2 Runs list, live run timeline, run detail with step logs and outputs
- **7.6 Starter flows**: `pre-pr-check`, `build-and-push`, `nightly-deps`

**Done when**: `pre-pr-check` runs across 3 repos in parallel, stops at a failing gate, and can be re-run from the failed step.

---

### Phase 8: Quality and security (L)
- **8.1 Scanner plugins**: gitleaks, trivy (fs/image/config), semgrep (Docker), govulncheck, golangci-lint, eslint, npm-audit, hadolint; each outputs SARIF/JSON → findings
- **8.2 SonarQube**
  - 8.2.1 Local server lifecycle (docker `sonarqube:community`, volume, first-run token setup)
  - 8.2.2 Scan via `sonar-scanner-cli` image; quality gate + issues via the web API
  - 8.2.3 VS Code "SonarQube for IDE" connected-mode setup helper
- **8.3 Findings**
  - 8.3.1 Normalise, fingerprint, dedupe across runs; status (open/fixed/ignored with reason)
  - 8.3.2 Ignore writes the tool-native ignore file (`.gitleaksignore`, `.trivyignore`, …) so it shows in the PR
  - 8.3.3 UI: heat grid/bubbles + filterable table, `file:line` → VS Code
- **8.4 Optional**: MegaLinter plugin as a one-shot "scan everything"

**Done when**: `pre-pr-check` produces findings from at least 5 tools in one list; ignoring one persists a reason in the repo.

---

### Phase 9: Images and tags (M)
- **9.1 Image config per repo**: Dockerfile, context, image name (handles `orchestrate-agents → infrabot-agent`), registry, platforms
- **9.2 Tag logic**: read tags (regclient) + local images; detect each service's format (`1.0.71`, `frontend-0.1.61`, `awsdev0.0.19`) and bump keeping the prefix; manual override
- **9.3 Build pipeline**: buildx build (cache), trivy image scan (fail on CRITICAL), push, git tag with the repo's account
- **9.4 Consistency check**: warn when the build script's registry/tag differ from `eks_deployment/values.yaml`
- **9.5 UI**: images table (latest hub / local / next), build progress capsule, tag timeline

**Done when**: one click builds and pushes `citiuscloud/infrabot-catalog-service:1.0.72` after a clean scan.

---

### Phase 10: Work items, Claude and PRs (XL)
- **10.1 Work items**
  - 10.1.1 Create: name, type, repos, base branch → branches in each repo + `dev-plans/<date>-<name>/` (plan.md, changes.md)
  - 10.1.2 Stage machine: plan → code → checks → review → PR (auto-advance on flow results)
- **10.2 Claude integration**
  - 10.2.1 Global `~/.claude/CLAUDE.md` rule: keep `changes.md` current while coding (installed by devdeck with your approval)
  - 10.2.2 Headless calls (`claude -p`) for: review (uses plan + changes + findings), fix findings, PR summary, rollback SQL, new migration
  - 10.2.3 Results written into the work item folder; diff shown before anything is applied
- **10.3 PRs**
  - 10.3.1 One PR per repo with the right account, base `dev`, body from `pr-summary.md`
  - 10.3.2 PR status/checks back on the work item
- **10.4 devdeck MCP server**
  - 10.4.1 Tools: `list_services`, `tail_logs`, `search_logs`, `list_findings`, `describe_table`, `run_select` (read-only role), `run_saved_script` (read-only scripts only), `get_run`
  - 10.4.2 Registered in Claude Code (`.mcp.json` / user config) so Claude reads devdeck instead of crawling repos
- **10.5 UI**: work-item list + stage track, detail tabs (plan, changes, checks, review, PR)

**Done when**: a work item goes from "New" to open PRs in two repos with the summary written by Claude and all checks attached.

---

### Phase 11: VS Code integration (M)
- **11.1 Generated files**: `<workspace>.code-workspace` (multi-root), `tasks.json` (problem matchers), `launch.json` (Delve compound for Go services), `extensions.json`
- **11.2 Debug from devdeck**: "debug" on a service restarts it under Delve and attaches VS Code
- **11.3 devdeck VS Code extension (thin)**
  - 11.3.1 Sidebar tree: stacks → services with status and actions (talks to the devdeck API)
  - 11.3.2 Problems panel: log errors + findings as diagnostics
  - 11.3.3 Status bar: stack state, error count; command "Open devdeck"
  - 11.3.4 Packaged as a local `.vsix`

**Done when**: errors and findings appear in VS Code's Problems panel and the sidebar can restart a service.

---

### Phase 12: Desktop app (M)
- **12.1** Wails wrapper around the same frontend + Go core (re-check Wails v3 maturity; v2 is the safe default)
- **12.2** System tray (status icon colour, quick start/stop), start with Windows (optional), single-instance lock
- **12.3** Windows toasts for crash / flow failed / flow passed
- **12.4** Installer (NSIS), app icon, signing (optional), auto-update check from GitHub releases (work account)
- **12.5** First-run wizard: Doctor → connections → clone/choose workspace → start stack

**Done when**: on a clean Windows PC, installer → wizard → infrabot running, without opening a terminal.

---

### Phase 13: Hardening and polish (ongoing, M)
- Perf audit against §7.5 on every phase; error boundaries; crash reports to a local file
- Backup/export of state + workspace config; settings page complete
- Docs: user guide, "write a plugin" guide

---

## 9. Milestones

| Milestone | Phases | You can… |
|---|---|---|
| **M1 Daily driver** | 0, 1 (shell + kit), 2, 3 | start any stack with one click and read all logs in one place |
| **M2 Control** | 4, 5 | manage repos with the right account and see/stop what eats resources |
| **M3 Data** | 6 | browse DBs, run scripts and migrations from the UI |
| **M4 Pipeline** | 7, 8, 9 | run pre-PR checks, see findings, build and push images |
| **M5 Ship** | 10, 11 | go from work item to PRs with Claude, inside VS Code |
| **M6 App** | 12, 13 | install devdeck as a desktop app on any PC |

Suggested order of work: 0 → 1 (in parallel with 2 → 3) → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Phase 1's later parts (signature visuals per page) are built together with each page's phase.

---

## 10. Testing strategy

| Layer | How |
|---|---|
| Go units | table tests per package; plugins tested against recorded tool outputs (fixtures) |
| Supervisor | integration tests spawning fake services (tiny Go binaries that log, crash, hang) |
| Postgres | testcontainers-go Postgres; migrations, dry-run, introspection |
| Git | temp repos + a fake credential flow; never real tokens in tests |
| Flow engine | DAG/gate/retry tests with fake actions |
| Frontend | Vitest for hooks/stores; Playwright for page flows (you already use Playwright MCP); visual snapshots of key states |
| Performance | Playwright trace + CPU sampling of the UI idle and during log floods; fails over budget |
| Dogfooding | from M1 on, use devdeck daily for infrabot |

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Heavy 3D/animation UI slows the machine that also runs the dev stack | §7.5 budget, demand rendering, pause when hidden, perf mode, devdeck shows its own usage |
| Animation work swallows the schedule | Phase 1 builds a reusable kit; per-page signature visuals are limited to one each; functional page first, polish second |
| Windows process trees (orphaned node/go processes) | Job Objects; build-then-run for Go instead of `go run` |
| ConPTY quirks for the terminal | Use a maintained Go ConPTY library; fall back to `docker exec` for psql |
| Credential helper conflicts with Git Credential Manager | Scope the helper to `github.com` with `useHttpPath`; preview + undo of git config changes |
| Tool output formats change | Prefer SARIF; pin tool versions via Doctor; fixture tests per plugin |
| Migrations without history in infrabot today | Baseline step + checksum tracking; never auto-run on non-local |
| Secrets leaking into logs/YAML/Claude context | Keyring only; redaction in log ingest and MCP outputs; read-only DB role for Claude |
| Wails v3 still in beta | Ship on v2; keep the core independent of Wails so switching is a small change |

---

## 12. Later (out of scope for v1)

- **Remote environments (dev)**: environment switcher; Docker over SSH (`docker context`), Kubernetes via kubeconfig (logs, exec, port-forward), Postgres through tunnels; then an optional devdeck agent on the dev host.
- **Deploy to dev**: bump `image.tag` in Helm values → `helm upgrade` → rollout + health check → rollback.
- **Authentication** (see §6.1 "Deferred"): session token + cookie, token file for the VS Code extension/CLI, audit log, and Keycloak OIDC login with roles once devdeck is deployed or shared.
- Teammates / shared state.
- More databases (MySQL: catalog has `schema/mysql`), more registries, GitLab.

---

## 13. Open questions

1. **Visual direction**: A (Holo HUD), B (Soft depth) or C (Blueprint), or a mix? Decided in Phase 1.1.
2. **Workspace config location**: inside the devdeck repo, or a separate `devdeck-workspaces` repo (work account)?
3. **Claude headless usage**: OK for devdeck to call `claude -p` for reviews and summaries?
4. **Git identity**: the global identity is Vrishank Warrier <vrishank.warrier@citiuscloud.com> (correct). Should devdeck still write per-repo identities when a GitHub account needs a different email?
5. **Name**: keep "devdeck"?

---

Sources consulted for library choices: [GSAP now 100% free (Webflow)](https://webflow.com/blog/gsap-becomes-free) · [GSAP standard license](https://gsap.com/community/standard-license/) · [R3F v9 migration guide (React 19)](https://r3f.docs.pmnd.rs/tutorials/v9-migration-guide) · [Wails releases (v3 beta, v2 stable)](https://github.com/wailsapp/wails/releases) · [Wails v3 beta announcement](https://newreleases.io/project/github/wailsapp/wails/release/v3.0.0-beta.0)
