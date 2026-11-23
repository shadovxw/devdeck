import { downsample, sparkPoints } from "../lib/sparkline";

type Props = {
  counts: number[];
  width?: number;
  height?: number;
  /** The line's colour; ink-3 by default, critical for errors. */
  tone?: "ink-3" | "critical" | "warning";
  /** Fills under the line, for the wider one beside an issue. */
  area?: boolean;
  className?: string;
};

const color = { "ink-3": "var(--ink-3)", critical: "var(--critical)", warning: "var(--warning)" } as const;

/** A small line of counts over time. It is decoration: the number beside it carries the meaning. */
export function Sparkline({ counts, width = 48, height = 14, tone = "ink-3", area = false, className = "" }: Readonly<Props>) {
  const pts = sparkPoints(downsample(counts, 24), width, height);
  if (pts.length === 0) return <svg width={width} height={height} aria-hidden className={className} />;
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className={`shrink-0 ${className}`}>
      {area && <path d={`${line} L${width} ${height} L0 ${height} Z`} fill={color[tone]} fillOpacity="0.14" stroke="none" />}
      <path d={line} fill="none" stroke={color[tone]} strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
