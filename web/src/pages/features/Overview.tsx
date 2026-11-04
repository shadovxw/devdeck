import { useState } from "react";

import { StatusDot, toneColor } from "../../design/StatusDot";
import type { FeatureDetail, FeaturePr, ReviewControls } from "../../lib/features";
import { PrPanel } from "./PrPanel";
import { StateChip } from "./StateChip";
import { hasBranch, layerName, overBudget, STATE_LABEL, STATE_ORDER, STATE_TONE } from "./state";

/** One segment per PR in the PR's colour, and the count of each state. */
function Progress({ d }: Readonly<{ d: FeatureDetail }>) {
  const merged = d.counts.merged ?? 0;
  const lines = d.pr_list.reduce((n, p) => n + (p.size ? p.size.added + p.size.deleted : 0), 0);
  return (
    <section aria-label="Progress" className="flex flex-col gap-3 bg-inset p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Progress</h2>
        <span className="text-[13px] tabular-nums text-ink-2">
          {merged} of {d.pr_list.length} merged
        </span>
      </div>
      <div className="flex gap-[3px]" aria-hidden>
        {d.pr_list.map((p) => (
          <span key={p.id} title={`${p.id}: ${STATE_LABEL[p.state]}`} className="h-2 flex-1" style={{ background: hasBranch(p.state) ? toneColor[STATE_TONE[p.state]] : "var(--fill-press)" }} />
        ))}
      </div>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] tabular-nums text-ink-2">
        {STATE_ORDER.filter((s) => d.counts[s]).map((s) => (
          <li key={s} className="inline-flex items-center gap-1.5">
            <StatusDot tone={STATE_TONE[s]} ring={s === "planned" || s === "waiting" || s === "closed"} size={7} />
            <b className="font-semibold text-ink">{d.counts[s]}</b> {STATE_LABEL[s].toLowerCase()}
          </li>
        ))}
        {lines > 0 && (
          <li>
            <b className="font-semibold text-ink">{lines.toLocaleString("en-US")}</b> lines so far
          </li>
        )}
      </ul>
    </section>
  );
}

