# Flow trace: follow one request across every repo, without print statements

> 2026-11-21 · owner: Vrishank Warrier · replaces [`04-flow-trace.md`](../04-flow-trace.md) (written for one product before the public-repo rule; its ideas are kept here in general form) · milestone H12 of the [hub plan](../2026-11-21-desktop-hub/plan.md), **built last** by the owner's choice · status: **plan. Nothing built.**

## 1. The job

A feature runs from a frontend through three or four services and back, over **HTTP** and **NATS** (and a database or two). When it breaks or is slow, the owner should see, for one real request:

1. **The path:** every hop in order (frontend → service → NATS → service → HTTP → …), with timing.
2. **Where it stopped or slowed:** the first error, a message nobody consumed, the slowest step, or a gap where nothing happened.
3. **Why:** the log lines of each hop, the `file:line`, and the code behind each step.

No print statements, no five terminals, and it keeps working for every new feature without new effort.

## 2. The approach, and why it is the right one

**Distributed tracing with OpenTelemetry, received and shown by devdeck itself.** Every service is instrumented **once**, in its shared library, with the industry standard (OpenTelemetry, W3C trace context). From then on every request carries a trace id through HTTP headers and NATS message headers, every hop reports a *span* (what, where, when, how long, error), and every log line carries the same trace id. devdeck is the local receiver: it stores the spans next to the logs it already collects and draws the whole request.

Why this and not something else:

| Option | Verdict |
|---|---|
| **Print or log statements** | Shows lines, not causality: no reliable order across services, nothing for async NATS hops, and it has to be redone for every feature. |
| **Joining logs by a business id** (an order or job id) | Works with no code changes, and stays as the day-one fallback (§5, level 0). Breaks on calls that don't carry that id, and gives no timing tree. |
| **A correlation id only** (one id passed along and logged) | Better, but it is a home-made half of OpenTelemetry: no spans, no timing, no parent/child. If services are being touched anyway, do it properly once. |
| **OpenTelemetry + devdeck as receiver** | **Chosen.** The standard: libraries exist for Go HTTP, gRPC, SQL and the browser; any viewer can read the same data; the effort is once per service, in shared code. devdeck adds what generic viewers lack: the link to logs it already has, to the stacks it runs, to code (Code map, hub §4.11) and to Claude. |
| **eBPF auto-instrumentation** (Grafana Beyla, OpenTelemetry eBPF) | No code changes, but **Linux only**: it can't see services devdeck runs directly on Windows, and it covers HTTP and gRPC, not NATS message headers. Not the base; maybe later for services in Docker. |
| **A full platform** (SigNoz, OpenObserve, Uptrace, Grafana Tempo, Jaeger) | Built for teams and production: several containers, a database, more than one PC needs, and none of them know devdeck's stacks or logs. devdeck still **exports** to them on request (§3.7), so nothing is locked in. |
| **Embedding a local viewer** (otel-desktop-viewer, otel-tui) | Good ideas to borrow (one binary, local only), but otel-desktop-viewer needs CGO and DuckDB, and devdeck is pure Go on purpose. |

## 3. Decisions

1. **Standards only.** W3C trace context (`traceparent`) on HTTP, the same in NATS message headers, OTLP as the wire format. Services use the official OpenTelemetry SDKs; nothing devdeck-specific is needed in a service except the endpoint.
2. **devdeck is the OTLP endpoint.** It accepts OTLP over HTTP (`:4318`, protobuf and JSON) and gRPC (`:4317`), built with OpenTelemetry's Go protocol types: pure Go, no Collector to run. It listens on loopback, and only accepts OTLP there. Services in Docker reach it through `host.docker.internal`; how that meets the loopback rule is settled in the first PR (an allowed source on the OTLP port only, never on the main API).
3. **Zero setup for stacks devdeck runs.** The supervisor already sets each service's environment; it adds `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` (the service id), `OTEL_RESOURCE_ATTRIBUTES` (workspace, stack) and `OTEL_TRACES_SAMPLER=always_on`, unless the service sets its own. Compose services get the same through devdeck's compose override.
4. **Async hops are first-class.** A NATS publish is a *producer* span, the consumer's handling a *consumer* span with the publisher as its parent (or a link, for fan-out and JetStream redelivery). A service that publishes through an **outbox** stores the trace context in the outbox row, so the relay publishes it with the original context; otherwise the trace breaks at the outbox.
5. **Logs join traces by id.** Services add `trace_id` and `span_id` to every log line (a small logging hook); devdeck already parses JSON logs, so a span shows its log lines and a log line links to its trace.
6. **Stored locally, briefly.** Spans go into devdeck's SQLite store, indexed by trace id, service and time, with a size and age limit (default: last 24 hours or 200 MB, whichever first). Nothing is sent anywhere unless the owner adds an export.
7. **Export, optional.** devdeck can forward what it receives to another OTLP endpoint (a local Jaeger, a team platform). Off by default.
8. **Redaction before storage.** Headers such as `Authorization`, `Cookie` and `Set-Cookie`, attributes named like secrets, and query strings with tokens are dropped or masked on the way in, with the same rules as the logs. SQL is stored as the parameterised statement, never with values. Secret values are never stored, shown, or given to Claude.
9. **One data shape for the view** (`FlowTrace`, from the old plan §10): the page, sample data and Claude all use it. Claude can read a trace through the connector (names and ids only) and explain it; it never sends UI code (old plan §10.3 stands).

