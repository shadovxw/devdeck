import { StatusDot, type Tone } from "../../design/StatusDot";
import { pill, pillSmall } from "../../design/pills";
import { activeRun, type FeatureDetail, type FeaturePr, type ReviewControls, type ReviewRun, type ReviewStatus, type ReviewView, type ToolInfo } from "../../lib/features";
import { ago } from "../../lib/time";
import { useNow } from "../../lib/use-now";
import { StateChip } from "./StateChip";

const TONE: Record<ReviewStatus, Tone> = { pass: "good", warn: "warning", fail: "critical", error: "serious", skip: "neutral" };
const WORD: Record<ReviewStatus, string> = { pass: "Passed", warn: "Warning", fail: "Failed", error: "Couldn’t run", skip: "Skipped" };

/** True for a PR a review can run on: it has a branch and isn't merged or closed. */
export const reviewable = (pr: FeaturePr) => Boolean(pr.local?.exists) && pr.state !== "merged" && pr.state !== "closed";

/** The first hint for a program of the tool that is missing. */
/** Whether "Run all" would start this tool: it is installed and has no usage limit of its own. */
const runsWithAll = (t: ToolInfo) => t.usable && !t.manual;

const missingHint = (t: ToolInfo) => t.programs.find((p) => !p.found)?.hint ?? "";

/** Why reviews can't run from this page right now, or "" when they can. */
export function cannotRun(d: FeatureDetail): string {
  if (d.read_only) return "This plan isn’t checked out, and results are saved in its folder. Check its branch out as a worktree first (the Features guide says how).";
  return "";
}

type RowProps = Readonly<{ d: FeatureDetail; pr: FeaturePr; tool: ToolInfo; c: ReviewControls }>;

/** The dot at the start of a tool's row: spinning while it runs, else the colour of its last result. */
function ToolMark({ run, saved }: Readonly<{ run?: ReviewRun; saved?: ReviewView }>) {
  if (run) return <StatusDot tone="primary" spin size={7} />;
  if (saved) return <StatusDot tone={TONE[saved.status]} ring={saved.status === "skip"} size={7} />;
  return <StatusDot tone="neutral" size={7} />;
}

/** What a tool's row says: its run, its last result, that it isn't installed, or that it hasn't run. */
function ToolLine({ run, saved, tool, c, now }: Readonly<{ run?: ReviewRun; saved?: ReviewView; tool: ToolInfo; c: ReviewControls; now: number }>) {
  if (run) return <span className="text-primary">{run.state === "queued" ? "Waiting for its turn…" : "Running on the branch…"}</span>;
  if (saved) {
    return (
      <>
        <span className="sr-only">{WORD[saved.status]}: </span>
        <span className="text-ink-2">{saved.summary || WORD[saved.status]}</span>
        <span className="text-ink-3"> · {ago(saved.ran, now)}</span>
        {saved.stale && <span className="text-warning" title="The branch has new commits since this ran"> · older commit</span>}{" "}
        <button type="button" onClick={() => c.openFile(saved.file)} className="text-link hover:underline" title={`Open ${saved.file}`}>
          {saved.file}
        </button>
      </>
    );
  }
  if (!tool.usable) return <span className="text-ink-3">Not installed. {missingHint(tool)}</span>;
  return <span className="text-ink-3">Not run yet</span>;
}

/** The button at the end of a row: Cancel while it runs, Run or Re-run when it can, nothing when the tool isn't installed. */
function ToolButton({ d, pr, tool, c, run, rerun }: RowProps & Readonly<{ run?: ReviewRun; rerun: boolean }>) {
  if (run) {
    return (
      <button type="button" onClick={() => c.cancel(run.id)} className={pillSmall}>
        Cancel
      </button>
    );
  }
  if (!tool.usable) return null;
  const why = cannotRun(d);
  const word = rerun ? "Re-run" : "Run";
  return (
    <button type="button" disabled={Boolean(why) || c.starting} onClick={() => c.start(pr.id, tool.id)} className={pillSmall} aria-label={`${word} ${tool.name}`} title={why || tool.about}>
      {word}
    </button>
  );
}

