# devdeck: Plugin Catalog and Observability Roadmap

> 2026-10-17 · owner: Vrishank Warrier · extends §5 (Plugin SDK) of [`00-implementation-plan.md`](00-implementation-plan.md)
> **Direction (from Vrishank):** devdeck is an **observability + control tool for infrabot first**. Once that works, it becomes the same tool for **any SaaS product**. Every tool infrabot uses is the first plugin target; more plugins follow wave by wave.

---

## 1. How this scales from infrabot to any product

Two ways in, used together:

| Path | What it covers | Effort per new tool |
|---|---|---|
| **Deep plugins** (Go, per tool) | Health, metrics, logs, an **explorer page** (browse NATS streams, Garage buckets, OpenBao secrets…), **actions** (purge a stream, create a bucket…), events for notifications, tools for Claude | 1–5 days each |
| **Open standards** (generic plugins) | Any service that exposes **Prometheus `/metrics`**, sends **OpenTelemetry** (traces, metrics, logs), has an **HTTP health URL**, or writes **log files** | **No code**: a few lines of workspace YAML |

Infrabot gets deep plugins for everything it runs. A new SaaS product starts on the open-standards path on day one, and gets deep plugins only for the tools it really needs.

### Scope boundary

devdeck is **developer-side observability and control** for local and dev environments: see it, understand it, act on it, next to the code. It is **not** a replacement for a production monitoring stack (Grafana + Prometheus + Loki/Tempo, SigNoz, OpenObserve) with long retention and on-call paging. For production, devdeck **links to or reads from** those systems through the same open standards, and doesn't rebuild a time-series database. That keeps devdeck small, and it's a sharper story for other products: "the developer cockpit that speaks OTel".

---

## 2. Infrabot's real tool inventory (scanned 2026-10-17)

| Area | Tool | Where it's used | Version / ports |
|---|---|---|---|
| **Languages** | Go | 12 repos (analytics, auth, automation, backend, catalog, ipam, ticket, license-validator, licensing-portal, utils, …) | Go 1.23 → 1.26.6 (mixed); Echo ×7, Gin ×2, zerolog ×10 |
| | Node · TypeScript · React · Vite | infrabot-frontend, infrabot-licensing-frontend, infrabot-keycloak-service (keycloakify) | Vite, ESLint |
| | Python | infrabot-orchestrate-agents (`agent-backend`: FastAPI, uvicorn, asyncpg, psycopg2, nats-py; `adk-*` tools) | FastAPI ≥ 0.111 |
| | Ansible | infrabot-automation-scripts, automation-service | playbooks |
| | Terraform | infrabot-automation-service | modules |
| | Shell / PowerShell | migration and setup scripts (`run_migrations.sh`, `apply-postgres-schema.ps1`, …) | |
| **Databases** | PostgreSQL | nearly every Go service (pgx/v5), Python agents | 15.7 / 16-alpine |
| | MySQL | backend, ticket, utils, licensing-portal (go-sql-driver); catalog has `schema/mysql` | |
| | PgBouncer | keycloak-service compose | latest |
| **Messaging** | **NATS + JetStream** | 8 Go repos + nats-py; subjects `ticket.*`, `automation.*` (e.g. `automation.run.failed`) | 2.10-alpine, client :4222, monitoring :8222 (if enabled) |
| **Object storage** | **Garage** (S3-compatible) | backend storage, Helm chart | v0.9.4 (compose), v1.0.1 (Helm); S3 :3900, admin :3903 |
| **Secrets** | **OpenBao** (Vault-compatible) | backend secret brokering (`hashicorp/vault/api` + `openbao/api/v2`) | latest (compose), quay.io/openbao/openbao (Helm) |
| | AWS Secrets Manager | backend-service | SDK v2 |
| **Identity** | Keycloak | auth (realm per tenant), keycloak-config-cli, keycloakify theme | 26.2.5 |
| **Gateway** | Apache APISIX | infrabot-api-service | pinned digest |
| **Mail** | MailHog | dev SMTP catcher | v1.0.1 |
| **Web** | nginx | frontend serving | 1.27-alpine |
| **Delivery** | Docker / Compose, Helm (EKS) | every service; `eks_deployment` chart | |

