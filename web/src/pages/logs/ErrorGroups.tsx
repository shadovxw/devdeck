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
    <ul aria-label="Errors" className="m-0 flex max-h-72 list-none flex-col gap-1 overflow-auto p-0">
      {groups.map((g) => (
        <li key={g.fingerprint}>
          <button
            type="button"
            aria-pressed={g.fingerprint === selected}
            onClick={() => onSelect(g.fingerprint === selected ? undefined : g.fingerprint)}
            className={`flex w-full min-w-0 flex-col gap-0.5 rounded-ctl px-3 py-2 text-start transition ${g.fingerprint === selected ? "bg-accent-soft" : "bg-inset hover:bg-fill"}`}
          >
            <span className="flex items-center gap-2 text-[13px] text-ink">
              <LevelMark level={g.level} />
              <span className="min-w-0 flex-1 truncate" title={g.message}>
                {g.message}
              </span>
              <span className="shrink-0 tabular-nums text-ink-2">×{g.count.toLocaleString()}</span>
            </span>
            <span className="flex flex-wrap gap-x-3 ps-14 font-mono text-[12px] text-ink-3">
              <span>{g.service}</span>
              {g.caller && <span>{g.caller}</span>}
              <span>last {ago(g.last_seen, now)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
