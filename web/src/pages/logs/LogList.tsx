import { ChevronDown, ChevronRight, Copy, Download } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { LevelMark } from "../../design/LevelMark";
import { Menu, type MenuItem } from "../../design/Menu";
import { Tabs } from "../../design/Tabs";
import { collapseRepeats, plainRows } from "../../lib/log-collapse";
import { messageOf } from "../../lib/log-query";
import type { LogEntry } from "../../lib/types";

const overscan = 8;
const defaultViewHeight = 420;
/** Until the open line's detail has been measured. */
const defaultDetailHeight = 260;
/** A row is one line; with Wrap on it has room for two. The list is drawn a window at a time, so rows keep a fixed height. */
const rowHeightFor = (wrap: boolean) => (wrap ? 44 : 28);

/** The columns, shared by the header and every row so they line up: expand, time, service, level, message, actions. */
const columns = "grid grid-cols-[1.75rem_6.75rem_9rem_5.5rem_minmax(0,1fr)_2rem] gap-x-3";

/** 14:03:22.481, in the viewer's own time zone, or in UTC. */
export function clock(iso: string, utc = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return utc
    ? `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${p(d.getUTCMilliseconds(), 3)}`
    : `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** The first couple of structured fields, as a hint after the message. */
function fieldHint(e: LogEntry): string {
  const keys = Object.keys(e.fields ?? {}).slice(0, 3);
  return keys.map((k) => `${k}=${typeof e.fields?.[k] === "object" ? "…" : String(e.fields?.[k])}`).join(" ");
}

const firstLine = (text: string) => {
  const nl = text.indexOf("\n");
  return nl < 0 ? text : text.slice(0, nl);
};

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
  /** What opens under the selected row. */
  renderDetail?: (e: LogEntry) => ReactNode;
};

const check = "inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2 select-none";

/**
 * The lines as a table, drawn a window at a time (fixed row height), so thousands of
 * rows cost no more than the few on screen. With `follow` it stays at the newest line
 * until the reader scrolls up, and follows again when they scroll back to the end. A
 * row's arrow (or a click on the row) selects it and opens its detail right under it;
 * arrow keys move the selection; the row's "more" button offers what to do with it.
 * Above the list: Parsed or Raw lines, Wrap (two lines per row) and UTC times; below it:
 * copy or download the lines that are loaded.
 */
export function LogList({ entries, label, selected, onSelect, follow, hasOlder, onLoadOlder, empty, rowActions, renderDetail }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(defaultViewHeight);
  const [atEnd, setAtEnd] = useState(true);
  const [detailHeight, setDetailHeight] = useState(defaultDetailHeight);
  const [view, setView] = useState<"parsed" | "raw">("parsed");
  const [wrap, setWrap] = useState(false);
  const [utc, setUtc] = useState(false);
  const [collapse, setCollapse] = useState(true);
  const [copied, setCopied] = useState(false);

  const rowHeight = rowHeightFor(wrap);
  // With Collapse repeats on, a run of the same line is one row; the row is the first line of the run.
  const rows = useMemo(() => (collapse ? collapseRepeats(entries) : plainRows(entries)), [entries, collapse]);
  const index = selected === undefined ? -1 : rows.findIndex((r) => r.entry.seq === selected);
  const open = renderDetail && index >= 0 ? rows[index].entry : undefined;
  const openHeight = open ? detailHeight : 0;

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
  }, [rows.length, follow, atEnd]);

  /** Where a row starts: its place in the list, pushed down by the detail when it is under the open line. */
  const offsetOf = (i: number) => i * rowHeight + (open && i > index ? openHeight : 0);
  /** The row at a scroll position (the first row under the detail when the position is inside it). */
  const indexAt = (y: number) => {
    if (!open) return Math.floor(y / rowHeight);
    const split = (index + 1) * rowHeight;
    if (y < split) return Math.floor(y / rowHeight);
    if (y < split + openHeight) return index + 1;
    return Math.floor((y - openHeight) / rowHeight);
  };

  const first = Math.max(0, indexAt(top) - overscan);
  const last = Math.min(rows.length, indexAt(top + height) + 1 + overscan);
  const total = rows.length * rowHeight + openHeight;
  const detailVisible = open && offsetOf(index) < top + height && offsetOf(index) + rowHeight + openHeight > top;

  // The open line's detail is as tall as its content; the rows below it make room for that.
  useEffect(() => {
    const el = detail.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setDetailHeight(el.offsetHeight || defaultDetailHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [open?.seq, detailVisible]);

  function move(to: number) {
    const i = Math.min(Math.max(to, 0), rows.length - 1);
    const e = rows[i]?.entry;
    if (!e) return;
    onSelect(e.seq);
    const el = box.current;
    if (!el) return;
    // Scroll to where the row will be once the detail has moved to it, not where it is now.
    const y = i * rowHeight;
    if (y < el.scrollTop) el.scrollTop = y;
    else if (y + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = y + rowHeight - el.clientHeight;
  }

  function onKey(e: KeyboardEvent) {
    const page = Math.max(1, Math.floor(height / rowHeight) - 1);
    const keys: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowUp: index < 0 ? rows.length - 1 : index - 1,
      PageDown: index + page,
      PageUp: index - page,
      Home: 0,
      End: rows.length - 1,
    };
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]);
    } else if (e.key === "Escape") {
      onSelect(undefined);
    } else if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && rows.length > 0) {
      e.preventDefault();
      onSelect(selected === undefined ? rows[Math.max(index, 0)].entry.seq : undefined);
    }
  }

  const allText = () => entries.map((e) => e.text).join("\n");

  function copyAll() {
    void navigator.clipboard?.writeText(allText());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([allText(), "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Tabs label="Line view" value={view} onChange={setView} items={[{ value: "parsed", label: "Parsed" }, { value: "raw", label: "Raw" }]} />
        <label className={check} title="Two lines for each row">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} className="size-3 cursor-pointer" />
          Wrap
        </label>
        <label className={check} title="Show times in UTC instead of your own time zone">
          <input type="checkbox" checked={utc} onChange={(e) => setUtc(e.target.checked)} className="size-3 cursor-pointer" />
          UTC
        </label>
        <label className={check} title="Show a run of the same line once, with how many times it came">
          <input type="checkbox" checked={collapse} onChange={(e) => setCollapse(e.target.checked)} className="size-3 cursor-pointer" />
          Collapse repeats
        </label>
      </div>
      {hasOlder && (
        <button type="button" onClick={onLoadOlder} className="inline-flex items-center gap-2 self-start px-1 py-1 text-[13px] text-link hover:underline">
          <ChevronDown size={16} aria-hidden />
          Load older lines
        </button>
      )}
      <div className="flex min-w-0 flex-col overflow-hidden">
        <div aria-hidden className={`${columns} h-7 items-center px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-ink-3`}>
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
          className="relative h-[min(60vh,34rem)] min-h-[16rem] overflow-auto font-mono text-[12px] text-ink-2 outline-none focus-visible:outline-offset-[-2px]"
        >
          {entries.length === 0 && <p className="m-0 p-3 text-ink-3">{empty}</p>}
          <div style={{ height: total, position: "relative" }}>
            {rows.slice(first, last).map(({ entry: e, repeat }, i) => {
              const row = first + i;
              const isOpen = e.seq === selected;
              return (
                <div
                  key={e.seq}
                  id={`log-row-${e.seq}`}
                  role="option"
                  aria-selected={isOpen}
                  onClick={() => onSelect(isOpen ? undefined : e.seq)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      onSelect(isOpen ? undefined : e.seq);
                    }
                  }}
                  style={{ position: "absolute", top: offsetOf(row), height: rowHeight }}
                  className={`${columns} w-full cursor-pointer px-3 ${wrap ? "items-start py-1" : "items-center"} ${isOpen ? "bg-fill-hover text-ink" : "hover:bg-fill"}`}
                >
                  <span aria-hidden className="text-ink-3">
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </span>
                  <span className="tabular-nums text-ink-2">{clock(e.time, utc)}</span>
                  <span className="truncate text-ink" title={e.service}>
                    {e.service}
                  </span>
                  <LevelMark level={e.level} />
                  <span className="flex min-w-0 items-start gap-3 text-ink">
                    <span className={`min-w-0 flex-1 ${wrap ? "line-clamp-2 whitespace-pre-wrap break-words" : "truncate whitespace-pre"}`}>
                      {view === "raw" ? (wrap ? e.text : firstLine(e.text)) : messageOf(e)}
                      {view === "parsed" && e.fields && <span className="ms-3 text-ink-3">{fieldHint(e)}</span>}
                    </span>
                    {repeat > 1 && (
                      <span className="shrink-0 bg-fill px-1.5 text-[10.5px] leading-[18px] text-ink-3" title={`The same line, ${repeat.toLocaleString()} times in a row`}>
                        ×{repeat.toLocaleString()}
                      </span>
                    )}
                  </span>
                  <Menu label={`More for the line at ${clock(e.time, utc)}`} items={rowActions(e)} />
                </div>
              );
            })}
            {open && detailVisible && (
              // Keys typed inside the detail belong to it, not to the list's arrow-key movement.
              <div
                ref={detail}
                role="group"
                onKeyDown={(e) => e.stopPropagation()}
                style={{ position: "absolute", top: (index + 1) * rowHeight, left: 0, right: 0 }}
                className="font-sans"
              >
                {renderDetail?.(open)}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-1 pt-1">
          <button type="button" onClick={copyAll} disabled={entries.length === 0} title="Copy the loaded lines" aria-label="Copy the loaded lines" className="inline-flex h-7 items-center gap-1.5 px-2 text-[12px] text-ink-3 hover:bg-fill hover:text-ink disabled:opacity-40">
            <Copy size={14} aria-hidden />
            {copied ? "Copied" : ""}
          </button>
          <button type="button" onClick={download} disabled={entries.length === 0} title="Download the loaded lines" aria-label="Download the loaded lines" className="inline-flex h-7 items-center px-2 text-ink-3 hover:bg-fill hover:text-ink disabled:opacity-40">
            <Download size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