Findings worth fixing (outside devdeck, but devdeck will surface them):
- **Go versions drift** across repos (1.23 to 1.26.6). The Go plugin should flag it.
- **`:latest` tags** for OpenBao, PgBouncer and Keycloak in some compose files make local setups non-reproducible. Doctor should warn.
- **Garage version differs** between local (v0.9.4) and Helm (v1.0.1). Fine for the admin API (both v1), but devdeck should show it.

---

## 3. What every plugin can provide (the observability contract)

| Capability | Meaning | SDK interface |
|---|---|---|
| **Detect** | Find the tool in a workspace: compose images, Helm values, `.env` keys (`NATS_URL`, `VAULT_ADDR`…), `go.mod`/`package.json`/`requirements.txt` | `Detector` |
| **Health** | up / degraded / down, with a reason | `HealthChecker` |
| **Metrics** | numeric series (rates, sizes, lag) into the metrics store | `MetricsSource` |
| **Logs** | a parser for the tool's log format | `LogParser` |
| **Explore** | its own page in the UI to browse the tool's state | `Explorer` (API routes + page schema) |
| **Act** | actions usable as buttons and as flow steps | `ActionRunner` |
| **Events** | things worth a notification ("stream consumer lagging") | `EventSource` |
| **Claude** | read-only tools exposed through the devdeck MCP server | `McpTools` |
| **Connect** | credentials stored in the keyring, with a connection test | `ConnectionTester` |

New in the SDK compared with §5 of the master plan: `Detector`, `HealthChecker`, `Explorer`, `EventSource`, `McpTools`.

---

## 4. Wave 1: infrabot's core stack (build alongside the MVP and v1.1)

| Plugin | Detect | Health | Metrics | Explore page | Actions (flow steps) | Events | Claude tools |
|---|---|---|---|---|---|---|---|
| **go** | `go.mod` | build ok, tests pass | build time, binary size | module + Go version per repo, version drift, deps with vulns (govulncheck) | build, test, lint, vet, tidy, pprof profile | build failed, Go version drift | `go_versions`, `failing_tests` |
| **node** (TS, Vite, React) | `package.json` | dev server ready, typecheck | bundle size, HMR rebuild time | scripts, outdated deps, Vite errors | install, dev, build, lint, typecheck, test, audit | compile error, audit high | `ts_errors` |
| **python** (FastAPI, uvicorn) | `requirements*.txt`, `pyproject.toml` | uvicorn ready, `/health` | request rate/latency (if exposed) | venv, packages, FastAPI routes (`/openapi.json`) | create venv, install, run, pytest, ruff, pip-audit | import error, startup failure | `fastapi_routes` |
| **postgres** (planned) | compose image, `DB_*` env | `pg_isready`, connections | connections, DB size, slow queries (`pg_stat_statements`) | explorer, console, scripts, migrations (Phase 6) | migrate, dry-run, run script, snapshot | migration failed, too many connections | `describe_table`, `run_select` |
| **nats** (+ JetStream) | `nats:` image, `NATS_URL` | `/healthz` (or client ping) | msgs/s in/out, connections, slow consumers, stream bytes, **consumer lag** | streams, consumers, subjects; **live tap** on `ticket.>` / `automation.>`; message inspector | publish test message, purge/reset consumer (local only) | consumer lag above threshold, slow consumer, stream full | `list_streams`, `consumer_lag`, `recent_messages(subject)` |
| **garage** (S3 + admin API) | `dxflrs/garage` image, S3 endpoint env | `/health` on admin port; layout/quorum status | buckets, objects, bytes per bucket, node status | cluster layout + nodes, buckets, keys (masked), **object browser** (list, preview, download) | create bucket, create/rotate key, set quota, upload test object (local only) | node down, quorum lost, bucket near quota | `list_buckets`, `bucket_usage` |
| **openbao** (also HashiCorp Vault) | `openbao` image, `VAULT_ADDR`/`BAO_*` env | `sys/health`, **sealed?** | token TTL, lease count | mounts, KV v2 tree with **masked values**, policies, auth methods | **unseal (local dev only)**, create dev secret, renew token | sealed, token expiring, health failing | `list_paths` (names only, never values) |
| **keycloak** | Keycloak image, `KEYCLOAK_*` env | `/health/ready` | active sessions, login failures | realms (per tenant), clients, users; **token helper** (plan review F7) | get test token, create test user, export realm | realm import failed, login error spike | `list_realms`, `token_claims` |
| **docker** (planned) | Docker running | engine up, container health | CPU/RAM per container | containers, images, volumes, networks | up/down/restart, prune (confirm) | container exited, OOM-killed | `container_status` |

