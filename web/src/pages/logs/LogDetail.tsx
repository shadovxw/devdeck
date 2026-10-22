import { Bot, Code2, X } from "lucide-react";

import { LevelMark } from "../../design/LevelMark";
import { useWhere } from "../../lib/log-api";
import { vscodeLink } from "../../lib/log-query";
import type { LogEntry } from "../../lib/types";

const small =
  "inline-flex h-8 items-center gap-2 rounded-ctl px-3 text-[13px] text-ink-2 transition hover:bg-accent-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-45";

type Props = {
  workspace: string;
  stack: string;
  entry: LogEntry;
  onClose: () => void;
  /** Shows only the lines of the same error group. */
  onGroup: (fingerprint: string) => void;
};

/** One line in full: its text, level, fields, where it came from, and what to do with it. */
export function LogDetail({ workspace, stack, entry, onClose, onGroup }: Props) {
  const where = useWhere(workspace, stack, entry.service, entry.caller);
  const fields = Object.entries(entry.fields ?? {});
  const time = new Date(entry.time);

  return (
    <section aria-label="Selected line" className="flex min-w-0 flex-col gap-3 rounded-ctl bg-inset p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <LevelMark level={entry.level} />
        <span className="font-mono text-ink-2">{entry.service}</span>
        <time dateTime={entry.time} className="tabular-nums text-ink-3">
          {Number.isNaN(time.getTime()) ? entry.time : time.toLocaleString()}
        </time>
        {entry.stream === "stderr" && <span className="text-ink-3">stderr</span>}
        <button type="button" onClick={onClose} aria-label="Close the selected line" className={`${small} ms-auto !h-7 !px-2`}>
          <X size={14} aria-hidden />
        </button>
      </div>

      <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-ink">{entry.text}</pre>
      {entry.truncated ? <p className="m-0 text-ink-3">Cut from {entry.truncated.toLocaleString()} bytes.</p> : null}

      {fields.length > 0 && (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-[12px]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-3">{k}</dt>
              <dd className="m-0 min-w-0 break-words text-ink-2">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {entry.caller &&
          (where.data ? (
            <a href={vscodeLink(where.data.file, where.data.line)} className={`${small} text-accent`}>
              <Code2 size={14} aria-hidden />
              Open {entry.caller} in VS Code
            </a>
          ) : (
            <span className="font-mono text-[12px] text-ink-3" title={where.isPending ? "Looking for the file…" : "That file isn’t in this service’s repo"}>
              {entry.caller}
            </span>
          ))}
        {entry.fingerprint && (
          <button type="button" onClick={() => onGroup(entry.fingerprint ?? "")} className={small}>
            Show every line like this
          </button>
        )}
        <button type="button" disabled title="Asking Claude about an error comes with Phase 10" className={small}>
          <Bot size={14} aria-hidden />
          Ask Claude about this error
        </button>
      </div>
    </section>
  );
}
