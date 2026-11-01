import { RotateCcw, Square, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Layers } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { ServiceStateMark } from "../design/ServiceStateMark";
import { StatusDot } from "../design/StatusDot";
import { stagger } from "../lib/motion";
import { useRestartService, useRuns, useStopStack, useWorkspaces } from "../lib/queries";
import { formatUptime, isProblem, serviceLabel, tally } from "../lib/runs";
import { useSocketStatus } from "../lib/socket";
import type { RunStatus, ServiceStatus } from "../lib/types";
import { useNow } from "../lib/use-now";

/** A big number under a small mono label (dev-plans/02-frontend-design-system.md, the `metric` style). */
function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="font-mono text-[11px] uppercase leading-[14px] tracking-[0.06em] text-ink-3">{label}</dt>
      <dd className="m-0 flex items-baseline gap-2 text-[32px] font-semibold leading-[34px] tracking-[-0.03em] tabular-nums text-ink">{children}</dd>
    </div>
  );
}

const unit = "text-[13px] font-normal tracking-normal text-ink-3";

/** A service that needs attention, pinned above the others with its one action. */
function ProblemRow({ run, service, busy, onRestart }: { run: RunStatus; service: ServiceStatus; busy: boolean; onRestart: () => void }) {
  const name = serviceLabel(service.id);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-inset px-3.5 py-3">
      <span className="w-28 shrink-0 text-[13px]">
        <ServiceStateMark state={service.state} />
      </span>
      <span className="font-mono text-[13px] font-medium text-ink">{name}</span>
      {service.last_error && <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={service.last_error}>{service.last_error}</span>}
      <span className="flex-1" />
      <Button size="sm" disabled={busy} onClick={onRestart} aria-label={`Restart ${name} in ${run.stack}`}>
        Restart
      </Button>
    </li>
  );
}

/** One healthy or idle service: dot, name, port and how long it has been up. */
function ServiceRow({ service, now }: { service: ServiceStatus; now: number }) {
  return (
    <li className="flex items-center gap-4 px-3.5 py-1.5">
      <ServiceStateMark state={service.state} label={false} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{serviceLabel(service.id)}</span>
      {service.port && service.state === "ready" ? (
        <a
          href={`http://127.0.0.1:${service.port}`}
          target="_blank"
          rel="noreferrer"
          title={`Open http://127.0.0.1:${service.port}`}
          className="font-mono text-[11px] tabular-nums text-link hover:underline"
        >
          :{service.port}
        </a>
      ) : service.port ? (
        <span className="font-mono text-[11px] tabular-nums text-ink-3">:{service.port}</span>
      ) : null}
      <span className="w-16 text-end font-mono text-[11px] tabular-nums text-ink-3">
        {service.state === "ready" && service.ready_at ? formatUptime(now - Date.parse(service.ready_at)) : service.state === "stopped" ? "stopped" : ""}
      </span>
    </li>
  );
}

