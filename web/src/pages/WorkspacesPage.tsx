import { Boxes, FolderOpen, FolderSearch, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { navByPath } from "../app/nav";
import { primaryButton, quietButton } from "../design/buttons";
import { EmptyState } from "../design/EmptyState";
import { PageHeader } from "../design/PageHeader";
import { IssueList } from "../design/IssueList";
import { ApiError } from "../lib/api";
import { stagger } from "../lib/motion";
import { useDebounced } from "../lib/use-debounced";
import { useCreateWorkspace, usePickFolder, useScanFolder, useValidateWorkspace, useWorkspaces } from "../lib/queries";
import { WorkspaceCards } from "./workspaces/WorkspaceCards";
import { WorkspaceDetail } from "./workspaces/WorkspaceDetail";

const field =
  "h-10 w-full min-w-0 rounded-ctl bg-inset px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none " +
  "focus-visible:ring-2 focus-visible:ring-accent";

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

export function WorkspacesPage() {
  const item = navByPath("/workspaces");
  const [params, setParams] = useSearchParams();
  const [adding, setAdding] = useState(false);
  const { data, isPending, isError } = useWorkspaces();

  // The selected workspace is kept in the address (?open=) so a link can point at it. With none chosen, the first shows.
  const chosen = params.get("open") ?? undefined;
  const selected = data?.find((w) => w.id === chosen)?.id ?? data?.[0]?.id;

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
            <button type="button" onClick={() => setAdding(true)} className={primaryButton}>
              <Plus size={16} aria-hidden />
              Add workspace
            </button>
          )
        }
      />

      {showEmpty && item.empty && <EmptyState icon={Boxes} empty={item.empty} onCta={() => setAdding(true)} />}

      {isPending && (
        <div role="status" aria-label="Loading workspaces…" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="skeleton h-40 w-full" />
          ))}
        </div>
      )}
      {isError && <p className="mt-4 text-ink-3">Could not load workspaces.</p>}

      {data && data.length > 0 && (
        <div className="enter mt-4 flex flex-col gap-6" style={stagger(2)}>
          <WorkspaceCards items={data} selected={selected} onSelect={open} onAdd={() => setAdding(true)} />
          {selected && <WorkspaceDetail key={selected} id={selected} onDeleted={() => open()} />}
        </div>
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
