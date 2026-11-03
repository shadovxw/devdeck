import { lazy, Suspense } from "react";

import { primaryButton, quietButton } from "../../design/buttons";
import type { useGitInit } from "../../lib/workspace-file";
import { Modal } from "./Modal";
import type { useWorkspaceEditor } from "./useWorkspaceEditor";

const DiffView = lazy(() => import("./DiffView"));

type Editor = ReturnType<typeof useWorkspaceEditor>;

const disabled = "disabled:cursor-not-allowed disabled:opacity-50";

function DiffFallback() {
  return <output aria-label="Loading the comparison…" className="skeleton block h-48" />;
}

function Problem({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <span role="alert" className="me-auto text-[13px] text-critical">
      {children}
    </span>
  );
}

/** The saved file and the edits side by side; Save only when the text is valid. */
export function ReviewDialog({ open, onOpenChange, ed, onSave }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; ed: Editor; onSave: () => void }>) {
  const refused = !ed.saveError && !ed.valid && ed.settled;
  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) ed.resetSaveError();
      }}
      wide
      title="Review changes"
      description="The old file is kept next to it as workspace.yaml.prev."
      footer={
        <>
          {ed.saveError && <Problem>{ed.saveError.message}</Problem>}
          {refused && <Problem>Fix the errors first: only a valid file is saved.</Problem>}
          <button type="button" onClick={() => onOpenChange(false)} className={quietButton}>
            Cancel
          </button>
          <button type="button" disabled={!ed.valid || !ed.settled || ed.saving} onClick={onSave} className={`${primaryButton} ${disabled}`}>
            {ed.saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {open && (
        <Suspense fallback={<DiffFallback />}>
          <DiffView original={ed.base} modified={ed.text} originalLabel="Saved" modifiedLabel="Your edits" />
        </Suspense>
      )}
    </Modal>
  );
}

/** The file as it is on disk against the edits, with the three ways out. */
export function CompareDialog({ open, onOpenChange, ed }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; ed: Editor }>) {
  const onDisk = ed.changedOnDisk;
  const close = () => onOpenChange(false);
  return (
    <Modal
      open={open && onDisk !== null}
      onOpenChange={onOpenChange}
      wide
      title="Changed on disk"
      description="Your edits are on the right. Reload takes the disk's version; Keep mine makes your next save replace it."
      footer={
        <>
          <button type="button" onClick={close} className={quietButton}>
            Close
          </button>
          <button
            type="button"
            onClick={() => {
              ed.keepMine();
              close();
            }}
            className={quietButton}
          >
            Keep mine
          </button>
          <button
            type="button"
            onClick={() => {
              ed.reload();
              close();
            }}
            className={primaryButton}
          >
            Reload from disk
          </button>
        </>
      }
    >
      {open && onDisk && (
        <Suspense fallback={<DiffFallback />}>
          <DiffView original={onDisk.yaml} modified={ed.text} originalLabel="On disk now" modifiedLabel="Your edits" />
        </Suspense>
      )}
    </Modal>
  );
}

/** The confirmation before `git init` runs in a repo's folder. */
export function GitInitDialog({ repo, onClose, run }: Readonly<{ repo: { id: string; path: string } | null; onClose: () => void; run: ReturnType<typeof useGitInit> }>) {
  return (
    <Modal
      open={repo !== null}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          run.reset();
        }
      }}
      title={`Run git init in ${repo?.path ?? ""}?`}
      description="This creates a .git folder there and changes no files. The folder has to be in the workspace file already."
      footer={
        <>
          {run.error && <Problem>{run.error.message}</Problem>}
          <button type="button" onClick={onClose} className={quietButton}>
            Cancel
          </button>
          <button type="button" disabled={run.isPending} onClick={() => repo && run.mutate(repo.id, { onSuccess: onClose })} className={primaryButton}>
            {run.isPending ? "Running…" : "Run git init"}
          </button>
        </>
      }
    />
  );
}

/** The question when leaving the page with edits that aren't saved. */
export function LeaveDialog({ open, stay, leave }: Readonly<{ open: boolean; stay: () => void; leave: () => void }>) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && stay()}
      title="Leave without saving?"
      description="Your edits to workspace.yaml haven’t been saved."
      footer={
        <>
          <button type="button" onClick={stay} className={quietButton}>
            Keep editing
          </button>
          <button type="button" onClick={leave} className={primaryButton}>
            Discard and leave
          </button>
        </>
      }
    />
  );
}
