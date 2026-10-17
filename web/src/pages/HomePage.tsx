import { ArrowRight, Boxes, Layers, Stethoscope, Terminal } from "lucide-react";
import { Link } from "react-router";

import { navByPath } from "../app/nav";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { ServiceStateMark } from "../design/ServiceStateMark";
import { StatusMark } from "../design/StatusMark";
import { stagger } from "../lib/motion";
import { useRuns, useWorkspaces } from "../lib/queries";
import { formatUptime, isProblem, tally } from "../lib/runs";
import { useSocketStatus } from "../lib/socket";
import type { RunStatus } from "../lib/types";
import { useNow } from "../lib/use-now";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt className="text-[13px] text-ink-3">{label}</dt>
      <dd className="m-0 flex items-center gap-2 text-[26px] font-bold leading-none tabular-nums tracking-tight text-ink">{children}</dd>
    </div>
  );
}

function RunServices({ run, now }: { run: RunStatus; now: number }) {
  return (
    <section aria-label={`Services in ${run.stack}`} className="pb-2">
      <h2 className="m-0 flex items-baseline gap-3 px-4 pb-2 pt-4 text-[13px] font-medium text-ink-3">
        <Link to={`/stacks?workspace=${encodeURIComponent(run.workspace)}`} className="text-ink hover:underline">
          {run.stack}
        </Link>
        <span className="font-normal">{run.workspace}</span>
      </h2>
      <ul className="m-0 list-none p-0">
        {run.services.map((s) => (
          <li key={s.id} className="flex flex-col gap-1 border-t border-line px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="w-32 shrink-0 text-[14px]">
                <ServiceStateMark state={s.state} />
              </span>
              <span className="min-w-0 flex-1 text-[14px] font-medium">{s.id === "compose" ? "Dependencies" : s.id}</span>
              {s.port && s.state === "ready" ? (
                <a
                  href={`http://127.0.0.1:${s.port}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open http://127.0.0.1:${s.port}`}
                  className="font-mono text-xs tabular-nums text-accent hover:underline"
                >
                  :{s.port}
                </a>
              ) : s.port ? (
                <span className="font-mono text-xs tabular-nums text-ink-3">:{s.port}</span>
              ) : null}
              <span className="w-16 text-end text-[13px] tabular-nums text-ink-3">
                {s.state === "ready" && s.ready_at ? formatUptime(now - Date.parse(s.ready_at)) : ""}
              </span>
            </div>
            {isProblem(s) && s.last_error && <p className="m-0 ps-[8.5rem] text-[13px] text-ink-3">{s.last_error}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

const action =
  "flex items-center gap-3 rounded-ctl px-4 py-3 text-[14px] text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-[.99]";

export function HomePage() {
  const item = navByPath("/");
  const runs = useRuns();
  const workspaces = useWorkspaces();
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

  return (
    <>
      <PageHeader title={item.label} group={item.group} />

      <dl className="enter m-0 mt-4 grid grid-cols-2 rounded-sheet bg-surface-1 sm:grid-cols-4" style={stagger(1)}>
        <Stat label="Stacks running">{t.stacks}</Stat>
        <Stat label="Services ready">
          {t.ready}
          <span className="text-[16px] font-normal text-ink-3">of {t.services}</span>
        </Stat>
        <Stat label="Problems">
          {t.problems > 0 && <StatusMark level="fail" />}
          {t.problems}
        </Stat>
        <Stat label="Live updates">
          <span className="text-[16px] font-medium">{socket === "open" ? "On" : "Reconnecting…"}</span>
        </Stat>
      </dl>

      <div className="enter mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]" style={stagger(2)}>
        <div className="rounded-sheet bg-surface-1 pb-2">
          {list.map((run) => (
            <RunServices key={`${run.workspace}/${run.stack}`} run={run} now={now} />
          ))}
        </div>

        <nav aria-label="Quick actions" className="rounded-sheet bg-surface-1 p-2">
          <Link to="/stacks" viewTransition className={action}>
            <Layers size={17} aria-hidden />
            <span className="flex-1">Stacks</span>
            <ArrowRight size={15} aria-hidden />
          </Link>
          <Link to="/doctor" viewTransition className={action}>
            <Stethoscope size={17} aria-hidden />
            <span className="flex-1">Check this machine</span>
            <ArrowRight size={15} aria-hidden />
          </Link>
          <Link to="/workspaces" viewTransition className={action}>
            <Boxes size={17} aria-hidden />
            <span className="flex-1">Workspaces</span>
            <ArrowRight size={15} aria-hidden />
          </Link>
        </nav>
      </div>
    </>
  );
}
