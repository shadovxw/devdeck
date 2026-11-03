import { useState } from "react";

import { pill, pillPrimary, pillSmall } from "../../design/pills";
import type { BuildJob } from "../../lib/docker";
import { took } from "../../lib/time";

const STEPS = ["Build", "Push"] as const;

const rank: Record<BuildJob["state"], number> = { running: 0, queued: 1, ok: 2, failed: 2, exists: 2 };

/** Running first, then the ones waiting in order, then the finished, newest first. */
export function sortJobs(jobs: BuildJob[]): BuildJob[] {
  return [...jobs].sort((a, b) => rank[a.state] - rank[b.state] || (rank[a.state] === 2 ? (b.finishedAt ?? 0) - (a.finishedAt ?? 0) : 0));
}

function label(j: BuildJob): string {
  switch (j.state) {
    case "running":
      return STEPS[j.step - 1];
    case "queued":
      return "Queued";
    case "ok":
      return "Pushed";
    case "exists":
      return "Tag exists";
    default:
      return "Failed";
  }
}

/** The colour of a step: done, the one running now, or still to come. */
function stepTone(job: BuildJob, i: number): string {
  if (job.state === "ok" || (job.state === "running" && i < job.step - 1)) return "bg-primary";
  return job.state === "running" && i === job.step - 1 ? "bg-ink-3" : "bg-fill-hover";
}

function Steps({ job }: Readonly<{ job: BuildJob }>) {
  return (
    <span className="inline-flex gap-1" aria-hidden>
      {STEPS.map((s, i) => {
        return <i key={s} title={s} className={`block h-1.5 w-6 ${stepTone(job, i)}`} />;
      })}
    </span>
  );
}

function Job({ job, now }: Readonly<{ job: BuildJob; now: number }>) {
  const seconds = job.startedAt ? Math.round(((job.finishedAt ?? now) - job.startedAt) / 1000) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto_5rem_4.5rem] items-center gap-3 py-1 text-[13px]">
      <span className="truncate">
        <span className="font-medium text-ink">{job.row.image}</span>
        <span className="font-mono text-ink-3">:{job.tag}</span>
      </span>
      <Steps job={job} />
      <span className="text-ink-2">{label(job)}</span>
      <span className="text-end font-mono text-[12px] text-ink-3">{job.startedAt ? took(seconds) : "—"}</span>
    </li>
  );
}

/** The builds asked for, as a strip along the bottom: what runs now, what waits, what just finished. */
export function BuildDock({ jobs, now }: Readonly<{ jobs: BuildJob[]; now: number }>) {
  const [collapsed, setCollapsed] = useState(false);
  if (jobs.length === 0) return null;
  const sorted = sortJobs(jobs);
  const running = jobs.filter((j) => j.state === "running").length;
  const queued = jobs.filter((j) => j.state === "queued").length;
  const done = jobs.filter((j) => j.state === "ok").length;
  const running1 = sorted.find((j) => j.state === "running");
  const lastLine = running1?.lines.at(-1);
  return (
    <section aria-label="Builds" className="flex flex-col gap-1 bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[14px] font-semibold text-ink">Builds</h2>
        <span className="text-[13px] text-ink-3">
          {running} running · {queued} queued · {done} done
        </span>
        <span className="flex-1" />
        <a href="#build-history" className={pillSmall}>
          History
        </a>
        <button type="button" className={pillSmall} aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>
      {!collapsed && (
        <>
          <ul className="m-0 flex list-none flex-col p-0">
            {sorted.slice(0, 5).map((j) => (
              <Job key={j.key} job={j} now={now} />
            ))}
          </ul>
          {lastLine && <p className="m-0 truncate font-mono text-[12px] text-ink-3">{lastLine}</p>}
        </>
      )}
    </section>
  );
}

/** The bar above the dock when images are ticked: what will be built, and the button. */
export function BatchBar({
  count,
  ready,
  skipped,
  asking,
  onAsk,
  onConfirm,
  onCancel,
  onClear,
}: Readonly<{
  count: number;
  ready: Array<{ target: string }>;
  skipped: string[];
  asking: boolean;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onClear: () => void;
}>) {
  if (count === 0) return null;
  return (
    <section aria-label="Selected images" className="flex flex-col gap-2 bg-fill px-4 py-3">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
        <b className="text-ink">{count} selected</b>
        <span>each is built with the tag typed in its box, one after another</span>
        <span className="flex-1" />
        <button type="button" className={pill} onClick={onClear}>
          Clear
        </button>
        <button type="button" className={pillPrimary} disabled={ready.length === 0} onClick={onAsk}>
          Build &amp; push selected
        </button>
      </div>
      {skipped.length > 0 && <p className="m-0 text-[12.5px] text-ink-3">Left out: {skipped.join("; ")}.</p>}
      {asking && (
        <div role="group" aria-label="Confirm the builds" className="flex flex-col gap-2 bg-surface-1 p-3">
          <p className="m-0 text-[13px] leading-5 text-ink-2">Build and push these {ready.length === 1 ? "image" : `${ready.length} images`} to Docker Hub, one after another?</p>
          <ul className="m-0 list-none p-0 font-mono text-[12.5px] text-ink">
            {ready.map((r) => (
              <li key={r.target}>{r.target}</li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button type="button" className={pillPrimary} onClick={onConfirm}>
              Build and push
            </button>
            <button type="button" className={pill} onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
