import { Layers, RotateCcw, Terminal } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { Panel } from "../design/Panel";
import { ServiceStateMark } from "../design/ServiceStateMark";
import { StatusDot } from "../design/StatusDot";
import { stagger } from "../lib/motion";
import { useRestartService, useRuns, useWorkspaces } from "../lib/queries";
import { formatUptime, isProblem, serviceLabel, tally } from "../lib/runs";
import { useSocketStatus } from "../lib/socket";
import type { RunStatus, ServiceStatus } from "../lib/types";
import { useNow } from "../lib/use-now";
import { useUi } from "../store/ui";
import { NeonEmptyHome } from "./home/NeonEmptyHome";
import { NeonHome } from "./home/NeonHome";
import { ProblemRow, StopAll } from "./home/parts";

/** A big number under a small mono label (dev-plans/02-frontend-design-system.md, the `metric` style). */
function Metric({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <dt className="font-mono text-[11px] uppercase leading-[14px] tracking-[0.06em] text-ink-3">{label}</dt>
      <dd className="m-0 flex items-baseline gap-2 text-[32px] font-semibold leading-[34px] tracking-[-0.03em] tabular-nums text-ink">{children}</dd>
    </div>
  );
}

const unit = "text-[13px] font-normal tracking-normal text-ink-3";


/** The port of a service: a link while it is ready, plain text before that, nothing without one. */
function Port({ service }: Readonly<{ service: ServiceStatus }>) {
  if (!service.port) return null;
  if (service.state !== "ready") return <span className="font-mono text-[11px] tabular-nums text-ink-3">:{service.port}</span>;
  return (
    <a
      href={`http://127.0.0.1:${service.port}`}
      target="_blank"
      rel="noreferrer"
      title={`Open http://127.0.0.1:${service.port}`}
      className="font-mono text-[11px] tabular-nums text-link hover:underline"
    >
      :{service.port}
    </a>
  );
}

/** How long a ready service has been up, or "stopped"; empty otherwise. */
function uptimeOf(service: ServiceStatus, now: number): string {
  if (service.state === "ready" && service.ready_at) return formatUptime(now - Date.parse(service.ready_at));
  return service.state === "stopped" ? "stopped" : "";
}

/** One healthy or idle service: dot, name, port and how long it has been up. */
function ServiceRow({ service, now }: Readonly<{ service: ServiceStatus; now: number }>) {
  return (
    <li className="flex items-center gap-4 px-3.5 py-1.5">
      <ServiceStateMark state={service.state} label={false} />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{serviceLabel(service.id)}</span>
      <Port service={service} />
      <span className="w-16 text-end font-mono text-[11px] tabular-nums text-ink-3">{uptimeOf(service, now)}</span>
    </li>
  );
}

function RunServices({ run, now, restarting, onRestart }: Readonly<{ run: RunStatus; now: number; restarting?: string; onRestart: (service: string) => void }>) {
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


export function HomePage() {
  const item = navByPath("/");
  const runs = useRuns();
  const workspaces = useWorkspaces();
  const restart = useRestartService();
  const list = runs.data ?? [];
  const now = useNow(list.length > 0);
  const t = tally(list);
  const socket = useSocketStatus();
  const look = useUi((s) => s.look);

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
    if (look === "neon") return <NeonEmptyHome hasWorkspace={hasWorkspace} empty={item.empty!} />;
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
  const restartFailed = () => {
    for (const { run, service } of failed) restart.mutate({ workspace: run.workspace, stack: run.stack, service: service.id });
  };

  // Neon has its own layout (dev-plans/2026-11-21-portfolio-look §4); Flat stays as below.
  if (look === "neon") {
    return (
      <NeonHome
        runs={list}
        now={now}
        live={socket === "open"}
        restarting={restart.isPending ? restart.variables?.service : undefined}
        onRestart={(run, service) => restart.mutate({ workspace: run.workspace, stack: run.stack, service })}
        onRestartFailed={restartFailed}
        restartBusy={restart.isPending}
      />
    );
  }
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
                onClick={restartFailed}
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

        <Panel title="Now" kicker="02 $" className="min-w-[min(300px,100%)] flex-1">
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
        </Panel>
      </div>
    </>
  );
}
