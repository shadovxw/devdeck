import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { LevelMark } from "../../design/LevelMark";
import { messageOf } from "../../lib/log-query";
import type { LogEntry } from "../../lib/types";

const rowHeight = 22;
const overscan = 8;
const defaultViewHeight = 420;

/** 14:03:22.481, in the viewer's own time zone. */
export function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** The first couple of structured fields, as a hint after the message. */
function fieldHint(e: LogEntry): string {
  const keys = Object.keys(e.fields ?? {}).slice(0, 3);
  return keys.map((k) => `${k}=${typeof e.fields?.[k] === "object" ? "…" : String(e.fields?.[k])}`).join(" ");
}

type Props = {
  entries: LogEntry[];
  label: string;
  selected: number | undefined;
  onSelect: (seq: number | undefined) => void;
  /** Follow the newest line while the reader is at the end. */
  follow: boolean;
  hasOlder: boolean;
  onLoadOlder: () => void;
  empty: string;
};

/**
 * The lines, drawn a window at a time (fixed row height), so thousands of rows cost
 * no more than the few on screen. With `follow` it stays at the newest line until the
 * reader scrolls up, and follows again when they scroll back to the end. Arrow keys
 * move the selection; the selected line is shown in full beside the list.
 */
export function LogList({ entries, label, selected, onSelect, follow, hasOlder, onLoadOlder, empty }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(defaultViewHeight);
  const [atEnd, setAtEnd] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setHeight(el.clientHeight || defaultViewHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = box.current;
    if (el && follow && atEnd) el.scrollTop = el.scrollHeight;
  }, [entries.length, follow, atEnd]);

  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(entries.length, Math.ceil((top + height) / rowHeight) + overscan);
  const index = selected === undefined ? -1 : entries.findIndex((e) => e.seq === selected);

  function move(to: number) {
    const i = Math.min(Math.max(to, 0), entries.length - 1);
    const e = entries[i];
    if (!e) return;
    onSelect(e.seq);
    const el = box.current;
    if (!el) return;
    if (i * rowHeight < el.scrollTop) el.scrollTop = i * rowHeight;
    else if ((i + 1) * rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = (i + 1) * rowHeight - el.clientHeight;
  }

  function onKey(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const keys: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index < 0 ? entries.length - 1 : index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: entries.length - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]);
    } else if (e.key === "Escape") {
      onSelect(undefined);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {hasOlder && (
        <button type="button" onClick={onLoadOlder} className="self-start rounded-ctl px-2 py-1 text-[13px] text-accent hover:underline">
          Load older lines
        </button>
      )}
      <div
        ref={box}
        role="listbox"
        aria-label={label}
        aria-activedescendant={selected === undefined ? undefined : `log-row-${selected}`}
        tabIndex={0}
        onKeyDown={onKey}
        onScroll={(e) => {
          const el = e.currentTarget;
          setTop(el.scrollTop);
          setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight * 2);
        }}
        className="relative h-[min(60vh,32rem)] min-h-[16rem] overflow-auto rounded-ctl bg-inset font-mono text-[12px] leading-[22px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {entries.length === 0 && <p className="m-0 p-3 text-ink-3">{empty}</p>}
        <div style={{ height: entries.length * rowHeight, position: "relative" }}>
          {entries.slice(first, last).map((e, i) => (
            <div
              key={e.seq}
              id={`log-row-${e.seq}`}
              role="option"
              aria-selected={e.seq === selected}
              onClick={() => onSelect(e.seq === selected ? undefined : e.seq)}
              style={{ position: "absolute", top: (first + i) * rowHeight, height: rowHeight }}
              className={`flex w-full cursor-pointer items-center gap-3 px-3 whitespace-pre ${e.seq === selected ? "bg-accent-soft text-ink" : "hover:bg-fill"}`}
            >
              <span className="shrink-0 tabular-nums text-ink-3">{clock(e.time)}</span>
              <span className="w-32 shrink-0 truncate text-ink-3" title={e.service}>
                {e.service}
              </span>
              <LevelMark level={e.level} />
              <span className="min-w-0 flex-1 truncate">
                {messageOf(e)}
                {e.fields && <span className="ms-3 text-ink-3">{fieldHint(e)}</span>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
