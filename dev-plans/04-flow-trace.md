# devdeck: Flow Trace

> 2026-10-17 · owner: Vrishank Warrier · new feature for [`00-implementation-plan.md`](00-implementation-plan.md)
> Design sample: [`ui-design/flow-trace.html`](../ui-design/flow-trace.html)

---

## 1. The job

When an infrabot workflow (for example **Linux hardening**) doesn't finish, show **which service broke it, where, and why**, in seconds, across HTTP calls, NATS messages, database state and the Ansible run, without opening five terminals.

Answer three questions for any flow:
1. **Where did it stop?** The workflow node, the service and the exact step.
2. **Why?** The first error, its log line and `file:line`, or the gap where nothing happened.
3. **Was it us or the outside world?** Code bug, a message nobody consumed, a slow dependency, or an unreachable target.

---

## 2. How an infrabot flow travels (Linux hardening)

```
Frontend ─HTTP─▶ APISIX (request-id) ─▶ ticket-service
                                          │ workflow_execution + workflow_execution_step
                                          │ event_outbox ─▶ relay
                                          ▼
                                   NATS ticket.updated
                                          ▼
                                   automation-service ─HTTP─▶ catalog (playbook)
                                          │           └─HTTP─▶ backend ─▶ OpenBao (SSH credentials)
                                          │ job → Ansible run ─SSH─▶ target host
                                          ▼
                       NATS automation.run.started / progress / completed | failed
                                          ▼
                                   ticket-service → next node → notification
```

**What infrabot already gives us (scanned 2026-10-17):**
- NATS payloads carry `ticket_id` (72×), `node_code`, `tenant_id`, `job_id`, `execution_id` and `step_id`. Logs carry `ticket_id` (43×), `job_id` (22×) and `node_code` (14×).
- The workflow state is in the database: ticket `workflow_execution(_step)`, and automation `jobs`, `job_steps`, `job_events` and `execution_reports`.
- APISIX has the `request-id` plugin.
- `infrabot-utils` has OpenTelemetry trace middleware (`httpserver/middleware/tracecontext.go`) and metrics, but **no service imports them**.
- NATS publishes carry **no headers**, and `event_outbox` stores only `subject` and `payload`.

---

## 3. Six data sources (the approaches)

| # | Source | What devdeck reads | infrabot changes | Shows |
|---|---|---|---|---|
| **1** | **Workflow DB** | ticket `workflow_execution(_step)` + automation `jobs`, `job_steps`, `job_events`, joined by `ticket_id` → `step_id` → `job_id` | none | the workflow graph: each node's status, start/end, which node is stuck |
| **2** | **NATS tap** | read-only subscription to `ticket.>`, `automation.>` (+ `agent.>`); JetStream consumer info (pending, ack-pending, redeliveries, active consumers) | none | every message hop and its order; "published but never consumed"; redelivery loops |
| **3** | **Logs by business IDs** | the logs plugin filtered by `ticket_id` / `job_id` / `execution_id` across all services | none | the actual error line and `file:line` |
| **4** | **Correlation ID** | a `flow_id` from APISIX `request-id`, carried in HTTP headers **and NATS headers**, logged by every service | small: one Echo/Gin middleware + one NATS publish/subscribe wrapper in `infrabot-utils` | joins calls that don't carry `ticket_id` (catalog lookups, secret fetches) |
| **5** | **OpenTelemetry traces** | the OTLP receiver (plugin catalog Wave 3) | medium (see §6) | a real waterfall: every call, query and wait, with exact timing |
| **6** | **Synthetic flow test** | devdeck starts a test hardening workflow against a dummy target and checks each node finishes within its time budget | none (uses the public API + a test tenant/target) | breakages before users hit them; doubles as a pre-PR / nightly flow step |

Sources 1–3 work **today with zero infrabot changes**. Sources 4–5 make the picture exact. Source 6 checks it continuously.

---

## 4. Correlation: how pieces are joined

```
request-id (APISIX) ──▶ ticket_id ──▶ workflow_execution.id ──▶ step_id (node) ──▶ job_id ──▶ ansible run
        │                    │                                                       │
     HTTP spans         NATS payloads + logs                                   job_events, logs
```

- A **flow** is keyed by `ticket_id` (or `execution_id`). devdeck walks the chain above to gather every related record.
- With source 4 or 5, the `flow_id` / `trace_id` becomes the primary key and the business IDs are attached as attributes.
- **Generic for any SaaS product**: correlation is declared in workspace YAML, not hard-coded:

```yaml
flows:
  workflow-execution:
    key: ticket_id
    db:
      - conn: postgres-local
        db: infrabot_ticket_db
        query: workflow_execution_by_ticket   # saved script
      - conn: postgres-local
        db: infrabot_automation
        query: jobs_by_ticket
    nats: ["ticket.>", "automation.>"]
    logs: { fields: [ticket_id, job_id, execution_id] }
    budgets: { Execution: 15m, Approval: 24h, default: 2m }
```

