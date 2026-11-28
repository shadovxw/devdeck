// The parts of a project page that are about its file: its problems and its settings (pages/ProjectPage.tsx).
import { useState } from "react";
import { Link } from "react-router";

import { quietButton } from "../../design/buttons";
import { Mark } from "../../design/IssueList";
import { useDeleteWorkspace } from "../../lib/queries";
import type { Issue, WorkspaceDetail as Detail } from "../../lib/types";
import { ConvertCard } from "../project/ConvertCard";
import { PosterSetting } from "../project/PosterSetting";
import { useWorkspaceFile } from "../../lib/workspace-file";


const editUrl = (id: string, line?: number) => {
  const base = `/workspaces/${encodeURIComponent(id)}/edit`;
  return line ? `${base}?line=${line}` : base;
};

export function Problems({ id, issues, mine }: Readonly<{ id: string; issues: Issue[]; mine: boolean }>) {
  if (issues.length === 0) return <p className="m-0 py-4 text-[14px] text-ink-3">No problems found.</p>;
  const byFile = new Map<string, Issue[]>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  return (
    <div className="flex flex-col gap-5">
      {[...byFile].map(([file, list]) => (
        <section key={file}>
          <h3 className="m-0 mb-2 font-mono text-[13px] font-medium text-ink-2">
            {file} <span className="font-sans text-ink-3">· {list.length} {list.length === 1 ? "problem" : "problems"}</span>
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {list.map((i, n) => (
              <li key={`${i.line}-${n}`} className="flex flex-wrap items-start gap-2.5 bg-surface-1 px-3 py-2.5 text-[14px] leading-5">
                <span className="mt-[3px]">
                  <Mark severity={i.severity} />
                </span>
                <span className="w-14 shrink-0 font-mono text-[13px] tabular-nums text-ink-3">{i.line ? `line ${i.line}` : ""}</span>
                <span className="min-w-0 flex-1 text-ink-2">
                  <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
                  {i.message}
                  {(i.fixes ?? []).length > 0 && <span className="block text-[12.5px] text-ink-3">Can be fixed: {i.fixes?.map((f) => f.label).join(" or ")}.</span>}
                </span>
                {mine && file === "workspace.yaml" && (
                  <Link to={editUrl(id, i.line)} className={`${quietButton} !h-7 !px-2.5 !text-[12.5px]`}>
                    {(i.fixes ?? []).length > 0 ? "Fix in the editor" : "Open in the editor"}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function Settings({ id, d, mine, onDeleted }: Readonly<{ id: string; d: Detail; mine: boolean; onDeleted: () => void }>) {
  const file = useWorkspaceFile(id);
  const del = useDeleteWorkspace();
  const [confirming, setConfirming] = useState(false);
  const fact = (name: string, value: string | undefined) =>
    value ? (
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 py-1.5">
        <dt className="w-28 shrink-0 text-[13px] text-ink-3">{name}</dt>
        <dd className="m-0 min-w-0 break-all font-mono text-[13px] text-ink">{value}</dd>
      </div>
    ) : null;

  return (
    <div className="flex flex-col gap-6">
      <dl className="m-0">
        {fact("Root folder", d.workspace?.root)}
        {fact("File", file.data?.path)}
        {fact("Description", d.description)}
        {fact("Kind", mine ? "Yours" : "Example (read only)")}
      </dl>

      {mine && <PosterSetting id={id} project={d} />}

      {mine && d.file !== "project.yaml" && <ConvertCard workspace={id} />}

      {mine && (
        <section aria-label="Danger zone" className="flex flex-col gap-2.5 bg-surface-1 p-4">
          <h3 className="m-0 text-[14px] font-semibold text-ink">Delete this workspace</h3>
          <p className="m-0 text-[13px] leading-5 text-ink-3">Its files move to a trash folder inside your workspaces folder. Your repositories aren’t touched.</p>
          {!confirming ? (
            <div>
              <button type="button" onClick={() => setConfirming(true)} className={quietButton}>
                Delete {d.name}…
              </button>
            </div>
          ) : (
            <fieldset aria-label={`Confirm deleting ${d.name}`} className="m-0 flex min-w-0 flex-col gap-2.5 border-0 p-0">
              <p className="m-0 text-[13px] leading-5 text-ink-2">Delete “{d.name}”?</p>
              {del.error && (
                <p role="alert" className="m-0 text-[13px] text-critical">
                  {del.error.message}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => del.mutate(id, { onSuccess: onDeleted })}
                  disabled={del.isPending}
                  className="inline-flex h-[34px] items-center bg-critical px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-critical/90 disabled:opacity-50"
                >
                  {del.isPending ? "Deleting…" : "Delete"}
                </button>
                <button
                  type="button"
                  disabled={del.isPending}
                  onClick={() => {
                    setConfirming(false);
                    del.reset();
                  }}
                  className={quietButton}
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          )}
        </section>
      )}
    </div>
  );
}
