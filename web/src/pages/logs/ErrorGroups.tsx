import { LevelMark } from "../../design/LevelMark";
import type { LogGroup } from "../../lib/types";

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (Number.isNaN(s)) return "";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

type Props = {
  groups: LogGroup[];
  selected: string | undefined;
  /** Picks a group (or, given the one already picked, lets go of it). */
  onSelect: (fingerprint: string | undefined) => void;
  now: number;
};

/** The kinds of error seen, most recent first: pick one to see only its lines. */
export function ErrorGroups({ groups, selected, onSelect, now }: Props) {
  if (groups.length === 0) {
    return <p className="m-0 text-[13px] text-ink-3">No errors so far.</p>;
  }
  return (
    <ul aria-label="Errors" className="m-0 flex max-h-40 list-none flex-col overflow-auto rounded-ctl bg-inset p-1">
      {groups.map((g) => (
        <li key={g.fingerprint}>
          <button
            type="button"
            aria-pressed={g.fingerprint === selected}
            onClick={() => onSelect(g.fingerprint === selected ? undefined : g.fingerprint)}
            className={`flex h-9 w-full min-w-0 items-center gap-3 rounded-ctl px-3 text-start text-[13px] transition ${g.fingerprint === selected ? "bg-accent-soft" : "hover:bg-fill"}`}
          >
            <LevelMark level={g.level} />
            <span className="min-w-0 flex-1 truncate text-ink" title={g.message}>
              {g.message}
            </span>
            <span className="hidden shrink-0 truncate font-mono text-[12px] text-ink-3 md:inline">
              {g.service}
              {g.caller ? ` · ${g.caller}` : ""}
            </span>
            <span className="hidden shrink-0 text-[12px] text-ink-3 sm:inline">last {ago(g.last_seen, now)}</span>
            <span className="w-10 shrink-0 text-end tabular-nums text-ink-2">×{g.count.toLocaleString()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
