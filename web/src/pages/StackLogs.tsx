import { Eraser, Filter, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { quietButton } from "../design/buttons";
import { useCaptures, useResetCapture, useSetCapture, useStackLogs } from "../lib/logs";
import type { CaptureInfo, LogEntry } from "../lib/types";

const rowHeight = 20;
const viewHeight = 320;
const overscan = 8;

const select =
  "h-9 max-w-[18rem] rounded-ctl bg-inset px-3 text-[14px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent";
const small = `${quietButton} !h-9 !px-3 !text-[14px] disabled:cursor-not-allowed disabled:opacity-45`;

/** 14:03:22.481, in the viewer's own time zone. */
function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/**
 * The lines, drawn a window at a time (fixed row height), so thousands of rows
 * cost no more than the few that are on screen. It follows the newest line until
 * the reader scrolls up, and follows again when they scroll back to the end.
 */
export function LogView({ entries, label }: { entries: LogEntry[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    const el = box.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [entries.length, follow]);

  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(entries.length, Math.ceil((top + viewHeight) / rowHeight) + overscan);

  return (
    <div
      ref={box}
      role="log"
      aria-label={label}
      aria-live="off"
      tabIndex={0}
      onScroll={(e) => {
        const el = e.currentTarget;
        setTop(el.scrollTop);
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < rowHeight * 2);
      }}
      style={{ height: viewHeight }}
      className="relative overflow-auto rounded-ctl bg-inset font-mono text-[12px] leading-5 text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {entries.length === 0 && <p className="m-0 p-3 text-ink-3">Nothing has been stored yet.</p>}
      <div style={{ height: entries.length * rowHeight, position: "relative" }}>
        {entries.slice(first, last).map((e, i) => (
          <div
            key={e.seq}
            title={e.text}
            style={{ position: "absolute", top: (first + i) * rowHeight, height: rowHeight }}
            className="flex w-full items-center gap-3 px-3 whitespace-pre"
          >
            <span className="shrink-0 tabular-nums text-ink-3">{clock(e.time)}</span>
            <span className="w-32 shrink-0 truncate text-ink-3">{e.service}</span>
            {e.stream === "stderr" && <span className="shrink-0 text-ink-3">err</span>}
            <span className="min-w-0 truncate">{e.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function describe(c: CaptureInfo): string {
  if (c.store === "off") return "Not storing (paused)";
  if (c.store === "matching") return `Storing lines that match ${c.match}`;
  return "Storing everything";
}

const sourceText: Record<CaptureInfo["source"], string> = { default: "", file: "from the stack file", override: "set here" };

function CaptureRow({ info, workspace, stack }: { info: CaptureInfo; workspace: string; stack: string }) {
  const set = useSetCapture(workspace, stack);
  const reset = useResetCapture(workspace, stack);
  const [editing, setEditing] = useState(false);
  const [pattern, setPattern] = useState(info.match ?? "");
  const busy = set.isPending || reset.isPending;
  const error = set.error ?? reset.error;

  function submit(e: FormEvent) {
    e.preventDefault();
    set.mutate({ service: info.service, rule: { store: "matching", match: pattern } }, { onSuccess: () => setEditing(false) });
  }

  return (
    <li className="flex flex-col gap-2 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="w-56 min-w-0 truncate font-mono text-[13px] text-ink">{info.service}</span>
        <span className="text-[13px] text-ink-2">{describe(info)}</span>
        {sourceText[info.source] && <span className="text-[12px] text-ink-3">{sourceText[info.source]}</span>}
        <span className="ms-auto flex flex-wrap items-center gap-2">
          {info.store === "off" ? (
            <button type="button" disabled={busy} onClick={() => set.mutate({ service: info.service, rule: { store: "all" } })} className={small}>
              <Play size={14} aria-hidden />
              Start storing
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => set.mutate({ service: info.service, rule: { store: "off" } })} className={small}>
              <Pause size={14} aria-hidden />
              Stop storing
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => setEditing((v) => !v)} aria-expanded={editing} className={small}>
            <Filter size={14} aria-hidden />
            Only matching…
          </button>
          {info.source === "override" && (
            <button type="button" disabled={busy} onClick={() => reset.mutate(info.service)} title="Go back to the stack file’s rule" className={small}>
              <RotateCcw size={14} aria-hidden />
              Reset
            </button>
          )}
        </span>
      </div>
      {editing && (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`pattern-${info.service}`}>
            Pattern for {info.service}
          </label>
          <input
            id={`pattern-${info.service}`}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="(?i)error|warn"
            spellCheck={false}
            autoComplete="off"
            className="h-9 w-72 max-w-full rounded-ctl bg-inset px-3 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus-visible:ring-2 focus-visible:ring-accent"
          />
          <button type="submit" disabled={busy || !pattern.trim()} className={small}>
            Save
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="m-0 text-[13px] text-critical">
          {error.message}
        </p>
      )}
    </li>
  );
}

/**
 * A stack's collected output and what is stored for each service: pick a
 * service (or all), watch the lines arrive, pause the view, and stop or start
 * storing a chatty service without editing any file.
 */
export function StackLogs({ workspace, stack, canControl }: { workspace: string; stack: string; canControl: boolean }) {
  const [service, setService] = useState<string | undefined>();
  const { entries, state, paused, pause, clear } = useStackLogs(workspace, stack, service);
  const captures = useCaptures(workspace, stack, state === "ready");

  const names = useMemo(() => {
    const set = new Set<string>(captures.data?.map((c) => c.service) ?? []);
    for (const e of entries) set.add(e.service);
    if (service) set.add(service);
    return [...set].sort();
  }, [captures.data, entries, service]);

  return (
    <div className="flex flex-col gap-3 px-4 pb-3 pt-1">
      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor={`logs-service-${stack}`}>
          Service
        </label>
        <select id={`logs-service-${stack}`} className={select} value={service ?? ""} onChange={(e) => setService(e.target.value || undefined)}>
          <option value="">All services</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => pause(!paused)} aria-pressed={paused} className={small}>
          {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button type="button" onClick={clear} title="Clears this view only; nothing stored is deleted" className={small}>
          <Eraser size={14} aria-hidden />
          Clear view
        </button>
        <span role="status" className="ms-auto text-[13px] tabular-nums text-ink-3">
          {state === "loading" ? "Loading…" : state === "error" ? "Could not load the logs." : `${entries.length} line${entries.length === 1 ? "" : "s"}${paused ? " · paused" : ""}`}
        </span>
      </div>

      <LogView entries={entries} label={`Logs of ${stack}${service ? `, ${service}` : ""}`} />

      {canControl && captures.data && captures.data.length > 0 && (
        <details className="rounded-ctl bg-inset px-3 py-2">
          <summary className="cursor-pointer text-[13px] text-ink-2">What is stored</summary>
          <ul className="m-0 mt-1 flex list-none flex-col divide-y divide-line p-0">
            {captures.data.map((c) => (
              <CaptureRow key={c.service} info={c} workspace={workspace} stack={stack} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
