import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useDebounced } from "../../lib/use-debounced";
import {
  conflictOf,
  useCheckWorkspaceText,
  useDiskFile,
  useSaveWorkspaceFile,
  useWorkspaceFile,
  type WorkspaceFile,
} from "../../lib/workspace-file";

/** The version of the file the editor started from, and the one it would write over. */
type Base = { yaml: string; hash: string };

/**
 * The state of one workspace.yaml being edited: the text, the version it started from, the live check, a file
 * that changed on disk, and saving. The text is `edited` until it equals the saved one again.
 */
export function useWorkspaceEditor(id: string) {
  const qc = useQueryClient();
  const file = useWorkspaceFile(id);
  const [edited, setEdited] = useState<string | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [conflict, setConflict] = useState<WorkspaceFile | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useSaveWorkspaceFile(id);

  const start = useMemo<Base | null>(() => base ?? (file.data ? { yaml: file.data.yaml, hash: file.data.hash } : null), [base, file.data]);
  const text = edited ?? start?.yaml ?? "";
  const dirty = start !== null && text !== start.yaml;

  const lagged = useDebounced(text, 350);
  const checked = useCheckWorkspaceText(id, lagged);
  const settled = lagged === text && !checked.isFetching;

  // The file on disk, asked about every few seconds. A different hash than the one the editor started from
  // means someone else (VS Code, git, another tab) wrote it.
  const disk = useDiskFile(id, file.data !== undefined);
  const changedOnDisk: WorkspaceFile | null = conflict ?? (disk.data && start && disk.data.hash !== start.hash ? disk.data : null);

  const edit = useCallback((next: string) => {
    setEdited(next);
    setSaved(false);
  }, []);

  const discard = useCallback(() => {
    setEdited(null);
    setSaved(false);
  }, []);

  /** Take the file as it is on disk and drop the edits. */
  const reload = useCallback(() => {
    if (!changedOnDisk) return;
    setBase({ yaml: changedOnDisk.yaml, hash: changedOnDisk.hash });
    setEdited(null);
    setConflict(null);
    setSaved(false);
  }, [changedOnDisk]);

  /** Keep the edits, but treat the disk's version as the one they replace: the next save overwrites it, knowingly. */
  const keepMine = useCallback(() => {
    if (!changedOnDisk) return;
    setBase({ yaml: changedOnDisk.yaml, hash: changedOnDisk.hash });
    setEdited(text);
    setConflict(null);
  }, [changedOnDisk, text]);

  /** Writes the text. A file that changed meanwhile is not overwritten: it becomes `changedOnDisk`. */
  const saveNow = useCallback(async (): Promise<"saved" | "conflict" | "failed"> => {
    if (!start) return "failed";
    try {
      const out = await save.mutateAsync({ yaml: text, baseHash: start.hash });
      const written = { yaml: text, hash: out.hash };
      setBase(written);
      setEdited(null);
      setConflict(null);
      setSaved(true);
      // so the next poll doesn't see an old answer and report the file as changed
      qc.setQueryData<WorkspaceFile>(["workspaces", "disk", id], (old) => ({ path: old?.path ?? file.data?.path ?? "", ...written }));
      return "saved";
    } catch (err) {
      const c = conflictOf(err);
      if (!c) return "failed";
      setConflict({ yaml: c.yaml, hash: c.hash, path: file.data?.path ?? "" });
      return "conflict";
    }
  }, [start, save, text, qc, id, file.data?.path]);

  return {
    file,
    path: file.data?.path ?? "",
    text,
    base: start?.yaml ?? "",
    dirty,
    saved,
    issues: checked.data?.issues ?? [],
    valid: checked.data?.valid ?? false,
    settled,
    changedOnDisk,
    saving: save.isPending,
    saveError: save.error && !conflictOf(save.error) ? save.error : null,
    resetSaveError: save.reset,
    edit,
    discard,
    reload,
    keepMine,
    save: saveNow,
  };
}
