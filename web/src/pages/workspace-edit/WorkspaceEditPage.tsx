import { ExternalLink, Save, Undo2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useParams, useSearchParams } from "react-router";

import { PageHeader } from "../../design/PageHeader";
import { primaryButton, quietButton } from "../../design/buttons";
import { useGitRepos } from "../../lib/git";
import { useWorkspace } from "../../lib/queries";
import type { Issue, IssueFix } from "../../lib/types";
import { useGitInit, useWorkspaceSchema } from "../../lib/workspace-file";
import { markLocalOnly, outline as parseOutline, repoIndexOfPath } from "../../lib/yaml-doc";
import { CompareDialog, GitInitDialog, LeaveDialog, ReviewDialog } from "./EditDialogs";
import { FormView } from "./FormView";
import { Inspector } from "./Inspector";
import { Outline } from "./Outline";
import { useWorkspaceEditor } from "./useWorkspaceEditor";
import type { Cursor, EditorHandle } from "./YamlEditor";

// CodeMirror is the biggest thing in the app and only this page needs it.
const YamlEditor = lazy(() => import("./YamlEditor"));

type Mode = "form" | "yaml";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What the live check says, in a few words. */
function checkStatus(settled: boolean, errors: number, warnings: number): string {
  if (!settled) return "Checking…";
  if (errors > 0) return plural(errors, "error");
  return warnings > 0 ? `Valid · ${plural(warnings, "warning")}` : "Valid";
}

/** Where the file stands against the disk. */
function fileState(readOnly: boolean, dirty: boolean, saved: boolean): string {
  if (readOnly) return "sample, read only";
  if (dirty) return "unsaved changes";
  return saved ? "saved" : "no changes";
}

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
    <fieldset aria-label="Edit as" className="m-0 inline-flex min-w-0 border-0 p-0">
      {item("form", "Form")}
      {item("yaml", "YAML")}
    </fieldset>
  );
}

/**
 * The editor for one workspace's workspace.yaml. The file is the source of truth: the Form and YAML views edit the
 * same text, a save only goes through when the text is valid and the file hasn't changed since it was opened, and
 * the old file is kept as workspace.yaml.prev.
 */
export function WorkspaceEditPage() {
  const { id = "" } = useParams();
  const startLine = Number(useSearchParams()[0].get("line")) || undefined;
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
        <output aria-label="Loading workspace.yaml…" className="skeleton mt-6 block h-96" />
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

  const status = checkStatus(ed.settled, errors, warnings);
  const vscode = ed.path ? `vscode://file/${encodeURI(ed.path.replaceAll("\\", "/"))}` : "";

  return (
    <>
      <PageHeader
        title={id}
        group="Workspace"
        parent="Workspaces"
        parentTo="/workspaces"
        summary={
          <output className="text-ink-3">
            workspace.yaml · {fileState(readOnly, ed.dirty, ed.saved)} · {status}
          </output>
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
              <Suspense fallback={<output aria-label="Loading the editor…" className="skeleton block h-full" />}>
                <YamlEditor
                  ref={editor}
                  value={ed.text}
                  onChange={ed.edit}
                  baseText={ed.base}
                  issues={ed.issues}
                  schema={schema.data}
                  readOnly={readOnly}
                  initialLine={startLine}
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

      <ReviewDialog open={reviewing} onOpenChange={setReviewing} ed={ed} onSave={save} />
      <CompareDialog open={comparing} onOpenChange={setComparing} ed={ed} />
      <GitInitDialog repo={initRepo} onClose={() => setInitRepo(null)} run={gitInit} />
      <LeaveDialog open={blocker.state === "blocked"} stay={() => blocker.reset?.()} leave={() => blocker.proceed?.()} />
    </>
  );
}