**Wave 1 order**: go, node, python and docker come with Phases 2–3 (they run the stack). postgres comes with Phase 6. Then **nats → openbao → garage → keycloak** as a new **Phase 6b: Infrastructure explorers** (≈ 3–4 focused weeks).

---

## 5. Wave 2: the rest of infrabot

| Plugin | Why infrabot needs it | Highlights |
|---|---|---|
| **mysql** | 4 Go repos use the MySQL driver; catalog has `schema/mysql` | same explorer, console and migrations as postgres |
| **pgbouncer** | keycloak-service pools through it | pools, waiting clients, `SHOW STATS` |
| **apisix** | infrabot-api-service is the gateway | routes, upstreams + health, plugins per route, request metrics (Prometheus plugin), "which route serves `/api/v1/tickets`?" |
| **mailhog** | dev SMTP catcher | inbox view inside devdeck: see the emails services send |
| **nginx** | frontend serving | config test, access/error log parser |
| **ansible** | automation scripts and playbooks | ansible-lint, syntax check, inventory view, run against a local test target |
| **terraform** | automation-service modules | fmt, validate, tflint, checkov, plan (no apply) |
| **helm** | `eks_deployment` chart | lint, template diff, values diff between local/uat (prepares the later "deploy to dev") |
| **aws-secrets-manager** | backend secret backend | list secret names, never values |

---

## 6. Wave 3: open-standards plugins (the bridge to any SaaS product)

| Plugin | Config (workspace YAML) | What you get |
|---|---|---|
| **http-health** | `url`, interval, expected status/body | up/down + latency for any service |
| **prometheus-scrape** | `url: http://svc:9100/metrics`, interval | any Prometheus metric, charted, with alert rules (Garage, NATS exporter, Keycloak and APISIX all expose this) |
| **otlp-receiver** | built-in endpoint `localhost:4317/4318` | traces, metrics and logs from any OpenTelemetry-instrumented service in any language. Traces enable **"follow a request"** (plan review F6) across services. |
| **log-tail** | file path or glob + parser | logs from anything that writes files |
| **tcp-check** | host:port | basic reachability |
| **declarative HTTP plugin** | a `manifest.yaml` only: health URL, list endpoints, field mappings | a simple explorer page and actions for any tool with a REST API, **without writing Go** |

With Wave 3, onboarding a new SaaS product means: point devdeck at its repos, describe its services in a stack file, turn on OTel or Prometheus. Deep plugins come later, only where needed.

---

## 7. Wave 4+: other stacks (on demand, as other products need them)

Ranked by how common they are in SaaS backends:

| Group | Plugins |
|---|---|
| Caches and queues | Redis / Valkey, RabbitMQ, Kafka / Redpanda |
| Databases | MongoDB, MSSQL, ClickHouse, SQLite, Elasticsearch / OpenSearch |
| Object storage | MinIO, AWS S3, Azure Blob, GCS (mostly the same S3 explorer) |
| Secrets | Azure Key Vault, GCP Secret Manager, Infisical, SOPS files |
| Identity | Auth0, Zitadel, Authentik |
| Gateways / proxies | Traefik, Kong, Envoy, Caddy |
| Workflow | Temporal |
| Platforms | Kubernetes (with the "remote environments" work), Supabase, Firebase emulator |
| Languages | Java/Spring, .NET, Rust, Ruby/Rails, PHP/Laravel |

