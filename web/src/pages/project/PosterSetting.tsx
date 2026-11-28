import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { primaryButton, quietButton } from "../../design/buttons";
import { ApiError } from "../../lib/api";
import { keys } from "../../lib/queries";
import { PAUSED_TITLE } from "../../lib/server-link";
import type { WorkspaceDetail } from "../../lib/types";
import { useDebounced } from "../../lib/use-debounced";
import { useWritesPaused } from "../../lib/use-server-link";
import { conflictOf, fileNameOf, useCheckWorkspaceText, useSaveWorkspaceFile, useWorkspaceFile, type WorkspaceFile } from "../../lib/workspace-file";
import { formValues, setPoster } from "../../lib/yaml-doc";

/** A pasted path as it is meant: Windows' "Copy as path" puts quotes round it. */
export const cleanPath = (text: string) => text.trim().replace(/^(["'])(.*)\1$/, "$2").trim();

type Props = Readonly<{ id: string; project: WorkspaceDetail }>;

/**
 * The project's poster in its Settings (dev-plans/2026-11-28-project-posters §5): the path of a local
 * picture, written as one line of the project file over the version that was read. Save is the
 * confirmation; the server keeps the old file as .prev.
 */
export function PosterSetting({ id, project }: Props) {
  const file = useWorkspaceFile(id);
  return file.data ? <Form id={id} project={project} file={file.data} /> : null;
}

function Form({ id, project, file }: Props & Readonly<{ file: WorkspaceFile }>) {
  const qc = useQueryClient();
  const save = useSaveWorkspaceFile(id);
  const paused = useWritesPaused();
  // null until the field is touched, so it follows the file.
  const [typed, setTyped] = useState<string | null>(null);
  // The address of a picture the browser couldn't show; a new address is tried again.
  const [broken, setBroken] = useState<string>();

  const saved = project.workspace?.poster ?? "";
  const path = cleanPath(typed ?? saved);
  const dirty = typed !== null && path !== saved;
  const editable = formValues(file.yaml).ok;
  const fileName = fileNameOf(file.kind);

  // The server checks the text a save would write, so a bad path is said before it is saved.
  const next = dirty ? setPoster(file.yaml, path) : file.yaml;
  const lagged = useDebounced(next, 350);
  const check = useCheckWorkspaceText(id, lagged);
  const warnings = lagged === next && !check.isPlaceholderData ? (check.data?.issues.filter((i) => i.path === "/poster") ?? []) : [];

  function write(to: string) {
    save.mutate(
      { yaml: setPoster(file.yaml, to), baseHash: file.hash },
      {
        onSuccess: () => setTyped(null),
        onError: (err) => {
          // The file changed since it was read: take the new version, so saving again adds the line to it.
          const now = conflictOf(err);
          if (!now) return;
          qc.setQueryData<WorkspaceFile>(["workspaces", "file", id], { ...file, yaml: now.yaml, hash: now.hash });
          void qc.invalidateQueries({ queryKey: keys.workspace(id) });
        },
      },
    );
  }

  const refusal = conflictOf(save.error)
    ? "The file changed on disk, so nothing was written. It has been read again: save once more."
    : save.error && ((save.error instanceof ApiError && save.error.issues[0]?.message) || save.error.message);
  const blocked = !editable || save.isPending || paused;
  const url = project.poster_url;

  return (
    <section aria-label="Poster" className="flex flex-wrap gap-4 bg-surface-1 p-4">
      <div className="grid aspect-[1/1.45] w-28 shrink-0 place-items-center overflow-hidden bg-fill text-center font-mono text-[11px] uppercase text-ink-3">
        {url && broken !== url ? (
          <img src={url} alt={`Poster of ${project.name}`} onError={() => setBroken(url)} className="h-full w-full object-cover" />
        ) : (
          <span className="px-2">{saved ? "Can’t be shown" : "No poster"}</span>
        )}
      </div>
      <form
        className="flex min-w-60 flex-1 flex-col gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && !blocked) write(path);
        }}
      >
        <h3 className="m-0 text-[14px] font-semibold text-ink">Poster</h3>
        <input
          aria-label="Poster image path"
          title="An .svg or .png on this machine, up to 2 MB. Tall works best (600 × 870); other shapes are cropped. Not a web address."
          value={typed ?? saved}
          onChange={(e) => {
            setTyped(e.target.value);
            save.reset();
          }}
          placeholder="~/Pictures/poster.svg"
          spellCheck={false}
          autoComplete="off"
          disabled={!editable}
          className="h-10 w-full min-w-0 bg-inset px-3 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div aria-live="polite" className="flex flex-col gap-1 text-[13px] leading-5">
          {!editable && <p className="m-0 text-warning">Fix {fileName} in the editor first: it can’t be read.</p>}
          {warnings.map((w) => (
            <p key={w.message} className="m-0 text-warning">
              {w.message}
            </p>
          ))}
          {refusal && <p className="m-0 text-critical">{refusal}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={!dirty || blocked} title={paused ? PAUSED_TITLE : `Writes the poster line in ${fileName}`} className={`${primaryButton} disabled:opacity-50`}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {saved && (
            <button type="button" onClick={() => write("")} disabled={blocked} title={paused ? PAUSED_TITLE : `Removes the poster line from ${fileName}. The picture stays.`} className={`${quietButton} disabled:opacity-50`}>
              Remove
            </button>
          )}
          <span className="font-mono text-[12px] text-ink-3">writes {fileName}</span>
        </div>
      </form>
    </section>
  );
}
