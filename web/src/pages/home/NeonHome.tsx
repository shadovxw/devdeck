import { RotateCcw } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Panel } from "../../design/Panel";
import { SectionHeader } from "../../design/SectionHeader";
import { ServiceStateMark } from "../../design/ServiceStateMark";
import { StageRail } from "../../design/StageRail";
import { StatusStrip, type StripItem } from "../../design/StatusStrip";
import { stagger } from "../../lib/motion";
import { formatUptime, isProblem, serviceLabel, tally } from "../../lib/runs";
import type { RunState, RunStatus, ServiceState } from "../../lib/types";
import { ProblemRow, StopAll } from "./parts";

const two = (n: number) => String(n).padStart(2, "0");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Good morning" before noon, "Good afternoon" until six, "Good evening" after. */
export function greeting(date: Date): string {
  const h = date.getHours();
  if (h < 5 || h >= 18) return "Good evening";
  return h < 12 ? "Good morning" : "Good afternoon";
}

/** "SUN 22 NOV", in the language of the page. */
export function shortDate(date: Date): string {
  const day = date.toLocaleDateString("en-GB", { weekday: "short" });
  const rest = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day} ${rest}`.toUpperCase();
}

/** How a whole stack is shown: the service mark it borrows and its word. */
const runLook: Record<RunState, { mark: ServiceState; word: string }> = {
  running: { mark: "ready", word: "Running" },
  starting: { mark: "starting", word: "Starting" },
  degraded: { mark: "failed", word: "Degraded" },
  stopping: { mark: "stopping", word: "Stopping" },
  stopped: { mark: "stopped", word: "Stopped" },
};

/** A stack as a card: its place and status, its name, three numbers, and its services as a rail. */
function StackCard({ run, index, now }: Readonly<{ run: RunStatus; index: number; now: number }>) {
  const look = runLook[run.state];
  const ports = run.services.flatMap((s) => (s.port ? [s.port] : (s.ports ?? [])));
  const shown = ports.slice(0, 3).map((p) => `:${p}`);
  if (ports.length > 3) shown.push(`+${ports.length - 3}`);
  const started = Date.parse(run.started_at);
  // The rail is the services in start order: done up to the first one that isn't ready.
  const firstNotReady = run.services.findIndex((s) => s.state !== "ready");
  const done = firstNotReady === -1 ? run.services.length : firstNotReady;
  const stuck = run.services.some(isProblem);
  return (
    <article data-ui="stack-card" aria-label={`${run.stack} in ${run.workspace}`} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2">
          <span data-ui="card-label" className="truncate">
            [{index}] // {run.workspace}
          </span>
          <span data-ui="card-state">
            <ServiceStateMark state={look.mark} text={look.word} />
          </span>
        </div>
        <h3 data-ui="card-title" className="m-0 truncate">
          <Link to={`/stacks?workspace=${encodeURIComponent(run.workspace)}`}>{run.stack}</Link>
        </h3>
      </div>
      <dl data-ui="card-facts" className="m-0 flex flex-wrap gap-5">
        <div>
          <dt>Services</dt>
          <dd>{run.services.length}</dd>
        </div>
        <div>
          <dt>Ports</dt>
          <dd>{shown.length > 0 ? shown.join(" ") : "—"}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{Number.isNaN(started) || run.state === "stopped" ? "—" : formatUptime(now - started)}</dd>
        </div>
      </dl>
      <StageRail stages={run.services.map((s) => serviceLabel(s.id))} done={done} warn={stuck} compact={run.services.length > 6} />
    </article>
  );
}

type Props = {
  runs: RunStatus[];
  now: number;
  live: boolean;
  restarting?: string;
  onRestart: (run: RunStatus, service: string) => void;
  onRestartFailed: () => void;
  restartBusy: boolean;
};

/**
 * Home in the Neon style (dev-plans/2026-11-21-portfolio-look §4): a compact header (kicker,
 * greeting, summary, status strip), the running stacks as cards, and what needs a look. It uses
 * only what devdeck knows; nothing is filled in for show.
 */
export function NeonHome({ runs, now, live, restarting, onRestart, onRestartFailed, restartBusy }: Readonly<Props>) {
  const t = tally(runs);
  const failed = runs.flatMap((run) => run.services.filter(isProblem).map((service) => ({ run, service })));
  const troubled = runs.filter((r) => r.services.some(isProblem)).length;
  const workspaces = [...new Set(runs.map((r) => r.workspace))];
  const where = workspaces.length === 1 ? workspaces[0] : `${workspaces.length} workspaces`;
  const date = new Date(now);
  const summary = `${plural(t.stacks, "stack")} up, ${troubled === 0 ? "all ready" : `${troubled} ${troubled === 1 ? "needs" : "need"} a look`}.`;

  const strip: StripItem[] = [
    { key: "Live", value: live ? "On" : "Reconnecting", tone: live ? "live" : "warn" },
    { key: "Stacks", value: two(t.stacks) },
    { key: "Services", value: `${t.ready}/${t.services} ready`, tone: t.ready === t.services ? "ok" : "warn" },
    { key: "Problems", value: two(t.problems), tone: t.problems === 0 ? "ok" : "bad" },
  ];

  return (
    <div data-ui="neon-home" className="flex flex-col gap-10">
      <header className="enter flex flex-wrap items-center justify-between gap-x-8 gap-y-4" style={stagger(0)}>
        <div className="flex min-w-0 flex-col gap-2">
          <div data-ui="kicker">
            Workspace · {where} · {shortDate(date)}
          </div>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
            <h1 data-ui="greeting" className="m-0">
              {greeting(date)}
              <span aria-hidden>.</span>
            </h1>
            <p data-ui="greeting-summary" className="m-0">
              {summary}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div data-ui="strip-box">
            <StatusStrip label="Status" items={strip} />
          </div>
          <div className="flex items-center gap-2">
            <StopAll runs={runs} />
            {failed.length > 0 && (
              <Button disabled={restartBusy} onClick={onRestartFailed}>
                <RotateCcw aria-hidden />
                Restart failed
              </Button>
            )}
          </div>
        </div>
      </header>

      <section aria-label="Running stacks" className="enter flex flex-col gap-4" style={stagger(1)}>
        <SectionHeader index="01" verb="UP" name="STACKS" count={{ label: "TOTAL_STACKS", value: two(t.stacks) }} title="Running stacks" />
        <div data-ui="card-grid" className="mt-1 grid gap-4">
          {runs.map((run, i) => (
            <StackCard key={`${run.workspace}/${run.stack}`} run={run} index={i + 1} now={now} />
          ))}
        </div>
      </section>

      {failed.length > 0 && (
        <div className="enter" style={stagger(2)}>
          <Panel title="Needs a look" kicker="02 $" label="Services that need a look">
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {failed.map(({ run, service }) => (
                <ProblemRow
                  key={`${run.workspace}/${run.stack}/${service.id}`}
                  run={run}
                  service={service}
                  busy={restarting === service.id}
                  onRestart={() => onRestart(run, service.id)}
                />
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}
