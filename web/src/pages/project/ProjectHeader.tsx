import { Code2, Pencil, Play, Square } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { primaryButton, quietButton } from "../../design/buttons";
import { useStartStack, useStopStack } from "../../lib/queries";
import { PAUSED_TITLE } from "../../lib/server-link";
import type { RunStatus, WorkspaceDetail } from "../../lib/types";
import { useWritesPaused } from "../../lib/use-server-link";
import { projectState } from "../workspaces/project-state";

import { vscodeFolder } from "./vscode-links";

export { vscodeFolder } from "./vscode-links";

/** The run mode the picker starts on: the one running, else the file's default, else the first. */
export function defaultMode(stacks: string[], runs: RunStatus[], preferred?: string): string | undefined {
  return stacks.find((s) => runs.some((r) => r.stack === s && r.state !== "stopped")) ?? (preferred && stacks.includes(preferred) ? preferred : stacks[0]);
}

/**
 * A project's header (dev-plans/2026-11-22-projects §4.3, the design's Projects board): its name,
 * its state, what it is, and what you do with it: pick a run mode and start or stop it, open it in
 * VS Code, edit its file. Starting and stopping are writes, so they wait while the server is gone.
 */
export function ProjectHeader({ project, runs }: Readonly<{ project: WorkspaceDetail; runs: RunStatus[] }>) {
  const modes = project.stacks.map((s) => s.name);
  const mine = runs.filter((r) => r.workspace === project.id);
  const [picked, setPicked] = useState<string>();
  const mode = picked && modes.includes(picked) ? picked : defaultMode(modes, mine, project.default_mode);
  const run = mine.find((r) => r.stack === mode && r.state !== "stopped");
  const state = projectState(project, mine);
  const start = useStartStack();
  const stop = useStopStack();
  const paused = useWritesPaused();
  const sample = project.source === "example";
  const ref = mode ? { workspace: project.id, stack: mode } : undefined;
  const busy = start.isPending || stop.isPending || run?.state === "stopping";
  const startWhy = paused ? PAUSED_TITLE : sample ? "Example projects can't be started. Add your own project to run it." : undefined;

  return (
    <header data-ui="project-head" className="enter">
      <div data-ui="project-head-in" className="flex flex-wrap items-center gap-x-8 gap-y-4 p-6">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 data-ui="project-title" className="m-0">
              {project.name}
              <span aria-hidden>.</span>
            </h1>
            <span data-ui="project-state" data-tone={state.tone}>
              {state.tone === "good" && <span data-ui="project-live" aria-hidden />}
              {state.text}
            </span>
          </div>
          {project.description && <p className="m-0 max-w-[70ch] text-[14px] leading-6 text-ink-3">{project.description}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {modes.length > 0 && (
            <label data-ui="project-mode" className="flex items-center gap-2">
              <span data-ui="project-mode-label">Mode</span>
              <select value={mode} onChange={(e) => setPicked(e.target.value)} aria-label="Run mode" className="h-[34px] min-w-28 bg-fill px-2 text-[13px] text-ink outline-none">
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          )}
          {ref &&
            (run ? (
              <button type="button" onClick={() => stop.mutate(ref)} disabled={busy || paused} title={paused ? PAUSED_TITLE : `Stop ${mode}`} className={quietButton}>
                <Square size={13} fill="currentColor" aria-hidden />
                {stop.isPending || run.state === "stopping" ? "Stopping…" : "Stop"}
              </button>
            ) : (
              <button type="button" onClick={() => start.mutate(ref)} disabled={busy || Boolean(startWhy)} title={startWhy ?? `Start ${mode}`} className={primaryButton}>
                <Play size={14} fill="currentColor" aria-hidden />
                {start.isPending ? "Starting…" : "Start"}
              </button>
            ))}
          {project.root_path && (
            <a href={vscodeFolder(project.root_path)} title={`Open ${project.root_path} in VS Code`} className={quietButton}>
              <Code2 size={15} aria-hidden />
              Open in VS Code
            </a>
          )}
          {!sample && (
            <Link to={`/workspaces/${encodeURIComponent(project.id)}/edit`} viewTransition title="Edit the project's file" className={quietButton}>
              <Pencil size={14} aria-hidden />
              Edit file
            </Link>
          )}
        </div>
      </div>
      {start.error && (
        <p role="alert" className="m-0 px-6 pb-4 text-[13px] text-critical">
          {start.error.message}
        </p>
      )}
    </header>
  );
}
