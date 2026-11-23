import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { useDeleteFilter } from "../../lib/log-api";
import { queryOfFilter, type LogQuery, type SavedLogFilter } from "../../lib/log-query";

type Props = {
  workspace: string;
  filters: SavedLogFilter[];
  /** A sample workspace can't be changed, so its filters can't be deleted. */
  sample: boolean;
  onApply: (query: LogQuery) => void;
};

/** How many saved filters have a key: Alt+1 to Alt+3. (Not Ctrl+digit: a browser keeps that for its tabs.) */
const keyed = 3;

/** The filters saved with the workspace, as chips. The first three also answer to Alt+1 to Alt+3. */
export function SavedFilters({ workspace, filters, sample, onApply }: Readonly<Props>) {
  const del = useDeleteFilter(workspace);
  const [deleting, setDeleting] = useState<string | undefined>();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const n = /^Digit([1-3])$/.exec(e.code)?.[1];
      if (!n || !e.altKey || e.ctrlKey || e.metaKey || typing) return;
      const view = filters[Number(n) - 1];
      if (!view) return;
      e.preventDefault();
      onApply(queryOfFilter(view));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [filters, onApply]);

  if (filters.length === 0) return null;
  return (
    <ul aria-label="Saved filters" className="m-0 flex list-none flex-wrap gap-2 p-0">
      {filters.map((f, n) => (
        <li key={f.id} className="inline-flex items-center bg-fill text-[13px] text-ink-2">
          {deleting === f.id ? (
            <span className="flex items-center gap-2 ps-3 pe-1">
              Delete “{f.name}”?
              <button type="button" onClick={() => del.mutate(f.id, { onSuccess: () => setDeleting(undefined) })} className="h-8 px-2 text-critical hover:bg-fill-hover">
                Delete
              </button>
              <button type="button" onClick={() => setDeleting(undefined)} className="h-8 px-2 hover:bg-fill-hover">
                Keep
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => onApply(queryOfFilter(f))}
                aria-keyshortcuts={n < keyed ? `Alt+${n + 1}` : undefined}
                className="inline-flex h-8 items-center gap-2 ps-3 pe-2 hover:bg-fill-hover"
              >
                {f.name}
                {n < keyed && (
                  <kbd aria-hidden className="bg-bg px-1 font-mono text-[10.5px] text-ink-3">
                    Alt {n + 1}
                  </kbd>
                )}
              </button>
              {!sample && (
                <button type="button" aria-label={`Delete the saved filter ${f.name}`} onClick={() => setDeleting(f.id)} className="inline-flex h-8 w-8 items-center justify-center hover:bg-fill-hover">
                  <X size={13} aria-hidden />
                </button>
              )}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
