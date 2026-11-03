import { ExternalLink, Save, Undo2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useParams } from "react-router";

import { PageHeader } from "../../design/PageHeader";
import { primaryButton, quietButton } from "../../design/buttons";
import { useGitRepos } from "../../lib/git";
import { useWorkspace } from "../../lib/queries";
import type { Issue, IssueFix } from "../../lib/types";
import { useGitInit, useWorkspaceSchema } from "../../lib/workspace-file";
import { markLocalOnly, outline as parseOutline, repoIndexOfPath } from "../../lib/yaml-doc";
import { FormView } from "./FormView";
import { Inspector } from "./Inspector";
import { Modal } from "./Modal";
import { Outline } from "./Outline";
import { useWorkspaceEditor } from "./useWorkspaceEditor";
import type { Cursor, EditorHandle } from "./YamlEditor";

// CodeMirror is the biggest thing in the app and only this page needs it.
const YamlEditor = lazy(() => import("./YamlEditor"));
const DiffView = lazy(() => import("./DiffView"));

type Mode = "form" | "yaml";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Segmented({ mode, onChange }: Readonly<{ mode: Mode; onChange: (mode: Mode) => void }>) {
  const item = (m: Mode, text: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => onChange(m)}
      className={`h-[34px] px-3.5 text-[13px] font-medium transition-colors ${mode === m ? "bg-primary text-primary-foreground" : "bg-fill text-ink hover:bg-fill-hover"}`}
    >
      {text}
    </button>
  );
  return (
    <div role="group" aria-label="Edit as" className="inline-flex">
      {item("form", "Form")}
      {item("yaml", "YAML")}
    </div>
  );
}

const DiffFallback = () => <div role="status" aria-label="Loading the comparison…" className="skeleton h-48" />;

/**
 * The editor for one workspace's workspace.yaml. The file is the source of truth: the Form and YAML views edit the
 * same text, a save only goes through when the text is valid and the file hasn't changed since it was opened, and
 * the old file is kept as workspace.yaml.prev.
 */
