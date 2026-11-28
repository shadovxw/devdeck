import { Code2, FileCode2 } from "lucide-react";
import { useState } from "react";

import { primaryButton, quietButton } from "../../design/buttons";
import { PAUSED_TITLE } from "../../lib/server-link";
import { useWritesPaused } from "../../lib/use-server-link";
import { fileCounts, useVSCodeFile, useWriteVSCodeFile } from "../../lib/vscode";
import { vscodeFolder } from "./vscode-links";

const STATE_TEXT = { new: "not written yet", same: "up to date", changed: "differs from the file on disk" } as const;

/**
 * The project's VS Code workspace file (dev-plans/2026-11-22-projects PJ7): every repo as a
 * folder, the schemas for devdeck's files, and a task per script and run mode, so "Run Task"
 * lists them. It is shown for review first and only written once you say so.
 */
export function ProjectVSCode({ workspace, example }: Readonly<{ workspace: string; example: boolean }>) {
  const file = useVSCodeFile(workspace);
  const write = useWriteVSCodeFile(workspace);
  const paused = useWritesPaused();
  const [open, setOpen] = useState(false);
  if (!file.data) return null; // loading, or the project file has problems (the Problems tab says which)
  const f = file.data;
  const { folders, tasks } = fileCounts(f.content);
  const writeWhy = paused ? PAUSED_TITLE : example ? "Example projects have no folder to write to" : undefined;

  return (
    <section aria-label="VS Code workspace" data-ui="vscode-panel" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FileCode2 size={16} aria-hidden className="text-ink-3" />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="text-[14px] text-ink">VS Code workspace</b>
          <span className="truncate font-mono text-[12px] text-ink-3" title={f.path}>
            {folders} folders · {tasks} tasks · <span data-ui="vscode-state" data-state={f.state}>{STATE_TEXT[f.state]}</span>
          </span>
        </div>
        {f.state !== "same" && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={quietButton}>
            {open ? "Hide" : "Review"}
          </button>
        )}
        {f.state === "same" && (
          <a href={vscodeFolder(f.path)} title={`Open ${f.path} in VS Code`} className={primaryButton}>
            <Code2 size={15} aria-hidden />
            Open workspace
          </a>
        )}
      </div>

      {open && f.state !== "same" && (
        <div className="flex flex-col gap-3">
          <pre data-ui="vscode-preview" aria-label="The file devdeck will write" className="m-0 max-h-80 overflow-auto p-3 font-mono text-[12px] leading-5 text-ink-2">
            {f.content}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => write.mutate()} disabled={write.isPending || Boolean(writeWhy)} title={writeWhy} className={primaryButton}>
              {write.isPending ? "Writing…" : f.state === "changed" ? "Replace the file" : "Write the file"}
            </button>
            <span className="min-w-0 truncate font-mono text-[12px] text-ink-3" title={f.path}>
              {f.path}
            </span>
          </div>
        </div>
      )}
      {write.error && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {write.error.message}
        </p>
      )}
    </section>
  );
}