## 4. What the owner sees (the Flow trace page)

- **Recent requests:** one row per trace: what started it (a frontend action or an HTTP route), duration, status, the services it touched. Filters: service, route, status, "slow", "failed", and the **ids the workspace marks as business ids** (an order id, a job id), so "show me what happened to order 123" works.
- **The verdict:** a one-line answer at the top, from the detection rules (§4.1), then the evidence.
- **Waterfall and lanes:** one lane per service, spans as bars, NATS hops as arrows from publisher to consumer, waits shown as gaps; zoom to all, start, or the failure.
- **Selected step:** its attributes (route, status, subject, query), its **log lines** (from devdeck's logs, by trace id), its `file:line`, **Open in VS Code** there (switchboard), and its code in the Code map.
- **Compare:** this request beside the last good one of the same route: what got slower, what is missing.
- **Ask Claude:** "explain this trace" opens a Claude session (switchboard) with the trace summary and the failing step filled in.

### 4.1 Detection rules (the verdict)

| Rule | Verdict |
|---|---|
| First error | the earliest span or log with an error: that service and step |
| HTTP error | a 4xx/5xx on any hop: the service and route |
| Published, never consumed | a producer span with no consumer span within the step's time limit: "stuck at the hand-off from A to B" |
| No consumer | the NATS tap (level 0) sees no consumer on that subject: "nobody is listening on `<subject>`" |
| Redelivery loop | the same message consumed 3+ times: "B keeps failing on this message", with its errors |
| Slow, not failed | over the route's usual time (from earlier traces): the slowest span |
| Outside | the failure is in a call to something devdeck doesn't run: "outside your services: `<host>`" |

## 5. Levels (each works on its own)

- **Level 0, no service changes:** logs joined by the workspace's business ids across every service, in time order; a read-only **NATS tap** on the subjects the workspace lists (messages, consumers, pending, redeliveries). Gives "published but never consumed" and "no consumer" before any instrumentation.
- **Level 1, OpenTelemetry in the services:** the waterfall, timing, async hops, logs by trace id.
- **Level 2, frontend:** OpenTelemetry's web SDK with fetch instrumentation, so a trace starts at the click and the `traceparent` header goes to the backend (CORS must allow it). The gateway in between must pass the header through.

## 6. Instrumenting a service (once, in the shared library)

devdeck ships a guide (`docs/flow-trace.md`) and small, generic Go helpers in its public `sdk/` (no product names):

- HTTP server and client: `otelhttp` from `opentelemetry-go-contrib` (Echo and Gin have their own middleware there too).
- NATS: there is no official OpenTelemetry package for NATS, so devdeck provides one (`sdk/otelnats`): wrap publish, request and subscribe (core and JetStream) to inject and extract `traceparent` in `nats.Header`, with producer and consumer spans. About a hundred lines with tests.
- Database: the driver's tracer (`otelsql`, or pgx's tracer).
- Logs: a zerolog hook that adds `trace_id` and `span_id`.
- Outbox: store and restore the trace context with the event (decision 4).

## 7. Order of work (last milestone; small PRs)

| PR | What | Done when |
|---|---|---|
| F1 | `FlowTrace` type and schema, the page on **sample data** (lanes, events, detail, verdict) | the page works by keyboard on a failed and a stuck sample |
| F2 | Level 0: logs joined by business ids; the read-only NATS tap | a stuck sample stack shows "published, never consumed" with no service changes |
| F3 | The OTLP receiver (HTTP and gRPC), redaction, storage with limits, the recent-requests list | a demo service sends spans and they list within a second |
| F4 | Supervisor sets the `OTEL_*` variables; waterfall from real spans; logs by trace id | a request across two demo services shows as one waterfall with each hop's logs |
| F5 | `sdk/otelnats` and the instrumentation guide; async hops and the NATS rules | a request that crosses NATS stays one trace, and a missing consumer is the verdict |
| F6 | Compare with the last good run, Ask Claude, Code map links, optional export | a slow request shows what got slower than the last good one |

Demo services for tests and the guide are neutral (`demo-api`, `demo-worker`, `demo-web`), in `examples/`.

## 8. Risks

- **Work happens in the services, not only in devdeck.** Level 0 gives value first; level 1 is a one-time change per shared library.
- **Docker and the loopback rule:** settled in F3 for the OTLP port only.
- **Volume:** a busy local stack can produce many spans; the limits (decision 6) and sampling per service keep it small.
- **Clock skew** between containers and the host can misorder spans by milliseconds; parent/child order wins over timestamps in the view.

## 9. Open questions

1. Which ids should count as business ids for search (order, job, ticket…), per workspace?
2. Default limits: 24 hours / 200 MB, or more?
3. Should devdeck offer a one-click **Jaeger** stack for comparing with the standard viewer, or only the export?