/** One tool on one PR: its last result or its run, and the button for it. */
function ToolRow({ d, pr, tool, c, now }: RowProps & Readonly<{ now: number }>) {
  const run = activeRun(c.runs, pr.id, tool.id);
  const saved = pr.reviews?.[tool.id];
  return (
    <li className="grid grid-cols-[9px_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-0.5 bg-bg px-2.5 py-2">
      <span className="mt-[5px]">
        <ToolMark run={run} saved={saved} />
      </span>
      <span className="flex min-w-0 flex-col text-[13px]">
        <span className="text-ink" title={tool.about}>
          {tool.name}
        </span>
        <span className="min-w-0 break-words text-[12px] leading-snug">
          <ToolLine run={run} saved={saved} tool={tool} c={c} now={now} />
        </span>
      </span>
      <ToolButton d={d} pr={pr} tool={tool} c={c} run={run} rerun={Boolean(saved)} />
    </li>
  );
}

/** The review tools for one PR's branch: a result and a Run button each, and Run all. */
export function ReviewSection({ d, pr, c }: Readonly<{ d: FeatureDetail; pr: FeaturePr; c: ReviewControls }>) {
  const now = useNow(true, 30_000);
  const why = cannotRun(d);
  const anyUsable = d.tools.some(runsWithAll);
  return (
    <section aria-label="Code review on this branch" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Code review on this branch</h3>
        <button type="button" disabled={Boolean(why) || !anyUsable || c.starting} onClick={() => c.start(pr.id)} className={pillSmall} title={why || "Runs every installed tool on this branch, except the Claude review, which has its own button"}>
          Run all
        </button>
      </div>
      <p className="m-0 text-[12px] text-ink-3">
        Runs on <code className="break-all font-mono">{pr.branch}</code> in a separate checkout. Each result is saved in the plan’s reviews folder.
      </p>
      {why && <p className="m-0 bg-bg p-2.5 text-[12.5px] text-ink-2">{why}</p>}
      <ul aria-label="Review tools" className="m-0 flex list-none flex-col gap-0.5 p-0">
        {d.tools.map((t) => (
          <ToolRow key={t.id} d={d} pr={pr} tool={t} c={c} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** The header button: every installed tool on every branch that isn't merged or closed. */
export function ReviewAllButton({ d, c }: Readonly<{ d: FeatureDetail; c: ReviewControls }>) {
  const why = cannotRun(d);
  const any = d.pr_list.some(reviewable) && d.tools.some(runsWithAll);
  const title = why || (any ? "Runs every installed tool on every branch that isn’t merged or closed (not the Claude review, which has its own button)" : "No PR has a branch to review yet");
  return (
    <button type="button" disabled={Boolean(why) || !any || c.starting} onClick={() => c.start()} className={pill} title={title}>
      Review all changed branches
    </button>
  );
}

/** The colour of a PR's GitHub checks: any failure, else any still running, else all passed. */
function checksTone(fail: number, pending: number): Tone {
  if (fail > 0) return "critical";
  return pending > 0 ? "warning" : "good";
}

function ChecksCell({ pr }: Readonly<{ pr: FeaturePr }>) {
  const checks = pr.github?.checks ?? [];
  if (checks.length === 0) return <span className="text-ink-3">—</span>;
  const pass = checks.filter((x) => x.state === "pass").length;
  const fail = checks.filter((x) => x.state === "fail").length;
  const pending = checks.length - pass - fail;
  const tone = checksTone(fail, pending);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-ink-2" title={`${pass} passed, ${fail} failed, ${pending} running`}>
      <StatusDot tone={tone} spin={fail === 0 && pending > 0} size={7} />
      {pass} of {checks.length}
    </span>
  );
}

/** One tool's cell in the matrix: its run, its last result (a button that opens it), or nothing. */
function ResultCell({ run, saved, c, now }: Readonly<{ run?: ReviewRun; saved?: ReviewView; c: ReviewControls; now: number }>) {
  if (run) {
    return (
      <span className="inline-flex items-center gap-1.5 text-primary">
        <StatusDot tone="primary" spin size={7} />
        {run.state === "queued" ? "Waiting" : "Running"}
      </span>
    );
  }
  if (!saved) return <span className="text-ink-3">—</span>;
  return (
    <button type="button" onClick={() => c.openFile(saved.file)} title={`${saved.summary} · ${ago(saved.ran, now)}${saved.stale ? " · older commit" : ""}`} className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-ink hover:underline">
      <StatusDot tone={TONE[saved.status]} ring={saved.status === "skip"} size={7} />
      {WORD[saved.status]}
      {saved.stale && <span className="text-warning">·</span>}
    </button>
  );
}

/** Every PR against every tool, the GitHub checks, and which tools are installed. */
export function ChecksTab({ d, c }: Readonly<{ d: FeatureDetail; c: ReviewControls }>) {
  const now = useNow(true, 30_000);
  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto bg-inset p-3">
        <table aria-label="Reviews of every PR" className="w-full min-w-[720px] border-separate border-spacing-y-0.5 text-[12.5px]">
          <thead>
            <tr className="text-left text-[11.5px] font-medium text-ink-3">
              <th className="px-2 py-1 font-medium">PR</th>
              <th className="px-2 py-1 font-medium">State</th>
              {d.tools.map((t) => (
                <th key={t.id} className="px-2 py-1 font-medium" title={t.about}>
                  {t.name}
                </th>
              ))}
              <th className="px-2 py-1 font-medium">GitHub checks</th>
            </tr>
          </thead>
          <tbody>
            {d.pr_list.map((pr) => (
              <tr key={pr.id} className="bg-bg">
                <td className="whitespace-nowrap px-2 py-2">
                  <b className="font-mono text-[12px] font-medium">{pr.id}</b> <span className="text-ink-3">{pr.repo}</span>
                </td>
                <td className="px-2 py-2">
                  <StateChip state={pr.state} />
                </td>
                {d.tools.map((t) => (
                  <td key={t.id} className="px-2 py-2">
                    <ResultCell run={activeRun(c.runs, pr.id, t.id)} saved={pr.reviews?.[t.id]} c={c} now={now} />
                  </td>
                ))}
                <td className="px-2 py-2">
                  <ChecksCell pr={pr} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="m-0 mt-2 px-1 text-[12px] text-ink-3">A dot after a result means the branch has new commits since it ran. Click a result to read it.</p>
      </div>

      <section aria-label="Review tools" className="flex flex-col gap-2">
        <h2 className="m-0 text-[12px] font-medium uppercase tracking-wide text-ink-3">Tools</h2>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-1.5 p-0">
          {d.tools.map((t) => (
            <li key={t.id} className="flex flex-col gap-1 bg-inset p-3">
              <span className="flex items-baseline justify-between gap-2">
                <b className="text-[13.5px] font-medium text-ink">{t.name}</b>
                <span className="text-[11.5px] text-ink-3">{t.usable ? "Installed" : "Not installed"}</span>
              </span>
              <span className="text-[12.5px] text-ink-3">{t.about}</span>
              {t.programs.some((p) => !p.found) && (
                <span className="text-[12px] text-ink-2">
                  Missing: {t.programs.filter((p) => !p.found).map((p) => p.name).join(", ")}. {missingHint(t)}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="m-0 text-[12px] text-ink-3">These run on your machine, on a separate checkout of each branch. SonarQube, CodeRabbit and a Claude review come in later PRs.</p>
      </section>
    </div>
  );
}
