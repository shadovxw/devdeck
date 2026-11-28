import { FileCog } from "lucide-react";
import { useState } from "react";

import { primaryButton, quietButton } from "../../design/buttons";
import { conversionSummary, useConversion, useConvert } from "../../lib/convert";
import { PAUSED_TITLE } from "../../lib/server-link";
import { useWritesPaused } from "../../lib/use-server-link";

/**
 * Offers to turn a project's workspace.yaml and stacks/ into one project.yaml (dev-plans/2026-11-22-projects
 * §5, PJ9). Offered, never forced: the new file is shown first, nothing is written until Convert, and the
 * old files are kept next to it as workspace.yaml.v1 and stacks.v1.
 */
export function ConvertCard({ workspace }: Readonly<{ workspace: string }>) {
  const [open, setOpen] = useState(false);
  const preview = useConversion(workspace, open);
  const convert = useConvert(workspace);
  const paused = useWritesPaused();
  const c = preview.data;
  const errors = c?.issues.filter((i) => i.severity === "error") ?? [];

  return (
    <section aria-label="Convert to project.yaml" data-ui="vscode-panel" className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <FileCog size={16} aria-hidden className="text-ink-3" />
        <div className="flex min-w-0 flex-1 flex-col">
          <b className="text-[14px] text-ink">One file: project.yaml</b>
          <span className="text-[12.5px] text-ink-3" title="Repos, run modes, databases and scripts in one file. The project runs the same.">
            Optional · workspace.yaml and stacks/ become one file
          </span>
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={quietButton}>
          {open ? "Hide" : "Review"}
        </button>
      </div>

      {open && preview.isPending && <output aria-label="Building project.yaml…" className="skeleton block h-40" />}
      {open && preview.isError && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {preview.error.message}
        </p>
      )}
      {open && c && (
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[12px] text-ink-3">{conversionSummary(c)}</span>
          {c.issues.length > 0 && (
            <ul aria-label="Problems in the new file" data-ui="db-warnings" className="m-0 flex list-none flex-col gap-1.5 p-3">
              {c.issues.map((i, n) => (
                <li key={n} className="text-[13px] text-ink-2">
                  {i.severity === "error" ? "Error" : "Warning"} · line {i.line}: {i.message}
                </li>
              ))}
            </ul>
          )}
          <pre data-ui="vscode-preview" aria-label="The project.yaml devdeck will write" className="m-0 max-h-96 overflow-auto p-3 font-mono text-[12px] leading-5 text-ink-2">
            {c.yaml}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => convert.mutate()}
              disabled={convert.isPending || paused || errors.length > 0}
              title={paused ? PAUSED_TITLE : errors.length > 0 ? "Fix the errors first" : undefined}
              className={primaryButton}
            >
              {convert.isPending ? "Converting…" : "Convert"}
            </button>
            <span className="text-[12.5px] text-ink-3">The old files stay next to it as workspace.yaml.v1 and stacks.v1.</span>
          </div>
        </div>
      )}
      {convert.error && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {convert.error.message}
        </p>
      )}
    </section>
  );
}