export function WorkspaceEditPage() {
  const { id = "" } = useParams();
  const ed = useWorkspaceEditor(id);
  const detail = useWorkspace(id);
  const git = useGitRepos();
  const schema = useWorkspaceSchema();
  const gitInit = useGitInit(id);

  const [mode, setMode] = useState<Mode>("yaml");
  const [cursor, setCursor] = useState<Cursor>({ line: 1, col: 1 });
  const [reviewing, setReviewing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [initRepo, setInitRepo] = useState<{ id: string; path: string } | null>(null);
  const editor = useRef<EditorHandle>(null);

  const readOnly = detail.data?.source === "example";
  const outline = useMemo(() => parseOutline(ed.text), [ed.text]);
  const errors = ed.issues.filter((i) => i.severity === "error").length;
  const warnings = ed.issues.length - errors;
  const version = /^version:\s*(\S+)/m.exec(ed.text)?.[1];
  const stacks = (detail.data?.stacks ?? []).map((s) => ({ name: s.name, repos: (s.compose ?? []).map((c) => c.repo) }));

  // Leaving with edits that aren't saved asks first.
  const blocker = useBlocker(ed.dirty);
  useEffect(() => {
    if (!ed.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [ed.dirty]);

  // ⌘S / Ctrl+S opens the review, whichever view has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (ed.dirty && !readOnly) setReviewing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ed.dirty, readOnly]);

  const go = (line: number) => {
    setMode("yaml");
    // the editor may not be on screen yet (the Form view was showing)
    setTimeout(() => editor.current?.goToLine(line), 0);
  };

  const applyFix = (issue: Issue, fix: IssueFix) => {
    const index = repoIndexOfPath(issue.path);
    if (index === undefined || readOnly) return;
    if (fix.id === "mark-local-only") ed.edit(markLocalOnly(ed.text, index));
    if (fix.id === "git-init") {
      const repo = outline.repos[index];
      if (repo) setInitRepo({ id: repo.id, path: repo.path });
    }
  };

  const save = async () => {
    // a failed save stays open to show why; a refused one closes, because the banner explains it
    if ((await ed.save()) !== "failed") setReviewing(false);
  };

  if (ed.file.isPending) {
    return (
      <>
        <PageHeader title="Edit workspace" group="Workspace" parent="Workspaces" parentTo="/workspaces" />
        <div role="status" aria-label="Loading workspace.yaml…" className="skeleton mt-6 h-96" />
      </>
    );
  }
  if (ed.file.isError) {
    return (
      <>
        <PageHeader title="Edit workspace" group="Workspace" parent="Workspaces" parentTo="/workspaces" />
        <p role="alert" className="mt-6 text-[14px] text-critical">
          workspace.yaml couldn’t be read: {ed.file.error.message}
        </p>
      </>
    );
  }

  const status = !ed.settled ? "Checking…" : errors > 0 ? plural(errors, "error") : warnings > 0 ? `Valid · ${plural(warnings, "warning")}` : "Valid";
  const vscode = ed.path ? `vscode://file/${encodeURI(ed.path.replaceAll("\\", "/"))}` : "";

  return (
    <>
      <PageHeader
        title={id}
        group="Workspace"
        parent="Workspaces"
        parentTo="/workspaces"
        summary={
          <span role="status" className="text-ink-3">
            workspace.yaml · {readOnly ? "sample, read only" : ed.dirty ? "unsaved changes" : ed.saved ? "saved" : "no changes"} · {status}
          </span>
        }
        actions={
          <>
            <Segmented mode={mode} onChange={setMode} />
            {vscode && (
              <a href={vscode} title="Open workspace.yaml in VS Code" className={quietButton}>
                <ExternalLink size={14} aria-hidden /> VS Code
              </a>
            )}
            <button type="button" disabled={!ed.dirty} onClick={ed.discard} className={`${quietButton} disabled:cursor-not-allowed disabled:opacity-50`}>
              <Undo2 size={14} aria-hidden /> Discard
            </button>
            <button
              type="button"
              disabled={!ed.dirty || readOnly}
              onClick={() => setReviewing(true)}
              title="Review the changes, then save (Ctrl or ⌘ + S)"
              className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Save size={14} aria-hidden /> Review &amp; save
            </button>
          </>
        }
      />

      <div className="mt-5 grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)_18rem]">
        <div className="max-lg:order-2 lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:overflow-auto">
          <Outline outline={outline} issues={ed.issues} stacks={stacks.map((s) => s.name)} cursorLine={cursor.line} onGo={go} />
        </div>

        <div className="flex h-[calc(100dvh-15rem)] min-h-[28rem] min-w-0 flex-col bg-bg max-lg:order-1">
          {ed.changedOnDisk && (
            <div role="alert" className="flex flex-wrap items-center gap-3 bg-fill px-4 py-2 text-[13px] text-ink">
              <span className="min-w-0 flex-1">workspace.yaml changed on disk after you opened it.</span>
              <button type="button" onClick={() => setComparing(true)} className={quietButton}>
                Compare
              </button>
              <button type="button" onClick={ed.reload} className={quietButton} title="Take the file as it is on disk and drop your edits">
                Reload
              </button>
            </div>
          )}
          <div className="min-h-0 flex-1">
            {mode === "yaml" ? (
              <Suspense fallback={<div role="status" aria-label="Loading the editor…" className="skeleton h-full" />}>
                <YamlEditor
                  ref={editor}
                  value={ed.text}
                  onChange={ed.edit}
                  baseText={ed.base}
                  issues={ed.issues}
                  schema={schema.data}
                  readOnly={readOnly}
                  onCursor={setCursor}
                  onFix={applyFix}
                  onSave={() => ed.dirty && setReviewing(true)}
                />
              </Suspense>
            ) : (
              <FormView text={ed.text} onChange={ed.edit} readOnly={readOnly} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-surface-1 px-4 py-1.5 font-mono text-[11.5px] text-ink-3">
            <span>
              Ln {cursor.line}, Col {cursor.col}
            </span>
            <span>workspace.yaml</span>
            {version && <span>schema v{version}</span>}
            <span className="ms-auto font-sans">Ctrl/⌘ S review &amp; save</span>
          </div>
        </div>

        <div className="max-lg:order-3 lg:h-[calc(100dvh-15rem)] lg:min-h-[28rem] lg:overflow-auto">
          <Inspector
            outline={outline}
            line={cursor.line}
            git={(git.data ?? []).filter((g) => g.workspace === id)}
            stacks={stacks}
            issues={ed.issues}
            valid={ed.valid}
            onGo={go}
            onFix={applyFix}
          />
        </div>
      </div>

      <Modal
        open={reviewing}
        onOpenChange={(o) => {
          setReviewing(o);
          if (!o) ed.resetSaveError();
        }}
        wide
        title="Review changes"
        description="The old file is kept next to it as workspace.yaml.prev."
        footer={
          <>
            {ed.saveError && (
              <span role="alert" className="me-auto text-[13px] text-critical">
                {ed.saveError.message}
              </span>
            )}
            {!ed.saveError && !ed.valid && ed.settled && <span className="me-auto text-[13px] text-critical">Fix the errors first: only a valid file is saved.</span>}
            <button type="button" onClick={() => setReviewing(false)} className={quietButton}>
              Cancel
            </button>
            <button type="button" disabled={!ed.valid || !ed.settled || ed.saving} onClick={save} className={`${primaryButton} disabled:cursor-not-allowed disabled:opacity-50`}>
              {ed.saving ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {reviewing && (
          <Suspense fallback={<DiffFallback />}>
            <DiffView original={ed.base} modified={ed.text} originalLabel="Saved" modifiedLabel="Your edits" />
          </Suspense>
        )}
      </Modal>

      <Modal
        open={comparing && ed.changedOnDisk !== null}
        onOpenChange={setComparing}
        wide
        title="Changed on disk"
        description="Your edits are on the right. Reload takes the disk's version; Keep mine makes your next save replace it."
        footer={
          <>
            <button type="button" onClick={() => setComparing(false)} className={quietButton}>
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                ed.keepMine();
                setComparing(false);
              }}
              className={quietButton}
            >
              Keep mine
            </button>
            <button
              type="button"
              onClick={() => {
                ed.reload();
                setComparing(false);
              }}
              className={primaryButton}
            >
              Reload from disk
            </button>
          </>
        }
      >
        {comparing && ed.changedOnDisk && (
          <Suspense fallback={<DiffFallback />}>
            <DiffView original={ed.changedOnDisk.yaml} modified={ed.text} originalLabel="On disk now" modifiedLabel="Your edits" />
          </Suspense>
        )}
      </Modal>

      <Modal
        open={initRepo !== null}
        onOpenChange={(o) => {
          if (!o) {
            setInitRepo(null);
            gitInit.reset();
          }
        }}
        title={`Run git init in ${initRepo?.path ?? ""}?`}
        description="This creates a .git folder there and changes no files. The folder has to be in the workspace file already."
        footer={
          <>
            {gitInit.error && (
              <span role="alert" className="me-auto text-[13px] text-critical">
                {gitInit.error.message}
              </span>
            )}
            <button type="button" onClick={() => setInitRepo(null)} className={quietButton}>
              Cancel
            </button>
            <button
              type="button"
              disabled={gitInit.isPending}
              onClick={() => initRepo && gitInit.mutate(initRepo.id, { onSuccess: () => setInitRepo(null) })}
              className={primaryButton}
            >
              {gitInit.isPending ? "Running…" : "Run git init"}
            </button>
          </>
        }
      />

      <Modal
        open={blocker.state === "blocked"}
        onOpenChange={(o) => !o && blocker.reset?.()}
        title="Leave without saving?"
        description="Your edits to workspace.yaml haven’t been saved."
        footer={
          <>
            <button type="button" onClick={() => blocker.reset?.()} className={quietButton}>
              Keep editing
            </button>
            <button type="button" onClick={() => blocker.proceed?.()} className={primaryButton}>
              Discard and leave
            </button>
          </>
        }
      />
    </>
  );
}
