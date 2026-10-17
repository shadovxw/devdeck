# devdeck: project rules

Personal developer cockpit on top of VS Code. Go backend + React SPA, local only for v1.
The plan is in [`dev-plans/00-implementation-plan.md`](dev-plans/00-implementation-plan.md); read the section for the phase you are working on before changing code.

## Stack and layout

- Go 1.26 (module `github.com/shadovxw/devdeck`, `go.mod` at the repo root), Echo v4, zerolog.
- `web/` is React 19 + Vite + TypeScript. **Use `npm`, not pnpm or yarn**: CI runs `npm ci` against `web/package-lock.json`.
- Layout follows plan §3: `cmd/devdeck`, `internal/*`, `sdk/`, `plugins/<name>/`, `web/`.
- Tool versions are pinned in `mise.toml` (Node matches CI). Tasks: `mise run dev | build | test | lint`.

## Git

- Never run `git init`, `commit`, `branch`, `checkout -b`, `fetch`, `pull`, `push` or `merge`. Give the user the commands instead. Read-only `status`, `log`, `diff` are fine.
- Default branch is `main`; work lands through PRs into `dev`. Branch rulesets require the "CI passed", "Security passed" and "CodeQL passed" checks.
- Commit messages end with the `Co-Authored-By` line given in the session's attribution reminder.
- Do not edit `ui-mockup/nav.js` or `ui-mockup/plugins.html` until the plan/notification work has merged.

## Security

- Listen on `127.0.0.1` only and keep the Host/Origin check on HTTP and WebSocket (plan §6.1). Auth is deferred; do not add it unasked.
- Secret values stay masked in the UI, are never logged, and are never sent to Claude or MCP (names only). Secrets live in the OS keyring, never in YAML or SQLite.
- Write actions (SQL, migrations, clean-ups, pushes) are local-only and need a confirmation step.
- CI scans every commit with gitleaks, semgrep, trivy and CodeQL. Do not commit key-shaped sample strings, `Math.random()` for ids, or CDN `<script>` tags without `integrity`. A real secret is rotated, not added to `.gitleaksignore`.

## Keep the product generic

- This repo is public. New code, docs, tests, fixtures and sample data must not mention infrabot or its services, databases and ticket systems, the company's GitHub org, Docker Hub namespace, domains, hostnames, IPs or emails. Use neutral demo names (`acme`, `demo-api`, `example.com`).
- Real workspace config (repos, stacks, connections for the user's own systems) belongs in a separate private repo, never here. Plan §13 question 2.
- `dev-plans/`, `ui-mockup/` and `ui-design/` still mention infrabot from before this rule. Do not copy that content into code; the mockups are deleted once the product is nearly done.

## UI

- Flat: no borders or shadows on cards, tight radii (3/4/6px), no icon-background chrome.
- Minimal text; explanations go in tooltips. Geist + Geist Mono. Dark first, with a working light theme.
- Colours, type and motion come from tokens (plan §7, `dev-plans/02-frontend-design-system.md`). The design samples in `ui-design/` are the reference.

## Working rules

- Every work item keeps `dev-plans/<date>-<name>/changes.md` current while coding (what changed and why), next to its `plan.md`.
- Each phase ends with a short `dev-plans/NN-<phase>.md` describing what was built.
- Keep the plan honest: if a decision changes, update the plan in the same PR.
- Tests: table tests for Go units; Vitest for web hooks and stores; no real tokens or secrets in fixtures.
