import { StatusDot, toneColor } from "../../design/StatusDot";
import type { FeatureDetail, FeaturePr, PrCheck, ReviewControls } from "../../lib/features";
import { ago } from "../../lib/time";
import { useNow } from "../../lib/use-now";
import { ReviewSection, reviewable } from "./Reviews";
import { githubUrl, StateChip } from "./StateChip";
import { layerName, overBudget, STAGES, stageOf, STATE_TONE } from "./state";

const WHO: Record<string, string> = { claude: "Claude", you: "You", reviewers: "Reviewers" };

function Section({ title, aside, children }: Readonly<{ title: string; aside?: string; children: React.ReactNode }>) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">{title}</h3>
        {aside && <span className="text-[12px] tabular-nums text-ink-3">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Meter({ label, value, budget, over }: Readonly<{ label: string; value: string; budget: number; over: boolean }>) {
  const n = Number.parseInt(value, 10) || 0;
  return (
    <div className="flex flex-col gap-1 text-[12.5px] tabular-nums">
      <div className="flex justify-between text-ink-2">
        <span>{label}</span>
        <span>
          {value} / {budget}
        </span>
      </div>
      <span className="block h-[5px] bg-fill-press" aria-hidden>
        <span className={`block h-full ${over ? "bg-warning" : "bg-ink-3"}`} style={{ width: `${Math.min(100, (n / budget) * 100)}%` }} />
      </span>
    </div>
  );
}

function Check({ c }: Readonly<{ c: PrCheck }>) {
  const tone = c.state === "pass" ? "good" : c.state === "fail" ? "critical" : "warning";
  const word = c.state === "pass" ? "passed" : c.state === "fail" ? "failed" : "running";
  return (
    <li className="flex items-center gap-2 text-[12.5px] text-ink-2">
      <StatusDot tone={tone} spin={c.state === "pending"} size={7} />
      <span className="min-w-0 flex-1 truncate text-ink" title={c.name}>
        {c.name}
      </span>
      <span className="text-ink-3">{word}</span>
    </li>
  );
}

/** One PR in full: where it is, what is next, its steps and commits, how big it is and its GitHub checks. */
export function PrPanel({ d, pr, c }: Readonly<{ d: FeatureDetail; pr: FeaturePr; c: ReviewControls }>) {
  const now = useNow(true, 30_000);
  const layers = d.repo_layers.find((r) => r.id === pr.repo)?.layers ?? [];
  const stage = stageOf(pr.state);
  const url = githubUrl(pr.github?.url);
  const over = overBudget(pr, d.budget);
  const lines = pr.size ? pr.size.added + pr.size.deleted : 0;

  return (
    <aside aria-label={`PR ${pr.id}`} className="flex min-w-0 flex-col gap-5 bg-inset p-4 min-[1180px]:sticky min-[1180px]:top-3 min-[1180px]:max-h-[calc(100vh-24px)] min-[1180px]:overflow-y-auto">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[13px] text-ink-3">
            {pr.id} · {pr.repo}
            {pr.github && ` · #${pr.github.number}`}
          </span>
          <StateChip state={pr.state} />
        </div>
        <h2 className="m-0 text-[17px] font-semibold leading-snug text-ink">{pr.title}</h2>
        <ol aria-label="Stage" className="m-0 grid list-none grid-cols-6 gap-[3px] p-0">
          {STAGES.map((s, i) => (
            <li key={s} aria-current={i === stage ? "step" : undefined} className={`flex flex-col gap-1 text-[10.5px] ${i === stage ? "font-medium text-ink" : "text-ink-3"}`}>
              <span className="block h-1 bg-fill-press" style={i < stage ? { background: "var(--ink-3)" } : i === stage ? { background: toneColor[STATE_TONE[pr.state]] } : undefined} />
              {pr.state === "changes" && i === 3 ? "Changes" : s}
            </li>
          ))}
        </ol>
      </div>

      <dl className="m-0 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
        <dt className="text-ink-3">Branch</dt>
        <dd className="m-0 break-all font-mono text-[12px] text-ink-2">{pr.branch}</dd>
        <dt className="text-ink-3">Base</dt>
        <dd className="m-0 break-all font-mono text-[12px] text-ink-2">{pr.base}</dd>
        {pr.local?.exists && (
          <>
            <dt className="text-ink-3">Pushed</dt>
            <dd className="m-0 text-ink-2">{pr.local.pushed ? "Yes, to origin" : "Not yet"}</dd>
          </>
        )}
        <dt className="text-ink-3">Layers</dt>
        <dd className="m-0 flex flex-wrap gap-1">
          {pr.layers.length === 0 ? <span className="text-ink-3">none named</span> : pr.layers.map((l) => (
            <span key={l} className="bg-fill px-1.5 text-[11.5px] text-ink-2">
              {layerName(layers, l)}
            </span>
          ))}
        </dd>
      </dl>

      {pr.next && (
        <div className="flex flex-col gap-0.5 bg-bg p-3 text-[13px] text-ink">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">Next · {WHO[pr.next.who] ?? pr.next.who}</span>
          {pr.next.text}
        </div>
      )}
      {pr.state === "waiting" && (
        <div className="flex flex-col gap-0.5 bg-bg p-3 text-[13px] text-ink">
          <span className="text-[11px] uppercase tracking-wide text-ink-3">Waiting</span>
          Waits for {(pr.after ?? []).join(", ")} to be merged.
        </div>
      )}

      {reviewable(pr) && <ReviewSection d={d} pr={pr} c={c} />}

      <Section title="Steps" aside={`${pr.steps_done} of ${pr.steps.length} · one commit each`}>
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0">
          {pr.steps.map((s, i) => {
            const status = s.status ?? "todo";
            return (
              <li key={i} className={`grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-x-2 text-[13px] ${status === "todo" ? "text-ink-3" : "text-ink"}`}>
                <span aria-hidden className={`font-mono text-[12px] ${status === "done" ? "text-good" : status === "doing" ? "text-serious" : "text-ink-3"}`}>
                  {status === "done" ? "✓" : status === "doing" ? "●" : "○"}
                </span>
                <span>
                  <span className="sr-only">{status}: </span>
                  {s.title}
                </span>
                <span className="font-mono text-[11.5px] text-ink-3">{s.commit ?? (status === "doing" ? "in progress" : "")}</span>
                {(s.layers?.length ?? 0) > 0 && <span className="col-start-2 text-[11px] text-ink-3">{s.layers!.map((l) => layerName(layers, l)).join(", ")}</span>}
              </li>
            );
          })}
        </ol>
      </Section>

      {pr.size && (
        <Section title="Size" aside={`budget ${d.budget.lines} lines · ${d.budget.files} files`}>
          <Meter label={`+${pr.size.added} −${pr.size.deleted}`} value={String(lines)} budget={d.budget.lines} over={Boolean(pr.over?.includes("lines"))} />
          <Meter label="Files" value={String(pr.size.files)} budget={d.budget.files} over={Boolean(pr.over?.includes("files"))} />
          {over && <p className="m-0 text-[12.5px] text-warning">Over budget: {over}. Smaller PRs are easier to review.</p>}
        </Section>
      )}

      {pr.github && (
        <Section title="GitHub">
          <div className="flex items-baseline justify-between gap-2 text-[13px] text-ink-2">
            <span>{pr.github.state === "open" ? (pr.github.draft ? "Draft pull request" : "Open pull request") : pr.github.state === "merged" ? "Merged" : "Closed"}</span>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                Open on GitHub ↗
              </a>
            )}
          </div>
          {(pr.github.checks?.length ?? 0) > 0 && (
            <ul aria-label="Checks" className="m-0 flex list-none flex-col gap-1 p-0">
              {pr.github.checks!.map((c) => (
                <Check key={c.name} c={c} />
              ))}
            </ul>
          )}
          <p className="m-0 text-[12px] text-ink-3">Reviews and comments stay on GitHub.</p>
        </Section>
      )}

      {(pr.local?.commits?.length ?? 0) > 0 && (
        <Section title="Commits" aside={String(pr.local!.commits!.length)}>
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {pr.local!.commits!.slice(0, 20).map((c) => (
              <li key={c.hash} className="grid grid-cols-[56px_minmax(0,1fr)_auto] items-baseline gap-2 text-[12.5px]">
                <span className="font-mono text-[11.5px] text-ink-3">{c.hash}</span>
                <span className="truncate text-ink-2" title={c.subject}>
                  {c.subject}
                </span>
                <span className="whitespace-nowrap text-[11.5px] text-ink-3" title={c.date}>
                  {ago(c.date, now)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {pr.local?.base_missing && <p className="m-0 text-[12.5px] text-ink-3">The branch {pr.base} doesn’t exist yet, so the size can’t be worked out from git.</p>}
      {pr.state === "planned" && <p className="m-0 text-[12.5px] text-ink-3">No branch yet. Hand this PR to Claude with the button at the top.</p>}
    </aside>
  );
}
