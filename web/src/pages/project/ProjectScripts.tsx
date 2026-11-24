import { Play } from "lucide-react";
import { useState } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { primaryButton, quietButton } from "../../design/buttons";
import { QuietEmpty } from "../../design/EmptyState";
import { askText, runSummary, stepLabel, useRunScript, useScriptRun, useScripts, whereItRuns, type Script, type ScriptRun } from "../../lib/scripts";
import { PAUSED_TITLE } from "../../lib/server-link";
import { useWritesPaused } from "../../lib/use-server-link";

/** How each source is named on a card. */
const SOURCE: Record<Script["source"], string> = { "built-in": "Starter", file: "Yours", "package.json": "package.json", Makefile: "Makefile" };

const name = (s: Script) => s.title ?? s.id;

/** The steps in a line: "fetch → checkout dev → pull". */
const chain = (s: Script) => s.steps.map(stepLabel).join(" → ");

/** One script: its name, where it comes from, its steps, how it last went, and Run. */
function ScriptCard({ script, example, onRun }: Readonly<{ script: Script; example: boolean; onRun: () => void }>) {
  const paused = useWritesPaused();
  const why = example ? "Example projects don't run scripts: add your own project." : paused ? PAUSED_TITLE : undefined;
  return (
    <li data-ui="script-card" className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <b data-ui="script-name" className="min-w-0 truncate">
          {name(script)}
        </b>
        <span data-ui="script-source">{SOURCE[script.source]}</span>
      </div>
      <span data-ui="script-steps" title={whereItRuns(script)}>
        {chain(script)}
      </span>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span data-ui="script-last" data-state={script.last?.state}>
          {script.last ? runSummary(script.last) : whereItRuns(script)}
        </span>
        <button type="button" onClick={onRun} disabled={Boolean(why)} title={why ?? `Run ${name(script)}`} aria-label={`Run ${name(script)}`} className={primaryButton}>
          <Play size={13} fill="currentColor" aria-hidden />
          Run
        </button>
      </div>
    </li>
  );
}

/** A repo's row in a run: its state, why, and each step. */
function RunRow({ row }: Readonly<{ row: ScriptRun["repos"][number] }>) {
  return (
    <li data-ui="run-row" data-state={row.state} className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <b className="font-mono text-[13px] text-ink">{row.repo}</b>
        <span data-ui="run-state" data-state={row.state}>
          {row.state}
        </span>
      </div>
      {row.reason && <p className="m-0 text-[12.5px] text-ink-3">{row.reason}</p>}
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {row.steps.map((st, i) => (
          <li key={i} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 font-mono text-[12px]">
              <span data-ui="run-dot" data-state={st.state} aria-hidden />
              <span className="text-ink-2">{st.label}</span>
              <span className="sr-only">{st.state}</span>
            </span>
            {st.output && <pre data-ui="run-output">{st.output}</pre>}
          </li>
        ))}
      </ol>
    </li>
  );
}

/**
 * Running a script (dev-plans/2026-11-22-projects §4.4): the steps, then, for a script that can
 * change files, what it will do and Run it / Cancel; then a row per repo as it goes, and a
 * summary at the end.
 */
function RunSheet({ workspace, script, onClose }: Readonly<{ workspace: string; script: Script; onClose: () => void }>) {
  const start = useRunScript(workspace);
  const [runId, setRunId] = useState<string>();
  const run = useScriptRun(runId, workspace);
  const go = () => start.mutate({ script: script.id, confirm: script.writes }, { onSuccess: (r) => setRunId(r.id) });
  const asking = script.writes && !runId && !start.isPending;
  const current = run.data ?? start.data;

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-0 bg-surface-1 sm:max-w-xl">
        <SheetHeader className="pe-12 pt-5">
          <span data-ui="run-command">$ devdeck run {script.id}</span>
          <SheetTitle className="text-[22px] text-ink">{name(script)}</SheetTitle>
          <SheetDescription asChild>
            <div data-ui="run-chain" className="flex flex-wrap items-center gap-2">
              {script.steps.map((st, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span aria-hidden>→</span>}
                  <span data-ui="run-step">{stepLabel(st)}</span>
                </span>
              ))}
              <span data-ui="run-where">{whereItRuns(script)}</span>
            </div>
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          {asking && (
            <div data-ui="run-ask" className="flex flex-col gap-3 p-4">
              <p className="m-0 text-[14px] leading-6 text-ink-2">{askText(script)}</p>
              <div className="flex gap-2">
                <button type="button" onClick={go} className={primaryButton}>
                  Run it
                </button>
                <button type="button" onClick={onClose} className={quietButton}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          {!script.writes && !runId && !start.isPending && !start.error && (
            <button type="button" onClick={go} className={`${primaryButton} self-start`}>
              <Play size={13} fill="currentColor" aria-hidden />
              Run
            </button>
          )}
          {start.error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {start.error.message}
            </p>
          )}
          {current && (
            <>
              <ul aria-label="Repos" className="m-0 flex list-none flex-col gap-2 p-0">
                {current.repos.map((r) => (
                  <RunRow key={r.repo} row={r} />
                ))}
              </ul>
              <p data-ui="run-summary" role="status" className="m-0">
                {current.state === "running" ? "Running…" : runSummary(current)}
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * A project's Scripts tab (dev-plans/2026-11-22-projects §7, PJ4): devdeck's starters and the
 * project's own scripts first, then what its repos already have (package.json scripts, Makefile
 * targets). Run opens the sheet.
 */
export function ProjectScripts({ workspace, example }: Readonly<{ workspace: string; example: boolean }>) {
  const list = useScripts(workspace);
  const [open, setOpen] = useState<Script>();
  if (list.isPending) return <output aria-label="Loading scripts…" className="skeleton block h-32 w-full" />;
  if (list.isError) return <p className="m-0 text-ink-3">Could not load the scripts.</p>;
  if (list.data.length === 0) return <QuietEmpty line="No scripts yet · add scripts: to the project's file" />;

  const own = list.data.filter((s) => s.source === "built-in" || s.source === "file");
  const found = list.data.filter((s) => s.source === "package.json" || s.source === "Makefile");
  const grid = (items: Script[], label: string) => (
    <ul aria-label={label} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-3 p-0">
      {items.map((s) => (
        <ScriptCard key={s.id} script={s} example={example} onRun={() => setOpen(s)} />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-6">
      {grid(own, "Scripts")}
      {found.length > 0 && (
        <section aria-label="Found in the repos" className="flex flex-col gap-3">
          <h3 data-ui="scripts-found" className="m-0">
            {"// Found in the repos"}
          </h3>
          {grid(found, "Found scripts")}
        </section>
      )}
      {open && <RunSheet key={open.id} workspace={workspace} script={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
