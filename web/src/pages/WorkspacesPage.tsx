import { Boxes, FolderSearch, Plus, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { navByPath } from "../app/nav";
import { primaryButton, quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { StatusMark } from "../design/StatusMark";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import {
  useCreateWorkspace,
  useScanFolder,
  useValidateWorkspace,
  useWorkspace,
  useWorkspaces,
} from "../lib/queries";
import type { Issue, WorkspaceSummary } from "../lib/types";

const th = "px-4 py-2.5 text-start text-[13px] font-medium text-ink-3";
const td = "px-4 py-3";
const field =
  "h-10 w-full min-w-0 rounded-ctl bg-inset px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent";

/** Same shapes as the status pills: an error is a square, a warning a triangle. */
function Mark({ severity }: { severity: Issue["severity"] }) {
  return <StatusMark level={severity === "error" ? "fail" : "warn"} />;
}

function IssueCount({ errors, warnings }: { errors: number; warnings: number }) {
  if (!errors && !warnings) return <span className="text-ink-3">None</span>;
  return (
    <span className="inline-flex items-center gap-3 tabular-nums">
      {errors > 0 && (
        <span className="inline-flex items-center gap-1.5" title={`${errors} error${errors === 1 ? "" : "s"}`}>
          <Mark severity="error" />
          {errors}
        </span>
      )}
      {warnings > 0 && (
        <span className="inline-flex items-center gap-1.5" title={`${warnings} warning${warnings === 1 ? "" : "s"}`}>
          <Mark severity="warning" />
          {warnings}
        </span>
      )}
    </span>
  );
}

/** Problems found in config files, grouped by file, each with its line. */
function IssueList({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return <p className="m-0 text-[14px] text-ink-3">No problems found.</p>;
  }
  const byFile = new Map<string, Issue[]>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  return (
    <div className="flex flex-col gap-4">
      {[...byFile].map(([file, list]) => (
        <div key={file}>
          <p className="m-0 mb-1.5 font-mono text-[13px] text-ink-2">{file}</p>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {list.map((i, n) => (
              <li key={n} className="flex items-start gap-2.5 text-[14px] leading-5">
                <span className="mt-[3px]">
                  <Mark severity={i.severity} />
                </span>
                <span className="w-14 shrink-0 font-mono text-[13px] tabular-nums text-ink-3">{i.line ? `line ${i.line}` : ""}</span>
                <span className="min-w-0 text-ink-2">
                  <span className="sr-only">{i.severity === "error" ? "Error: " : "Warning: "}</span>
                  {i.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError } = useWorkspace(id);
  return (
    <section className="enter mt-3 rounded-sheet bg-surface-1 p-4" aria-label="Workspace details">
      {isPending && <div role="status" aria-label="Loading workspace…" className="skeleton h-4 w-48" />}
      {isError && <p className="m-0 text-ink-3">Could not load this workspace.</p>}
      {data && (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-[18px] font-semibold text-ink">{data.name}</h2>
              {data.description && <p className="m-0 mt-1 text-[14px] text-ink-3">{data.description}</p>}
              {data.root && <p className="m-0 mt-1 font-mono text-[13px] text-ink-3">{data.root}</p>}
            </div>
            <button type="button" onClick={onClose} title="Close" aria-label="Close details" className="grid size-8 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90">
              <X size={16} aria-hidden />
            </button>
          </div>

          {data.workspace?.repos && data.workspace.repos.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr>
                    <th className={th}>Repository</th>
                    <th className={th}>Folder</th>
                    <th className={th}>Type</th>
                    <th className={th}>Remote</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workspace.repos.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className={`${td} font-mono text-[13px]`}>{r.id}</td>
                      <td className={`${td} font-mono text-[13px] text-ink-2`}>{r.path}</td>
                      <td className={`${td} text-ink-3`}>{r.type}</td>
                      <td className={`${td} font-mono text-[13px] text-ink-3`}>{r.remote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(data.stacks.length > 0 || data.flows.length > 0) && (
            <p className="m-0 text-[14px] text-ink-2">
              {data.stacks.length > 0 && <>Stacks: {data.stacks.map((s) => s.name).join(", ")}. </>}
              {data.flows.length > 0 && <>Flows: {data.flows.map((f) => f.name).join(", ")}.</>}
            </p>
          )}

          <div>
            <h3 className="m-0 mb-2 text-[13px] font-medium text-ink-3">Problems</h3>
            <IssueList issues={data.issues} />
          </div>
        </div>
      )}
    </section>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Scan a folder, review the drafted workspace.yaml, then save it. */
function AddWorkspace({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [root, setRoot] = useState("");
  const [yaml, setYaml] = useState("");
  const scan = useScanFolder();
  const create = useCreateWorkspace();
  const checked = useValidateWorkspace(useDebounced(yaml, 400));

  const found = scan.data;
  const issues = checked.data?.issues ?? [];
  const blocked = !yaml.trim() || create.isPending || checked.data?.valid === false || checked.isPending;

  function submitScan(e: FormEvent) {
    e.preventDefault();
    create.reset();
    scan.mutate(root, { onSuccess: (res) => setYaml(res.yaml) });
  }

  function save() {
    create.mutate(yaml, { onSuccess: (sum) => onCreated(sum.id) });
  }

  return (
    <section className="enter mt-3 flex flex-col gap-4 rounded-sheet bg-surface-1 p-4" aria-label="Add workspace">
      <div className="flex items-center gap-3">
        <h2 className="m-0 flex-1 text-[18px] font-semibold text-ink">Add a workspace</h2>
        <button type="button" onClick={onClose} title="Close" aria-label="Close add workspace" className="grid size-8 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90">
          <X size={16} aria-hidden />
        </button>
      </div>

      <form onSubmit={submitScan} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[240px] flex-1 flex-col gap-1.5 text-[13px] text-ink-3">
          Folder that contains your repositories
          <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="~/code" spellCheck={false} autoComplete="off" className={`${field} font-mono`} />
        </label>
        <button type="submit" disabled={!root.trim() || scan.isPending} className={`${quietButton} h-10 disabled:opacity-50`}>
          <FolderSearch size={17} aria-hidden />
          {scan.isPending ? "Scanning…" : "Scan folder"}
        </button>
      </form>
      {scan.isError && (
        <p role="alert" className="m-0 text-[14px] text-critical">
          {scan.error.message}
        </p>
      )}

      {found && (
        <>
          <p className="m-0 text-[14px] text-ink-2">
            Found {found.repos.length} {found.repos.length === 1 ? "repository" : "repositories"} in <span className="font-mono text-[13px]">{found.root}</span>
            {found.truncated ? ". Only the first 200 are kept." : "."} Review the file below. It is saved as you see it.
          </p>
          <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
            workspace.yaml
            <textarea
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              rows={Math.min(18, Math.max(8, yaml.split("\n").length + 1))}
              spellCheck={false}
              className="w-full resize-y rounded-ctl bg-inset p-3 font-mono text-[13px] leading-5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>
          <div aria-live="polite">{issues.length > 0 && <IssueList issues={issues} />}</div>
          {create.error && !(create.error instanceof ApiError && create.error.issues.length > 0) && (
            <p role="alert" className="m-0 text-[14px] text-critical">
              {create.error instanceof ApiError ? create.error.message : "The workspace couldn’t be saved."}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button type="button" onClick={save} disabled={blocked} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}>
              <Plus size={18} aria-hidden />
              Create workspace
            </button>
            <button type="button" onClick={onClose} className={quietButton}>
              Cancel
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function Row({ w, open, onOpen }: { w: WorkspaceSummary; open: boolean; onOpen: () => void }) {
  return (
    <tr className={`border-t border-line hover:bg-fill/60 ${open ? "bg-fill/60" : ""}`}>
      <td className={td}>
        <button type="button" onClick={onOpen} aria-expanded={open} className="text-start font-medium text-ink hover:underline">
          {w.name}
        </button>
        {w.description && <p className="m-0 mt-0.5 max-w-[60ch] truncate text-[13px] text-ink-3">{w.description}</p>}
      </td>
      <td className={`${td} text-ink-3`}>{w.source === "example" ? "Example" : "Yours"}</td>
      <td className={`${td} tabular-nums`}>{w.repos}</td>
      <td className={`${td} hidden tabular-nums md:table-cell`}>{w.stacks}</td>
      <td className={`${td} hidden tabular-nums md:table-cell`}>{w.flows}</td>
      <td className={td}>
        <IssueCount errors={w.errors} warnings={w.warnings} />
      </td>
    </tr>
  );
}

export function WorkspacesPage() {
  const item = navByPath("/workspaces");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError } = useWorkspaces();
  const openId = params.get("open") ?? undefined;

  function open(id?: string) {
    setParams(id ? { open: id } : {}, { replace: true });
  }

  const showEmpty = data && data.length === 0 && !adding;

  return (
    <>
      <PageHeader title={item.label} group={item.group} />

      {showEmpty && item.empty && <EmptyState icon={Boxes} empty={item.empty} onCta={() => setAdding(true)} />}

      {adding && (
        <AddWorkspace
          onClose={() => setAdding(false)}
          onCreated={(id) => {
            setAdding(false);
            open(id);
          }}
        />
      )}

      {!showEmpty && !(adding && data?.length === 0) && (
        <section className="enter mt-4 rounded-sheet bg-surface-1" style={stagger(1)}>
          <div className="flex items-center gap-2 px-4 py-3">
            <p className="m-0 flex-1 text-[13px] text-ink-3">{data ? `${data.length} ${data.length === 1 ? "workspace" : "workspaces"}` : ""}</p>
            {!adding && (
              <button type="button" onClick={() => setAdding(true)} className="inline-flex h-9 items-center gap-2 rounded-ctl px-3 text-[14px] text-ink-2 transition hover:bg-accent-soft hover:text-ink active:scale-[.97]">
                <Plus size={16} aria-hidden />
                Add workspace
              </button>
            )}
          </div>

          {isPending && (
            <div role="status" aria-label="Loading workspaces…" className="flex flex-col gap-4 px-4 pb-6 pt-2">
              {[0, 1].map((i) => (
                <div key={i} className="flex items-center gap-8">
                  <div className="skeleton h-4 w-40" />
                  <div className="skeleton h-4 w-16" />
                  <div className="skeleton h-4 w-10" />
                </div>
              ))}
            </div>
          )}
          {isError && <p className="m-0 px-4 py-8 text-ink-3">Could not load workspaces.</p>}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr>
                    <th className={th}>Workspace</th>
                    <th className={th}>From</th>
                    <th className={th}>Repos</th>
                    <th className={`${th} hidden md:table-cell`}>Stacks</th>
                    <th className={`${th} hidden md:table-cell`}>Flows</th>
                    <th className={th}>Problems</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((w) => (
                    <Row key={w.id} w={w} open={openId === w.id} onOpen={() => open(openId === w.id ? undefined : w.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {openId && !adding && <Detail id={openId} onClose={() => open()} />}
    </>
  );
}