---

## 8. Safety rules for infrastructure plugins

- **Secrets never leave the explorer.** OpenBao/Vault values, Garage keys and Keycloak secrets are masked by default. Reveal needs a click, re-masks after 30 s, and never goes to logs, notifications or Claude. MCP tools return **names only**.
- **Read-only by default.** Write actions (purge, delete, unseal, rotate) are **local-environment only** in v1, confirm in place, and show the exact command or API call first.
- **Least-privilege connections.** Use separate tokens: a read-only Garage key, a read-only OpenBao policy for browsing, NATS credentials without publish rights for the tap.
- **No production.** Explorer write actions are disabled on any connection tagged `uat`/`prod`.

---

## 9. UI additions

- **New sidebar group "Infrastructure"**: Messaging (NATS) · Object storage (Garage) · Secrets (OpenBao) · Identity (Keycloak) · Gateway (APISIX) · Mail (MailHog). Each is one plugin's explorer page, built with the same Quiet Instrument kit.
- **Tool map page**: every tool the workspace uses (from Detect), its version, health, and **plugin coverage** (deep / standard / none), so gaps are visible.
- **Home 3D map**: infrastructure nodes (nats, garage, openbao, keycloak, apisix) get their real health and metrics from their plugins, and edges carry real traffic (NATS msgs/s, request rates from OTel).
- Mockup pages for these are drawn after branch `plan/notification` merges (both touch `ui-mockup/nav.js` and `plugins.html`).

---

## 10. Adding a plugin: the process

1. **Pick the level.** L0 = YAML only (Wave 3 generic plugins). L1 = declarative HTTP manifest. L2 = Go plugin with an explorer. L3 = deep integration (actions, events, Claude tools).
2. **Write a one-page plugin plan** in `dev-plans/plugins/<tool>.md`: detect, health, metrics, explorer, actions, events, safety.
3. **Implement** in `plugins/<tool>/` + one registry line, with fixture tests (recorded API responses) and a testcontainers integration test.
4. **Done when**: detected automatically in the infrabot workspace, health and metrics visible on Home, explorer page works in both themes, secrets masked, write actions blocked on non-local connections.

---

## 11. Changes to fold into the master plan (after `plan/notification` merges)

| Where | Change |
|---|---|
| §1 Goals | Add: "observability + control for infrabot first, then any SaaS product, via deep plugins and open standards (OTel, Prometheus)" |
| §5 Plugin SDK | Add `Detector`, `HealthChecker`, `Explorer`, `EventSource`, `McpTools`; list Wave 1–2 plugins |
| §8 Phases | New **Phase 6b: Infrastructure explorers** (nats, openbao, garage, keycloak) after Phase 6; **Phase 7b: Open standards** (http-health, prometheus-scrape, otlp-receiver, log-tail, declarative HTTP plugin) after Phase 7; Wave 2 plugins spread over v1.2–v1.3 |
| §12 Later | Wave 4 plugins; integration with production observability backends (read/link, not replace) |
| New feature | **Flow trace** across HTTP, NATS, DB and Ansible: see [`04-flow-trace.md`](04-flow-trace.md) (Phase 6c v1, v2 with 7b, v3 with 7) |

---

Sources for API details: [Garage admin API (v1 since 0.9.0, v2 since 2.0.0; bearer admin token; `/health`)](https://garagehq.deuxfleurs.fr/documentation/reference-manual/admin-api/) · [NATS monitoring endpoints (`/varz`, `/connz`, `/jsz`, `/healthz`; off unless `http_port` is set)](https://docs.nats.io/running-a-nats-service/nats_admin/monitoring) · [OpenBao: API-compatible with HashiCorp Vault](https://openbao.org/api-docs/relatedtools/)