/** What is waiting on someone, most urgent first. A click opens that PR. */
function NextUp({ d, onPick }: Readonly<{ d: FeatureDetail; onPick: (id: string) => void }>) {
  return (
    <section aria-label="Next up" className="flex flex-col gap-2 bg-inset p-4">
      <h2 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Next up</h2>
      {d.next_up.length === 0 ? (
        <p className="m-0 text-[13px] text-ink-3">Nothing is waiting on anyone.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {d.next_up.map((n) => (
            <li key={n.pr}>
              <button type="button" onClick={() => onPick(n.pr)} className="grid w-full cursor-pointer grid-cols-[36px_minmax(0,1fr)_auto] items-baseline gap-3 px-1.5 py-1 text-left text-[13px] hover:bg-fill-hover">
                <span className="font-mono text-[12px] text-ink-3">{n.pr}</span>
                <span className="text-ink">{n.text}</span>
                <span className="text-[12px] text-ink-3">{n.who}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A coloured square when the PR changes the layer: filled once it has a branch, an empty ring while it is only planned. */
function LayerCell({ pr, touches, label }: Readonly<{ pr: FeaturePr; touches: boolean; label: string }>) {
  if (!touches) {
    return (
      <td className="px-1 py-2 text-center">
        <span className="sr-only">{pr.id} doesn’t change {label}</span>
      </td>
    );
  }
  const color = toneColor[STATE_TONE[pr.state]];
  return (
    <td className="px-1 py-2 text-center">
      <span
        title={`${pr.id} changes ${label}`}
        className="inline-block h-3.5 w-3.5 align-middle"
        style={hasBranch(pr.state) ? { background: color } : { boxShadow: `inset 0 0 0 1.5px ${color}` }}
      >
        <span className="sr-only">{pr.id} changes {label}</span>
      </span>
    </td>
  );
}

/** A repo: its PRs down, its layers across. */
function RepoGrid({ d, repo, selected, onPick }: Readonly<{ d: FeatureDetail; repo: FeatureDetail["repo_layers"][number]; selected: string; onPick: (id: string) => void }>) {
  const prs = d.pr_list.filter((p) => p.repo === repo.id);
  const merged = prs.filter((p) => p.state === "merged").length;
  return (
    <section aria-label={`Repository ${repo.id}`} className="flex flex-col gap-2 bg-inset p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="m-0 font-mono text-[14px] font-semibold text-ink">{repo.id}</h2>
        <span className="text-[12.5px] tabular-nums text-ink-3">
          {prs.length} {prs.length === 1 ? "PR" : "PRs"} · {merged} merged
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-0.5 text-[12.5px] tabular-nums">
          <thead>
            <tr className="text-left text-[11.5px] font-medium text-ink-3">
              <th className="px-2 py-1 font-medium">PR</th>
              {repo.layers.map((l) => (
                <th key={l.id} className="px-1 py-1 text-center font-medium" title={l.name || l.id}>
                  {l.name || l.id}
                </th>
              ))}
              <th className="px-2 py-1 font-medium">State</th>
              <th className="px-2 py-1 font-medium">Size</th>
              <th className="px-2 py-1 font-medium">Steps</th>
            </tr>
          </thead>
          <tbody>
            {prs.map((pr) => {
              const over = overBudget(pr, d.budget);
              return (
                <tr key={pr.id} className={pr.id === selected ? "bg-accent-soft" : "bg-bg hover:bg-fill-hover"} onClick={() => onPick(pr.id)}>
                  <td className="px-2 py-2">
                    <button type="button" aria-pressed={pr.id === selected} onClick={() => onPick(pr.id)} className="flex min-w-[10rem] cursor-pointer flex-col text-left">
                      <span className="text-ink">
                        <b className="font-mono text-[12px] font-medium">{pr.id}</b> {pr.title}
                      </span>
                      <span className="text-[11.5px] text-ink-3">
                        {pr.github ? `#${pr.github.number}` : pr.state === "waiting" ? `after ${(pr.after ?? []).join(", ")}` : "no PR yet"}
                      </span>
                    </button>
                  </td>
                  {repo.layers.map((l) => (
                    <LayerCell key={l.id} pr={pr} touches={pr.layers.includes(l.id)} label={layerName(repo.layers, l.id)} />
                  ))}
                  <td className="px-2 py-2">
                    <StateChip state={pr.state} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-2">
                    {pr.size ? (
                      <>
                        <span className="text-good">+{pr.size.added}</span> <span className="text-critical">−{pr.size.deleted}</span>
                        {over && <span className="ml-1.5 text-warning" title={`Over budget: ${over}`}>over</span>}
                      </>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-ink-2">
                    {pr.steps_done}/{pr.steps.length}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {repo.layers.length === 0 && <p className="m-0 px-1 text-[12.5px] text-ink-3">This repo has no layers in workspace.yaml, so the columns are empty. Add layers to see which parts of it each PR changes.</p>}
    </section>
  );
}

/** The overview: progress, what is next, every repo's PRs against its layers, and the PR you picked. */
export function Overview({ d, c }: Readonly<{ d: FeatureDetail; c: ReviewControls }>) {
  const [picked, setPicked] = useState<string | undefined>(d.next_up[0]?.pr ?? d.pr_list[0]?.id);
  const selected = d.pr_list.find((p) => p.id === picked) ?? d.pr_list[0];

  return (
    <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1fr)_400px]">
      <div className="flex min-w-0 flex-col gap-3">
        <Progress d={d} />
        <NextUp d={d} onPick={setPicked} />
        {d.repo_layers.map((r) => (
          <RepoGrid key={r.id} d={d} repo={r} selected={selected?.id ?? ""} onPick={setPicked} />
        ))}
        <p className="m-0 text-[12px] text-ink-3">A square means the PR changes that layer: filled once it has a branch, an empty ring while it is only planned.</p>
      </div>
      {selected && <PrPanel d={d} pr={selected} c={c} />}
    </div>
  );
}
