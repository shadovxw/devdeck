import { Plus, Save, Upload } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { primaryButton, quietButton } from "../design/buttons";
import { IssueList } from "../design/IssueList";
import { ApiError } from "../lib/api";
import { useCreateStack, useStackFile, useUpdateStack, useValidateStack } from "../lib/queries";
import { useDebounced } from "../lib/use-debounced";

/** The server refuses bigger bodies; say so here instead of after the upload. */
const maxBytes = 512 * 1024;

/** A starting point for a new stack: one Go service with a health check. */
export function stackTemplate(repoId = "my-repo"): string {
  return `version: 1
name: my-stack
description: What this stack runs.

services:
  - id: api
    repo: ${repoId}
    kind: go
    cmd: ./cmd/server
    port: 8080
    ready:
      http: http://127.0.0.1:8080/health
      timeout: 30s
`;
}

type Props = {
  workspace: string;
  /** Set to edit that stack; left out to add a new one. */
  stack?: string;
  /** What a new stack starts with. */
  template: string;
  onClose: () => void;
};

/**
 * Add a stack (upload a .yaml file or write one) or edit an existing one. The
 * text is checked as it is typed, against the workspace's repos, and nothing is
 * saved while it has errors. Lives in the drawer.
 */
export function StackEditor({ workspace, stack, template, onClose }: Props) {
  const editing = stack !== undefined;
  const file = useStackFile(workspace, stack);
  const create = useCreateStack(workspace);
  const update = useUpdateStack(workspace, stack ?? "");
  const save = editing ? update : create;

  // The draft is what the person typed or uploaded; until then, the file (or the template).
  const [draft, setDraft] = useState<string | undefined>();
  const [uploadError, setUploadError] = useState<string | undefined>();
  const picker = useRef<HTMLInputElement>(null);
  const original = file.data?.yaml;
  const text = draft ?? (editing ? (original ?? "") : template);

  const shown = useDebounced(text, 400);
  const checked = useValidateStack(workspace, shown);
  const settled = text === shown && !checked.isFetching;
  const issues = checked.data?.issues ?? [];
  const saveIssues = save.error instanceof ApiError ? save.error.issues : [];

  const blocked =
    !text.trim() || !settled || checked.data?.valid === false || save.isPending || (editing && (file.isPending || text === original));

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires
    if (!picked) return;
    if (picked.size > maxBytes) {
      setUploadError(`That file is too large (the limit is ${maxBytes / 1024} KB).`);
      return;
    }
    setUploadError(undefined);
    setDraft(await picked.text());
    save.reset();
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto border-0 bg-surface-1 sm:max-w-2xl">
        <SheetHeader className="pe-12 pt-5">
          <SheetTitle className="text-[18px] text-ink">{editing ? `Edit ${stack}` : "Add a stack"}</SheetTitle>
          <SheetDescription className="text-[14px] leading-5 text-ink-3">
            {editing
              ? "Change the file below. It is checked as you type and saved as you see it. The name can’t change here: to rename a stack, delete it and add it again."
              : "Upload a stack file, or write one below. It is checked as you type, and nothing is saved while it has errors."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="flex flex-wrap items-center gap-3">
            <input ref={picker} type="file" accept=".yaml,.yml,text/yaml" onChange={upload} className="sr-only" aria-label="Stack file" tabIndex={-1} />
            <button type="button" onClick={() => picker.current?.click()} className={`${quietButton} h-10`}>
              <Upload size={17} aria-hidden />
              {editing ? "Replace from a file…" : "Upload a .yaml file…"}
            </button>
            {uploadError && (
              <p role="alert" className="m-0 text-[14px] text-critical">
                {uploadError}
              </p>
            )}
          </div>

          {editing && file.isError && (
            <p role="alert" className="m-0 text-[14px] text-critical">
              Could not load this stack’s file.
            </p>
          )}

          <label className="flex flex-col gap-1.5 text-[13px] text-ink-3">
            Stack file
            <textarea
              value={text}
              onChange={(e) => {
                setDraft(e.target.value);
                save.reset();
              }}
              disabled={editing && file.isPending}
              rows={Math.min(24, Math.max(10, text.split("\n").length + 1))}
              spellCheck={false}
              className="w-full resize-y rounded-ctl bg-inset p-3 font-mono text-[13px] leading-5 text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </label>

          <div aria-live="polite">
            <IssueList issues={saveIssues.length > 0 ? saveIssues : issues} />
          </div>
          {save.error && saveIssues.length === 0 && (
            <p role="alert" className="m-0 text-[14px] text-critical">
              {save.error.message}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => save.mutate(text, { onSuccess: onClose })}
              disabled={blocked}
              className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-45`}
            >
              {editing ? <Save size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Add stack"}
            </button>
            <button type="button" onClick={onClose} className={quietButton}>
              Cancel
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
