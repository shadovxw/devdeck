import { Boxes, FolderOpen, FolderSearch, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { navByPath } from "../app/nav";
import { primaryButton, quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { StatusMark } from "../design/StatusMark";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  usePickFolder,
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

/** Scan a folder, review the drafted workspace.yaml, then save it. Lives in the drawer. */
function AddWorkspace({ onCreated }: { onCreated: (id: string) => void }) {
  const [root, setRoot] = useState("");
  const [yaml, setYaml] = useState("");
  const scan = useScanFolder();
  const pick = usePickFolder();
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

  /** Choose the folder in the system's own dialog, then look at it straight away. */
  function browse() {
    create.reset();
    pick.mutate(undefined, {
      onSuccess: (res) => {
        if (!res?.path) return; // the dialog was closed without choosing
        setRoot(res.path);
        scan.mutate(res.path, { onSuccess: (found) => setYaml(found.yaml) });
      },
    });
  }

  function save() {
    create.mutate(yaml, { onSuccess: (sum) => onCreated(sum.id) });
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <form onSubmit={submitScan} className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-[13px] text-ink-3">
          Folder that contains your repositories
          <input value={root} onChange={(e) => setRoot(e.target.value)} placeholder="~/code" spellCheck={false} autoComplete="off" className={`${field} font-mono`} />
        </label>
        <button type="button" onClick={browse} disabled={pick.isPending || scan.isPending} title="Choose the folder in a window" className={`${quietButton} h-10 disabled:opacity-50`}>
          <FolderOpen size={17} aria-hidden />
          {pick.isPending ? "Waiting for you…" : "Browse…"}
        </button>
        <button type="submit" disabled={!root.trim() || scan.isPending || pick.isPending} className={`${quietButton} h-10 disabled:opacity-50`}>
          <FolderSearch size={17} aria-hidden />
          {scan.isPending ? "Scanning…" : "Scan folder"}
        </button>
      </form>
      {pick.isPending && (
        <p role="status" className="m-0 text-[13px] text-ink-3">
          A folder window has opened. If you can’t see it, look for it in the taskbar.
        </p>
      )}
      {pick.isError && (
        <p role="alert" className="m-0 text-[14px] text-critical">
          {pick.error.message}
        </p>
      )}
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
          <div>
            <button type="button" onClick={save} disabled={blocked} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}>
              <Plus size={18} aria-hidden />
              Create workspace
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90";

/** One workspace as a card: its counts, its problems, and delete (with a confirmation) for the user's own. */
function WorkspaceCard({ w, open, onOpen, onDeleted }: { w: WorkspaceSummary; open: boolean; onOpen: () => void; onDeleted: () => void }) {
  const del = useDeleteWorkspace();
  const [confirming, setConfirming] = useState(false);
  const mine = w.source === "local";

  return (
    <li className={`relative flex min-w-0 flex-col gap-3 rounded-sheet p-4 transition-colors ${open ? "bg-fill" : "bg-surface-1 hover:bg-fill/60"}`} aria-label={`Workspace ${w.name}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* The name's button covers the whole card, so a click anywhere opens the details. */}
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={open}
            className="block max-w-full truncate text-start text-[16px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:underline"
          >
            {w.name}
          </button>
          {w.root && <p className="m-0 mt-0.5 truncate font-mono text-[12px] text-ink-3">{w.root}</p>}
        </div>
        <span className="shrink-0 rounded-ctl bg-inset px-2 py-0.5 text-[12px] text-ink-3">{mine ? "Yours" : "Example"}</span>
        {mine && (
          <button type="button" onClick={() => setConfirming(true)} title="Delete this workspace" aria-label={`Delete ${w.name}`} className={`${iconButton} relative z-10 -me-1 -mt-1`}>
            <Trash2 size={16} aria-hidden />
          </button>
        )}
      </div>

      {w.description && <p className="m-0 line-clamp-2 text-[13px] leading-5 text-ink-3">{w.description}</p>}

      <dl className="m-0 mt-auto flex items-end gap-6">
        {(
          [
            ["Repos", w.repos],
            ["Stacks", w.stacks],
            ["Flows", w.flows],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-[12px] text-ink-3">{label}</dt>
            <dd className="m-0 text-[20px] font-bold leading-none tabular-nums text-ink">{n}</dd>
          </div>
        ))}
        <div className="ms-auto flex flex-col items-end gap-0.5 text-[13px]">
          <dt className="text-[12px] text-ink-3">Problems</dt>
          <dd className="m-0">
            <IssueCount errors={w.errors} warnings={w.warnings} />
          </dd>
        </div>
      </dl>

      {confirming && (
        <div role="group" aria-label={`Confirm deleting ${w.name}`} className="relative z-10 flex flex-col gap-2.5 rounded-ctl bg-inset p-3">
          <p className="m-0 text-[13px] leading-5 text-ink-2">
            Delete “{w.name}”? Its files move to a trash folder inside your workspaces folder. Your repositories aren’t touched.
          </p>
          {del.error && (
            <p role="alert" className="m-0 text-[13px] text-critical">
              {del.error.message}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => del.mutate(w.id, { onSuccess: onDeleted })}
              disabled={del.isPending}
              className="inline-flex h-8 items-center rounded-ctl bg-critical px-3 text-[13px] font-medium text-white transition hover:brightness-110 active:scale-[.97] disabled:opacity-50"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                del.reset();
              }}
              disabled={del.isPending}
              className={`${quietButton} !h-8 !px-3 !text-[13px]`}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

const addButton =
  "inline-flex h-9 items-center gap-2 rounded-ctl bg-accent px-3.5 text-[14px] font-medium text-on-accent transition hover:brightness-110 active:scale-[.97]";

export function WorkspacesPage() {
  const item = navByPath("/workspaces");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError } = useWorkspaces();
  const openId = params.get("open") ?? undefined;

  function open(id?: string) {
    setParams(id ? { open: id } : {}, { replace: true });
  }

  const showEmpty = data && data.length === 0;

  return (
    <>
      <PageHeader
        title={item.label}
        group={item.group}
        actions={
          !showEmpty && (
            <button type="button" onClick={() => setAdding(true)} className={addButton}>
              <Plus size={16} aria-hidden />
              Add workspace
            </button>
          )
        }
      />

      {showEmpty && item.empty && <EmptyState icon={Boxes} empty={item.empty} onCta={() => setAdding(true)} />}

      {openId && <Detail id={openId} onClose={() => open()} />}

      {isPending && (
        <div role="status" aria-label="Loading workspaces…" className="mt-4 grid grid-cols-1 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-36 w-full" />
          ))}
        </div>
      )}
      {isError && <p className="mt-4 text-ink-3">Could not load workspaces.</p>}

      {data && data.length > 0 && (
        <ul className="enter m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0" style={stagger(2)}>
          {data.map((w) => (
            <WorkspaceCard
              key={w.id}
              w={w}
              open={openId === w.id}
              onOpen={() => open(openId === w.id ? undefined : w.id)}
              onDeleted={() => {
                if (openId === w.id) open();
              }}
            />
          ))}
        </ul>
      )}

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-0 bg-surface-1 sm:max-w-2xl">
          <SheetHeader className="pe-12 pt-5">
            <SheetTitle className="text-[18px] text-ink">Add a workspace</SheetTitle>
            <SheetDescription className="text-[14px] leading-5 text-ink-3">
              Choose the folder that contains your repositories. devdeck drafts a workspace file for you to review before anything is saved.
            </SheetDescription>
          </SheetHeader>
          <AddWorkspace
            onCreated={(id) => {
              setAdding(false);
              open(id);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
