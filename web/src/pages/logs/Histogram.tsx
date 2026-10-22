import { useRef, useState, type PointerEvent } from "react";

import { LevelShape, levelLook, levelOrder } from "../../design/LevelMark";
import type { LogHistogram, LogLevel } from "../../lib/types";

const width = 600;
const height = 80;
/** Stack order, from the bottom: the loud levels sit on the baseline where they are easiest to read. */
/** How far (in pixels) the pointer must move for a press to count as a drag and not a click. */
const dragSlop = 4;
const stack: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

function count(counts: LogHistogram["buckets"][number]["counts"], level: LogLevel): number {
  return counts[level] ?? 0;
}

type Props = {
  data: LogHistogram | undefined;
  /** Called with the start and end (RFC 3339) of the stretch the reader dragged over. */
  onBrush: (from: string, to: string) => void;
};

/** About eight evenly spaced time labels under the bars, as a percentage across and their text. */
function axisTicks(data: LogHistogram): { at: number; text: string }[] {
  const n = data.buckets.length;
  const labels = Math.min(8, n);
  const days = new Date(data.to).getTime() - new Date(data.from).getTime() > 24 * 3600 * 1000;
  const secs = data.bucket_seconds < 60;
  const pad = (v: number) => String(v).padStart(2, "0");
  const out: { at: number; text: string }[] = [];
  for (let k = 0; k < labels; k++) {
    const i = labels === 1 ? 0 : Math.round((k * (n - 1)) / (labels - 1));
    const d = new Date(data.buckets[i].t);
    const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}${secs ? `:${pad(d.getSeconds())}` : ""}`;
    const at = ((i + 0.5) / n) * 100;
    if (!out.some((o) => o.at === at)) out.push({ at, text: days ? `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${clock}` : clock });
  }
  return out;
}

function span(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return seconds % 3600 === 0 ? `${seconds / 3600} h` : `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * How many lines of each level there were over time, as stacked bars in plain SVG.
 * Dragging across it narrows the view to that stretch. The legend at the right counts
 * every level; each has a shape and a word, so the colours are never the only thing
 * telling them apart.
 */
export function Histogram({ data, onBrush }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number; x0: number } | null>(null);

  if (!data) return <div className="skeleton h-[7.5rem] w-full" role="status" aria-label="Counting lines…" />;

  const n = data.buckets.length;
  const totals = data.buckets.map((b) => levelOrder.reduce((sum, l) => sum + count(b.counts, l), 0));
  const max = Math.max(1, ...totals);
  const barW = width / n;
  const byLevel = levelOrder.map((l) => ({ level: l, total: data.buckets.reduce((s, b) => s + count(b.counts, l), 0) }));
  const ticks = axisTicks(data);

  const indexAt = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };

  function finish(e: PointerEvent) {
    if (!drag) return;
    // A click is not a selection: only dragging narrows the view, so a stray click can't zoom in on one empty bar.
    if (Math.abs(e.clientX - drag.x0) < dragSlop) {
      setDrag(null);
      return;
    }
    const a = Math.min(drag.from, drag.to);
    const b = Math.max(drag.from, indexAt(e), drag.to);
    setDrag(null);
    const start = new Date(data!.buckets[a].t);
    const end = new Date(new Date(data!.buckets[b].t).getTime() + data!.bucket_seconds * 1000);
    onBrush(start.toISOString(), end.toISOString());
  }

  const brush = drag ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) } : null;

  return (
    <figure className="m-0 flex flex-wrap gap-x-6 gap-y-3 rounded-ctl bg-inset p-3 sm:flex-nowrap">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <svg
          ref={svg}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Lines over time, ${data.total} in all, in bars of ${span(data.bucket_seconds)}. Drag across it to look at one stretch.`}
          className="h-20 w-full touch-none cursor-crosshair"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            const i = indexAt(e);
            setDrag({ from: i, to: i, x0: e.clientX });
          }}
          onPointerMove={(e) => drag && setDrag({ ...drag, to: indexAt(e) })}
          onPointerUp={finish}
          onPointerCancel={() => setDrag(null)}
        >
          {data.buckets.map((b, i) => {
            let y = height - 1;
            return (
              <g key={b.t} data-bucket={b.t}>
                <title>{`${new Date(b.t).toLocaleTimeString()}: ${totals[i]} line${totals[i] === 1 ? "" : "s"}`}</title>
                {stack.map((l) => {
                  const h = (count(b.counts, l) / max) * (height - 6);
                  if (h <= 0) return null;
                  y -= h;
                  return <rect key={l} x={i * barW + 0.5} y={y} width={Math.max(1, barW - 1)} height={h} fill={levelLook[l].color} fillOpacity={l === "trace" || l === "debug" ? 0.55 : 0.9} />;
                })}
              </g>
            );
          })}
          {brush && <rect x={brush.a * barW} y={0} width={(brush.b - brush.a + 1) * barW} height={height} fill="var(--accent)" fillOpacity="0.18" />}
        </svg>
        <div aria-hidden className="relative h-4 text-[12px] text-ink-3">
          {ticks.map((t) => (
            <span key={t.at} style={{ left: `${t.at}%` }} className="absolute -translate-x-1/2 tabular-nums whitespace-nowrap">
              {t.text}
            </span>
          ))}
        </div>
        {data.total === 0 && <p className="sr-only">No lines in this stretch.</p>}
      </div>
      <figcaption className="w-36 shrink-0 text-[13px]">
        <ul aria-label="Lines by level" className="m-0 flex list-none flex-col gap-1 p-0">
          {byLevel.map(({ level, total }) => (
            <li key={level} className="flex items-center gap-2 text-ink-2">
              <LevelShape level={level} />
              <span>{levelLook[level].label}</span>
              <span className="ms-auto tabular-nums text-ink">{total.toLocaleString()}</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
