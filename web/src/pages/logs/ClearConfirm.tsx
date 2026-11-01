import { Trash2 } from "lucide-react";

import { useClearLogs } from "../../lib/log-api";
import { small } from "./styles";

type Props = {
  workspace: string;
  stack: string;
  /** The one service to clear, or undefined for every service of the stack. */
  target: string | undefined;
  onCancel: () => void;
  onCleared: () => void;
};

/** Asks before deleting the stored logs: it removes the files, not only the view. */
export function ClearConfirm({ workspace, stack, target, onCancel, onCleared }: Readonly<Props>) {
  const clear = useClearLogs(workspace, stack);
  return (
    <div role="alertdialog" aria-labelledby="clear-title" className="flex flex-wrap items-center gap-3 bg-inset px-3.5 py-3">
      <p id="clear-title" className="m-0 text-[14px] text-ink">
        Delete the stored logs of {target ? <span className="font-mono">{target}</span> : "every service of this stack"}? This removes the files, not only this view, and can’t be undone.
      </p>
      <span className="ms-auto flex gap-2">
        <button
          type="button"
          disabled={clear.isPending}
          onClick={() => clear.mutate(target, { onSuccess: onCleared })}
          className="inline-flex h-[34px] items-center gap-2 bg-critical px-3.5 text-[13px] font-medium text-white transition-colors hover:bg-critical/90 disabled:opacity-45"
        >
          <Trash2 size={14} aria-hidden />
          Delete
        </button>
        <button type="button" onClick={onCancel} className={small}>
          Cancel
        </button>
      </span>
      {clear.error && (
        <p role="alert" className="m-0 w-full text-[13px] text-critical">
          {clear.error.message}
        </p>
      )}
    </div>
  );
}
