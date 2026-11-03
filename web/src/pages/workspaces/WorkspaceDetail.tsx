import { Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { quietButton } from "../../design/buttons";
import { Mark } from "../../design/IssueList";
import { Tabs } from "../../design/Tabs";
import { useGitRepos } from "../../lib/git";
import { useDeleteWorkspace, useWorkspace } from "../../lib/queries";
import type { Issue, WorkspaceDetail as Detail } from "../../lib/types";
import { useWorkspaceFile } from "../../lib/workspace-file";
import { RepoTable } from "./RepoTable";

type Tab = "repos" | "stacks" | "problems" | "settings";

const editUrl = (id: string, line?: number) => `/workspaces/${encodeURIComponent(id)}/edit${line ? `?line=${line}` : ""}`;

function Stacks({ id, d }: Readonly<{ id: string; d: Detail }>) {
  if (d.stacks.length === 0 && d.flows.length === 0) return <p className="m-0 py-4 text-[14px] text-ink-3">No stacks or flows yet. They are files in this workspace's folder.</p>;
  return (
    <div className="flex flex-col gap-4">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {d.stacks.map((s) => {
          const services = (s.services?.length ?? 0) + (s.compose?.length ?? 0);
          return (
            <li key={s.name} className="flex flex-wrap items-center gap-3 bg-surface-1 px-4 py-3">
              <div className="min-w-0 flex-1">
                <b className="text-[15px] font-semibold text-ink">{s.name}</b>
                {s.description && <p className="m-0 mt-0.5 text-[13px] text-ink-3">{s.description}</p>}
                <p className="m-0 mt-0.5 text-[12.5px] text-ink-3">{services} {services === 1 ? "item" : "items"}</p>
              </div>
              <Link to={`/stacks?workspace=${encodeURIComponent(id)}`} className={quietButton}>
                Open stack
              </Link>
            </li>
          );
        })}
      </ul>
      {d.flows.length > 0 && (
        <p className="m-0 text-[13px] text-ink-2">
          <span className="text-ink-3">Flows: </span>
          {d.flows.map((f) => f.name).join(", ")}
        </p>
      )}
    </div>
  );
}

function Problems({ id, issues, mine }: Readonly<{ id: string; issues: Issue[]; mine: boolean }>) {
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

function Settings({ id, d, mine, onDeleted }: Readonly<{ id: string; d: Detail; mine: boolean; onDeleted: () => void }>) {
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
            <div role="group" aria-label={`Confirm deleting ${d.name}`} className="flex flex-col gap-2.5">
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
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** One workspace in full: its repos with their git state, its stacks, its problems, and its settings. */
export function WorkspaceDetail({ id, onDeleted }: Readonly<{ id: string; onDeleted: () => void }>) {
  const { data, isPending, isError } = useWorkspace(id);
  const git = useGitRepos();
  const [tab, setTab] = useState<Tab>("repos");

  if (isPending) return <div role="status" aria-label="Loading workspace…" className="skeleton h-40 w-full" />;
  if (isError || !data) return <p className="m-0 text-ink-3">Could not load this workspace.</p>;

  const mine = data.source === "local";
  const problems = data.issues.length;
  const repos = data.workspace?.repos ?? [];

  return (
    <section aria-label={`Details of ${data.name}`} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="m-0 text-[18px] font-semibold text-ink">{data.name}</h2>
        <span className="font-mono text-[12.5px] text-ink-3">workspace.yaml</span>
        <span className="flex-1" />
        {mine && (
          <Link to={editUrl(id)} className={quietButton}>
            <Pencil size={14} aria-hidden /> Edit file
          </Link>
        )}
      </div>

      <Tabs
        label="Workspace sections"
        value={tab}
        onChange={setTab}
        items={[
          { value: "repos", label: "Repositories", count: repos.length },
          { value: "stacks", label: "Stacks", count: data.stacks.length },
          { value: "problems", label: "Problems", count: problems },
          { value: "settings", label: "Settings" },
        ]}
      />

      <div role="tabpanel" aria-label={tab}>
        {tab === "repos" && <RepoTable workspace={id} repos={repos} git={(git.data ?? []).filter((g) => g.workspace === id)} />}
        {tab === "stacks" && <Stacks id={id} d={data} />}
        {tab === "problems" && <Problems id={id} issues={data.issues} mine={mine} />}
        {tab === "settings" && <Settings id={id} d={data} mine={mine} onDeleted={onDeleted} />}
      </div>
    </section>
  );
}