---

## 5. Detection rules

| Rule | Example | Verdict shown |
|---|---|---|
| **First error** | the earliest record with level=error / status=failed | culprit = that service and step |
| **Unconsumed message** | `ticket.updated` published, consumer `automation-intake` pending ≥ 1, no `automation.run.started` after the step budget | "stuck at hand-off ticket → automation; automation consumer not pulling" |
| **No consumer** | JetStream reports 0 active consumers for a subject | "nobody is listening on `ticket.updated`" (automation-service down or subscriber crashed) |
| **Redelivery loop** | the same message is redelivered ≥ 3 times | "automation keeps failing on this message" + its error logs |
| **Budget exceeded** | a node is running longer than its budget (Execution 15 m) | "slow, not failed" + the slowest span |
| **External** | a failure inside the Ansible run (UNREACHABLE, auth failed) | "outside infrabot: target-07 unreachable on :22" |
| **HTTP error** | a 5xx/4xx on any hop (APISIX log, span, or log line) | the service and route |

The verdict is a one-line pill at the top of the page. Everything else is evidence.

---

## 6. infrabot changes for sources 4 and 5 (separate infrabot work, its own plan)

1. **Wire the existing `infrabot-utils` middleware** into every Echo/Gin service (trace context in and out, request-id → logs).
2. **NATS propagation**: one publish wrapper that injects `traceparent` + `flow_id` into NATS headers, and one subscribe wrapper that extracts them (Go `nats.Header`, Python `nats-py` headers).
3. **Outbox**: add a `headers` column to `event_outbox`. The relay publishes with those headers, otherwise the trace breaks at the outbox.
4. **DB spans**: `otelpgx` for pgx; MySQL driver wrapper where used.
5. **Ansible**: emit one span per playbook/task (callback plugin or automation-service wrapper).
6. **APISIX**: enable the `opentelemetry` plugin. **FastAPI agents**: `opentelemetry-instrumentation-fastapi` + nats-py headers.
7. **Exporter**: OTLP to devdeck locally, and to Grafana Tempo / SigNoz in production (same code, different endpoint).

---

## 7. UI (Flow trace page)

Minimal text, as everywhere (design system §2.2a):

| Area | Content |
|---|---|
| **Header** | search (ticket / execution / job id) · recent flows as chips with status icons · verdict pill · total duration · ▶ replay · test flow · source chips (DB · NATS · Logs · Traces) showing which sources are live |
| **Workflow strip** | the workflow nodes (Operation → Form → Targets → Approval → Execution → Notify) with status and time |
| **Swimlanes** | one lane per service (frontend, apisix, ticket, nats, automation, catalog, backend, openbao, target); spans as bars; NATS hops as arrows between lanes; the culprit lane highlighted; gaps shown as hatched "waiting" segments; zoom presets (all · start · failure) |
| **Events** | the merged timeline from all sources, each row tagged DB / NATS / LOG / SPAN / TEST; click to select |
| **Detail** | the selected item: payload with IDs, log line, `file:line` → VS Code, consumer stats, buttons (open logs, open service, re-run step) |
| **Replay** | a light pulse travels the hops in order, the signature motion for this page |

From Home: a failed or stuck flow in Activity links straight here, and the 3D map can highlight the flow's path.

---

## 8. Phasing

| Step | Needs | Delivers |
|---|---|---|
| **Flow trace v1** (new Phase 6c, ≈ 1–1.5 weeks) | Phase 3 (logs), Phase 6 (postgres plugin), Phase 6b (nats plugin) | sources 1 + 2 + 3, detection rules, the page with reconstructed spans |
| **Flow trace v2** (with Phase 7b, ≈ 1 week in devdeck) | OTLP receiver (Wave 3) + infrabot work from §6 | sources 4 + 5, real waterfall, exact timings |
| **Flow trace v3** (with Phase 7, ≈ 3–5 days) | flow engine | source 6 as a flow step (`flow-test`), nightly and pre-PR |

**Done when (v1)**: for a failed Linux-hardening run, the verdict pill names the right service and step within 2 seconds of opening the page; a stuck flow (automation consumer down) shows the "unconsumed message" verdict; every verdict links to the evidence (log line, message, DB row).

---

## 9. Changes to fold into the master plan (after `plan/notification` merges)

- §1 Goals: "trace any workflow end to end across HTTP, NATS, DB and Ansible".
- §4 Data model: `Flow` (definition in YAML), `FlowRun` (cached reconstruction), `FlowVerdict`.
- §6 API: `GET /flows/:def/runs?key=` · `GET /flows/:def/runs/:key` (merged timeline) · `POST /flows/:def/test`.
- §8 Phases: Phase 6c Flow trace v1, plus v2 in Phase 7b and v3 in Phase 7.
