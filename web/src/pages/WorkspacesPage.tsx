import { Boxes, ChevronDown, FolderOpen, FolderSearch, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { navByPath } from "../app/nav";
import { primaryButton, quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { IssueList, Mark } from "../design/IssueList";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import { useDebounced } from "../lib/use-debounced";
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  usePickFolder,
  useScanFolder,
  useUpdateWorkspace,
  useValidateWorkspace,
  useWorkspace,
  useWorkspaceYaml,
  useWorkspaces,
} from "../lib/queries";
import type { WorkspaceSummary } from "../lib/types";

const th = "px-4 py-2.5 text-start text-[13px] font-medium text-ink-3";
const td = "px-4 py-3";
const field =
  "h-10 w-full min-w-0 rounded-ctl bg-inset px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent";

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

/** What opens under a card: the repos, stacks and flows of the workspace, and its problems. Loaded when the card opens. */
function DetailBody({ id }: { id: string }) {
  const { data, isPending, isError } = useWorkspace(id);
  return (
    <div className="flex flex-col gap-5 px-4 pb-1 pt-2">
      {isPending && <div role="status" aria-label="Loading workspace…" className="skeleton h-4 w-48" />}
      {isError && <p className="m-0 text-ink-3">Could not load this workspace.</p>}
      {data && (
        <>
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
        </>
      )}
    </div>
  );
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

/** Change a workspace's workspace.yaml: the text as it is, checked as it is typed, saved only when it has no errors. */
function EditWorkspace({ id, onSaved }: { id: string; onSaved: () => void }) {
  const file = useWorkspaceYaml(id);
  const [edited, setEdited] = useState<string | null>(null);
  const update = useUpdateWorkspace(id);
  const text = edited ?? file.data?.yaml ?? "";
  const checked = useValidateWorkspace(useDebounced(text, 400));
  const issues = checked.data?.issues ?? [];
  const unchanged = edited === null || edited === file.data?.yaml;
  const blocked = unchanged || update.isPending || checked.data?.valid === false || checked.isPending;

  if (file.isPending) return <div role="status" aria-label="Loading workspace.yaml…" className="skeleton mx-4 h-40" />;
  if (file.isError) {
    return (
      <p role="alert" className="m-0 px-4 text-[14px] text-critical">
        workspace.yaml couldn’t be read: {file.error.message}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
        workspace.yaml
        <textarea
          value={text}
          onChange={(e) => {
            setEdited(e.target.value);
            update.reset();
          }}
          rows={Math.min(28, Math.max(10, text.split("\n").length + 1))}
          spellCheck={false}
          className="w-full resize-y rounded-ctl bg-inset p-3 font-mono text-[13px] leading-5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </label>
      <div aria-live="polite">{issues.length > 0 && <IssueList issues={issues} />}</div>
      {update.error && !(update.error instanceof ApiError && update.error.issues.length > 0) && (
        <p role="alert" className="m-0 text-[14px] text-critical">
          {update.error.message}
        </p>
      )}
      <div>
        <button type="button" onClick={() => update.mutate(text, { onSuccess: onSaved })} disabled={blocked} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}>
          <Save size={18} aria-hidden />
          {update.isPending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90";

/**
 * One workspace as a card. The whole card is the accordion's button: clicking it
 * opens the details under it, and the arrow turns to show it is open. Delete
 * (with a confirmation) is only on the user's own workspaces.
 */
function WorkspaceCard({ w, onDeleted, onEdit }: { w: WorkspaceSummary; onDeleted: () => void; onEdit: () => void }) {
  const del = useDeleteWorkspace();
  const [confirming, setConfirming] = useState(false);
  const mine = w.source === "local";

  return (
    <AccordionItem
      value={w.id}
      role="listitem"
      aria-label={`Workspace ${w.name}`}
      className="relative flex flex-col rounded-sheet bg-surface-1 transition-colors hover:bg-fill/60 data-[state=open]:bg-fill"
    >
      <div className="flex items-start gap-2 p-4 pb-0">
        <div className="min-w-0 flex-1">
          {/* This button covers the whole card (the ::after), so a click anywhere opens the details. */}
          <AccordionTrigger
            hideChevron
            className="block max-w-full truncate p-0 text-[16px] font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:no-underline"
          >
            {w.name}
          </AccordionTrigger>
          {w.root && <p className="m-0 mt-0.5 truncate font-mono text-[12px] text-ink-3">{w.root}</p>}
        </div>
        <span className="shrink-0 rounded-ctl bg-inset px-2 py-0.5 text-[12px] text-ink-3">{mine ? "Yours" : "Example"}</span>
        {mine && (
          <button type="button" onClick={onEdit} title="Edit this workspace's file" aria-label={`Edit ${w.name}`} className={`${iconButton} relative z-10 -mt-1`}>
            <Pencil size={16} aria-hidden />
          </button>
        )}
        {mine && (
          <button type="button" onClick={() => setConfirming(true)} title="Delete this workspace" aria-label={`Delete ${w.name}`} className={`${iconButton} relative z-10 -mt-1`}>
            <Trash2 size={16} aria-hidden />
          </button>
        )}
        <ChevronDown
          size={18}
          aria-hidden
          className="mt-0.5 shrink-0 text-ink-3 transition-transform duration-(--dur-quick) group-data-[state=open]/item:rotate-180"
        />
      </div>

      {w.description && <p className="m-0 line-clamp-2 px-4 pt-3 text-[13px] leading-5 text-ink-3">{w.description}</p>}

      <dl className="m-0 mt-auto flex items-end gap-6 p-4">
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
        <div role="group" aria-label={`Confirm deleting ${w.name}`} className="relative z-10 mx-4 mb-4 flex flex-col gap-2.5 rounded-ctl bg-inset p-3">
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

      {/* Above the card-wide button, so the details can be selected and scrolled. */}
      <AccordionContent className="relative z-10 pb-2">
        <DetailBody id={w.id} />
      </AccordionContent>
    </AccordionItem>
  );
}

const addButton =
  "inline-flex h-9 items-center gap-2 rounded-ctl bg-accent px-3.5 text-[14px] font-medium text-on-accent transition hover:brightness-110 active:scale-[.97]";

export function WorkspacesPage() {
  const item = navByPath("/workspaces");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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

      {isPending && (
        <div role="status" aria-label="Loading workspaces…" className="mt-4 grid grid-cols-1 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton h-36 w-full" />
          ))}
        </div>
      )}
      {isError && <p className="mt-4 text-ink-3">Could not load workspaces.</p>}

      {data && data.length > 0 && (
        // One card open at a time; the open one is kept in the address (?open=) so a link can point at it.
        <Accordion
          type="single"
          collapsible
          role="list"
          value={openId ?? ""}
          onValueChange={(id) => open(id || undefined)}
          className="enter mt-4 flex flex-col gap-3"
          style={stagger(2)}
        >
          {data.map((w) => (
            <WorkspaceCard
              key={w.id}
              w={w}
              onEdit={() => setEditing(w.id)}
              onDeleted={() => {
                if (openId === w.id) open();
              }}
            />
          ))}
        </Accordion>
      )}

      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-0 bg-surface-1 sm:max-w-3xl">
          <SheetHeader className="pe-12 pt-5">
            <SheetTitle className="text-[18px] text-ink">Edit {editing}</SheetTitle>
            <SheetDescription className="text-[14px] leading-5 text-ink-3">
              Change the file as text. It is checked as you type and saved only when it has no errors. The name can’t change. The previous file is kept as workspace.yaml.prev.
            </SheetDescription>
          </SheetHeader>
          {editing && <EditWorkspace id={editing} onSaved={() => setEditing(null)} />}
        </SheetContent>
      </Sheet>

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
