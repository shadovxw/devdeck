import { FileCode, FolderOpen, FolderSearch, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

import { primaryButton, quietButton } from "../../design/buttons";
import { IssueList } from "../../design/IssueList";
import { ApiError } from "../../lib/api";
import { NAME_PATTERN, nameFrom, projectYaml, rootOf } from "../../lib/new-project";
import { useCreateWorkspace, usePickFolder, useScanFolder, useValidateWorkspace } from "../../lib/queries";
import type { ScanResult } from "../../lib/types";
import { useDebounced } from "../../lib/use-debounced";

const field = "h-10 w-full min-w-0 bg-inset px-3 text-[14px] text-ink placeholder:text-ink-3 outline-none focus-visible:ring-2 focus-visible:ring-accent";

/** A numbered step of the form, framed like the design's board. */
function Step({ n, title, children }: Readonly<{ n: string; title: string; children: React.ReactNode }>) {
  return (
    <section data-ui="new-step" aria-label={title} className="flex flex-col gap-3 p-4">
      <h3 data-ui="new-step-title" className="m-0">
        {n} · {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * New project (dev-plans/2026-11-22-projects §4.2, PJ5), in the drawer: pick a folder, tick what
 * devdeck found in it, name it, create. The file is the result, not the first thing shown: "Show
 * the file" reveals it, and Edit file on the project's page changes it afterwards.
 */
export function NewProject({ onCreated }: Readonly<{ onCreated: (id: string) => void }>) {
  const [root, setRoot] = useState("");
  const [found, setFound] = useState<ScanResult>();
  const [off, setOff] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [showFile, setShowFile] = useState(false);
  const scan = useScanFolder();
  const pick = usePickFolder();
  const create = useCreateWorkspace();

  const repos = found?.repos.filter((r) => !off.has(r.id)) ?? [];
  const yaml = found ? projectYaml({ name, root: rootOf(found), repos }) : "";
  const checked = useValidateWorkspace(useDebounced(yaml, 400));
  const issues = checked.data?.issues ?? [];
  const nameOk = NAME_PATTERN.test(name);
  const blocked = !found || !nameOk || create.isPending || checked.isPending || checked.data?.valid === false;

  const scanned = (res: ScanResult) => {
    // A folder with no git repositories comes back with repos: null (an empty list in Go).
    setFound({ ...res, repos: res.repos ?? [] });
    setOff(new Set());
    setName(nameFrom(res.name));
  };

  function submitScan(e: FormEvent) {
    e.preventDefault();
    create.reset();
    scan.mutate(root, { onSuccess: scanned });
  }

  /** Choose the folder in the system's own dialog, then look at it straight away. */
  function browse() {
    create.reset();
    pick.mutate(undefined, {
      onSuccess: (res) => {
        if (!res?.path) return; // the dialog was closed without choosing
        setRoot(res.path);
        scan.mutate(res.path, { onSuccess: scanned });
      },
    });
  }

  const toggle = (id: string) =>
    setOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <Step n="01" title="Pick a folder">
        <form onSubmit={submitScan} className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[220px] flex-1 flex-col gap-1.5 text-[13px] text-ink-3">
            One repo, or the folder that holds several
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
          <p data-ui="new-scanned" role="status" className="m-0">
            ✓ Scanned · {found.repos.length} {found.repos.length === 1 ? "repo" : "repos"}
            {found.truncated ? " · only the first 200 kept" : ""}
          </p>
        )}
      </Step>

      {found && (
        <>
          <Step n="02" title="What devdeck found">
            {found.repos.length === 0 ? (
              <p className="m-0 text-[13px] text-ink-3">No git repositories in this folder. The project can still be created, and repos added to its file later.</p>
            ) : (
              <ul aria-label="Repos found" className="m-0 flex list-none flex-col gap-1 p-0">
                {found.repos.map((r) => (
                  <li key={r.id}>
                    <label data-ui="new-repo" className="flex cursor-pointer items-center gap-3 px-2 py-1.5">
                      <input type="checkbox" checked={!off.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Include ${r.id}`} />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{r.id}</span>
                      {r.type && <span data-ui="new-repo-type">{r.type}</span>}
                      <span className="hidden max-w-[45%] truncate font-mono text-[12px] text-ink-3 sm:block">{r.remote ?? "no remote"}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </Step>

          <Step n="03" title="Name it">
            <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!nameOk} className={`${field} font-mono`} />
            </label>
            {!nameOk && <p className="m-0 text-[12.5px] text-warning">Lower case letters, digits and dashes, starting with a letter.</p>}
            <div aria-live="polite">{issues.length > 0 && <IssueList issues={issues} />}</div>
            {create.error && !(create.error instanceof ApiError && create.error.issues.length > 0) && (
              <p role="alert" className="m-0 text-[14px] text-critical">
                {create.error instanceof ApiError ? create.error.message : "The project couldn’t be created."}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => create.mutate(yaml, { onSuccess: (sum) => onCreated(sum.id) })} disabled={blocked} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}>
                <Plus size={18} aria-hidden />
                Create project
              </button>
              <button type="button" onClick={() => setShowFile((v) => !v)} aria-expanded={showFile} className={quietButton}>
                <FileCode size={15} aria-hidden />
                {showFile ? "Hide the file" : "Show the file"}
              </button>
            </div>
            {showFile && (
              <pre data-ui="new-file" aria-label="workspace.yaml" className="m-0 overflow-x-auto p-3 font-mono text-[12.5px] leading-5 text-ink-2">
                {yaml}
              </pre>
            )}
          </Step>
        </>
      )}
    </div>
  );
}