function RunServices({ run, now, restarting, onRestart }: { run: RunStatus; now: number; restarting?: string; onRestart: (service: string) => void }) {
  // Problems first, as their own rows; the rest keep the order the stack starts them.
  const problems = run.services.filter(isProblem);
  const rest = run.services.filter((s) => !isProblem(s));
  return (
    <section aria-label={`Services in ${run.stack}`}>
      <h2 className="m-0 mb-3 flex items-baseline gap-3 text-[14px] font-semibold leading-5 text-ink">
        <Link to={`/stacks?workspace=${encodeURIComponent(run.workspace)}`} className="hover:underline">
          {run.stack}
        </Link>
        <span className="font-mono text-[11px] font-normal text-ink-3">
          {run.workspace} · {run.services.length} services
        </span>
      </h2>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {problems.map((s) => (
          <ProblemRow key={s.id} run={run} service={s} busy={restarting === s.id} onRestart={() => onRestart(s.id)} />
        ))}
      </ul>
      <ul className="m-0 mt-3 list-none p-0">
        {rest.map((s) => (
          <ServiceRow key={s.id} service={s} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** Stops every running stack. The first click asks; a second one within 3 seconds does it. */
function StopAll({ runs }: { runs: RunStatus[] }) {
  const stop = useStopStack();
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const timer = setTimeout(() => setSure(false), 3000);
    return () => clearTimeout(timer);
  }, [sure]);
  return (
    <Button
      variant="secondary"
      onClick={() => {
        if (!sure) return setSure(true);
        setSure(false);
        for (const r of runs) stop.mutate({ workspace: r.workspace, stack: r.stack });
      }}
    >
      <Square aria-hidden />
      {sure ? "Confirm stop all?" : "Stop all"}
    </Button>
  );
}

export function HomePage() {
  const item = navByPath("/");
  const runs = useRuns();
  const workspaces = useWorkspaces();
  const restart = useRestartService();
  const list = runs.data ?? [];
  const now = useNow(list.length > 0);
  const t = tally(list);
  const socket = useSocketStatus();

  if (runs.isPending) {
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <div role="status" aria-label="Loading…" className="mt-4 flex flex-col gap-3">
          <div className="skeleton h-20 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      </>
    );
  }

  if (list.length === 0) {
    const hasWorkspace = (workspaces.data?.length ?? 0) > 0;
    return (
      <>
        <PageHeader title={item.label} group={item.group} />
        <EmptyState
          icon={Terminal}
          empty={
            hasWorkspace
              ? {
                  headline: "Nothing is running",
                  text: "Start a stack to bring your services, logs, and resources into one view.",
                  cta: { label: "Open stacks", icon: Layers, to: "/stacks" },
                  secondary: item.empty?.secondary,
                }
              : item.empty!
          }
        />
      </>
    );
  }

  const failed = list.flatMap((run) => run.services.filter(isProblem).map((service) => ({ run, service })));
  const oldest = Math.min(...list.map((r) => Date.parse(r.started_at)).filter((n) => !Number.isNaN(n)));

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        actions={
          <div className="flex items-center gap-2">
            <StopAll runs={list} />
            {failed.length > 0 && (
              <Button
                disabled={restart.isPending}
                onClick={() => {
                  for (const { run, service } of failed) restart.mutate({ workspace: run.workspace, stack: run.stack, service: service.id });
                }}
              >
                <RotateCcw aria-hidden />
                Restart failed
              </Button>
            )}
          </div>
        }
        summary={
          <>
            <span className="inline-flex items-center gap-2">
              <StatusDot tone="good" />
              {t.ready} of {t.services} running
            </span>
            {t.problems > 0 && (
              <span className="inline-flex items-center gap-2">
                <StatusDot tone="critical" />
                {t.problems} need attention
              </span>
            )}
            {Number.isFinite(oldest) && <span className="font-mono text-[12px] text-ink-3">up {formatUptime(now - oldest)}</span>}
          </>
        }
      />

      <div className="enter mt-12 flex flex-wrap gap-x-14 gap-y-12" style={stagger(1)}>
        <div className="flex min-w-[min(560px,100%)] flex-[2] flex-col gap-12">
          {list.map((run) => (
            <RunServices
              key={`${run.workspace}/${run.stack}`}
              run={run}
              now={now}
              restarting={restart.isPending ? restart.variables?.service : undefined}
              onRestart={(service) => restart.mutate({ workspace: run.workspace, stack: run.stack, service })}
            />
          ))}
        </div>

        <section aria-label="Now" className="min-w-[min(300px,100%)] flex-1">
          <h2 className="m-0 mb-5 text-[14px] font-semibold leading-5 text-ink">Now</h2>
          <dl className="m-0 flex flex-col gap-10">
            <Metric label="Stacks running">{t.stacks}</Metric>
            <Metric label="Services ready">
              {t.ready}
              <span className={unit}>of {t.services}</span>
            </Metric>
            <Metric label="Problems">{t.problems}</Metric>
            <Metric label="Live updates">
              <span className="text-[14px] font-medium tracking-normal">{socket === "open" ? "On" : "Reconnecting…"}</span>
            </Metric>
          </dl>
        </section>
      </div>
    </>
  );
}
