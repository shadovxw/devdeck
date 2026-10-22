import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { LevelMark } from "../../design/LevelMark";
import { Menu, type MenuItem } from "../../design/Menu";
import { messageOf } from "../../lib/log-query";
import type { LogEntry } from "../../lib/types";

const rowHeight = 28;
const overscan = 8;
const defaultViewHeight = 420;

/** The columns, shared by the header and every row so they line up: expand, time, service, level, message, actions. */
const columns = "grid grid-cols-[1.75rem_6.75rem_9rem_5.5rem_minmax(0,1fr)_2rem] items-center gap-x-3";

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
  /** What the "more" button of a row offers. */
  rowActions: (e: LogEntry) => MenuItem[];
};

/**
 * The lines as a table, drawn a window at a time (fixed row height), so thousands of
 * rows cost no more than the few on screen. With \`follow\` it stays at the newest line
 * until the reader scrolls up, and follows again when they scroll back to the end. A
 * row's arrow (or a click on the row) selects it and shows it in full below the list;
 * arrow keys move the selection; the row's "more" button offers what to do with it.
 */
export function LogList({ entries, label, selected, onSelect, follow, hasOlder, onLoadOlder, empty, rowActions }: Props) {
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
    } else if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && entries.length > 0) {
      e.preventDefault();
      onSelect(selected === undefined ? entries[Math.max(index, 0)].seq : undefined);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {hasOlder && (
        <button type="button" onClick={onLoadOlder} className="inline-flex items-center gap-2 self-start rounded-ctl px-1 py-1 text-[14px] text-accent hover:underline">
          <ChevronDown size={16} aria-hidden />
          Load older lines
        </button>
      )}
      <div className="flex min-w-0 flex-col overflow-hidden rounded-ctl bg-inset">
        <div aria-hidden className={`${columns} h-9 bg-fill px-3 text-[13px] font-medium text-ink-2`}>
          <span />
          <span>Time</span>
          <span>Service</span>
          <span>Level</span>
          <span>Message</span>
          <span />
        </div>
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
          className="relative h-[min(60vh,34rem)] min-h-[16rem] overflow-auto font-mono text-[12.5px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          {entries.length === 0 && <p className="m-0 p-3 text-ink-3">{empty}</p>}
          <div style={{ height: entries.length * rowHeight, position: "relative" }}>
            {entries.slice(first, last).map((e, i) => {
              const open = e.seq === selected;
              return (
                <div
                  key={e.seq}
                  id={`log-row-${e.seq}`}
                  role="option"
                  aria-selected={open}
                  onClick={() => onSelect(open ? undefined : e.seq)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(open ? undefined : e.seq);
                    }
                  }}
                  style={{ position: "absolute", top: (first + i) * rowHeight, height: rowHeight }}
                  className={`${columns} w-full cursor-pointer border-t border-line px-3 ${open ? "bg-accent-soft text-ink" : "hover:bg-fill"}`}
                >
                  <span aria-hidden className="text-ink-3">
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
                  <span className="tabular-nums text-ink-2">{clock(e.time)}</span>
                  <span className="truncate text-ink" title={e.service}>
                    {e.service}
                  </span>
                  <LevelMark level={e.level} />
                  <span className="min-w-0 truncate whitespace-pre text-ink">
                    {messageOf(e)}
                    {e.fields && <span className="ms-3 text-ink-3">{fieldHint(e)}</span>}
                  </span>
                  <Menu label={`More for the line at ${clock(e.time)}`} items={rowActions(e)} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
