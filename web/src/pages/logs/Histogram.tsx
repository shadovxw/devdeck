import { useRef, useState, type PointerEvent } from "react";

import { LevelShape, levelLook, levelOrder } from "../../design/LevelMark";
import type { LogHistogram, LogLevel } from "../../lib/types";

const width = 600;
const height = 72;
/** Stack order, from the bottom: the loud levels sit on the baseline where they are easiest to read. */
const stack: LogLevel[] = ["fatal", "error", "warn", "info", "debug", "trace"];

function count(counts: LogHistogram["buckets"][number]["counts"], level: LogLevel): number {
  return counts[level] ?? 0;
}

type Props = {
  data: LogHistogram | undefined;
  /** Called with the start and end (RFC 3339) of the stretch the reader dragged over. */
  onBrush: (from: string, to: string) => void;
};

function span(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return seconds % 3600 === 0 ? `${seconds / 3600} h` : `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * How many lines of each level there were over time, as stacked bars in plain SVG.
 * Dragging across it narrows the view to that stretch. Every level has a shape and a
 * word in the legend below, so the colours are never the only thing telling them apart.
 */
export function Histogram({ data, onBrush }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);

  if (!data) return <div className="skeleton h-[72px] w-full" role="status" aria-label="Counting lines…" />;

  const n = data.buckets.length;
  const totals = data.buckets.map((b) => levelOrder.reduce((sum, l) => sum + count(b.counts, l), 0));
  const max = Math.max(1, ...totals);
  const barW = width / n;
  const byLevel = levelOrder.map((l) => ({ level: l, total: data.buckets.reduce((s, b) => s + count(b.counts, l), 0) })).filter((x) => x.total > 0);

  const indexAt = (e: PointerEvent) => {
    const r = svg.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };

  function finish(e: PointerEvent) {
    if (!drag) return;
    const a = Math.min(drag.from, drag.to);
    const b = Math.max(drag.from, indexAt(e), drag.to);
    setDrag(null);
    const start = new Date(data!.buckets[a].t);
    const end = new Date(new Date(data!.buckets[b].t).getTime() + data!.bucket_seconds * 1000);
    onBrush(start.toISOString(), end.toISOString());
  }

  const brush = drag ? { a: Math.min(drag.from, drag.to), b: Math.max(drag.from, drag.to) } : null;

  return (
    <figure className="m-0 flex flex-col gap-2">
      <svg
        ref={svg}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Lines over time, ${data.total} in all, in bars of ${span(data.bucket_seconds)}. Drag across it to look at one stretch.`}
        className="h-[72px] w-full touch-none cursor-crosshair rounded-ctl bg-inset"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture?.(e.pointerId);
          const i = indexAt(e);
          setDrag({ from: i, to: i });
        }}
        onPointerMove={(e) => drag && setDrag({ from: drag.from, to: indexAt(e) })}
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
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-3">
        {byLevel.length === 0 && <span>No lines in this stretch.</span>}
        {byLevel.map(({ level, total }) => (
          <span key={level} className="inline-flex items-center gap-1.5">
            <LevelShape level={level} />
            {levelLook[level].label} {total.toLocaleString()}
          </span>
        ))}
        <span className="ms-auto">
          {new Date(data.from).toLocaleTimeString()} to {new Date(data.to).toLocaleTimeString()}
        </span>
      </figcaption>
    </figure>
  );
}
