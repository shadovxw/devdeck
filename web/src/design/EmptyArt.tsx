import { Box, Database, FileCode, Settings, type LucideIcon } from "lucide-react";
import { useId } from "react";

type SlabProps = {
  cx: number;
  cy: number;
  /** Half the width and half the height of the top face, and the slab's thickness. */
  w: number;
  h: number;
  t: number;
  top: string;
  left: string;
  right: string;
  edge?: string;
};

// An isometric slab: a top face and two side faces. Rounded joins soften the corners.
function Slab({ cx, cy, w, h, t, top, left, right, edge }: SlabProps) {
  const topPath = `M${cx} ${cy - h}L${cx + w} ${cy}L${cx} ${cy + h}L${cx - w} ${cy}Z`;
  const leftPath = `M${cx - w} ${cy}L${cx} ${cy + h}L${cx} ${cy + h + t}L${cx - w} ${cy + t}Z`;
  const rightPath = `M${cx} ${cy + h}L${cx + w} ${cy}L${cx + w} ${cy + t}L${cx} ${cy + h + t}Z`;
  return (
    <g strokeLinejoin="round" strokeWidth={5}>
      <path d={leftPath} fill={left} stroke={left} />
      <path d={rightPath} fill={right} stroke={right} />
      <path d={topPath} fill={top} stroke={top} />
      {edge && <path d={topPath} fill="none" stroke={edge} strokeWidth={1.25} />}
    </g>
  );
}

const SATELLITES: Array<{ x: number; y: number; icon: LucideIcon }> = [
  { x: 168, y: 96, icon: Box },
  { x: 396, y: 112, icon: Database },
  { x: 156, y: 240, icon: Settings },
  { x: 404, y: 236, icon: FileCode },
];

const CENTER = { x: 282, y: 168 };

/** The illustration on empty pages: a dark centre tile linked to four smaller ones. */
export function EmptyArt({ centerIcon: Center }: { centerIcon: LucideIcon }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 560 340" className="h-auto w-full max-w-[600px]" aria-hidden focusable="false">
      <defs>
        <pattern id={`${id}g`} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.9" fill="var(--line-strong)" />
        </pattern>
        <radialGradient id={`${id}f`}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id={`${id}m`}>
          <ellipse cx="280" cy="170" rx="240" ry="150" fill={`url(#${id}f)`} />
        </mask>
        <filter id={`${id}b`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect x="40" y="10" width="480" height="320" fill={`url(#${id}g)`} mask={`url(#${id}m)`} opacity="0.7" />

      {[
        [70, 70],
        [494, 84],
        [72, 292],
        [492, 290],
      ].map(([x, y]) => (
        <path key={`${x}-${y}`} d={`M${x - 4} ${y}H${x + 4}M${x} ${y - 4}V${y + 4}`} stroke="var(--ink-3)" strokeWidth="1" opacity="0.6" />
      ))}

      {/* links, drawn under the tiles */}
      {SATELLITES.map((s) => (
        <g key={`${s.x}-${s.y}`}>
          <line
            x1={CENTER.x}
            y1={CENTER.y}
            x2={s.x}
            y2={s.y}
            stroke="var(--accent)"
            strokeWidth="1.25"
            strokeDasharray="3 4"
            opacity="0.85"
          />
          <circle cx={CENTER.x + (s.x - CENTER.x) * 0.62} cy={CENTER.y + (s.y - CENTER.y) * 0.62} r="2.6" fill="var(--accent)" />
        </g>
      ))}

      {SATELLITES.map(({ x, y, icon: Icon }) => (
        <g key={`${x}-${y}`}>
          <ellipse cx={x} cy={y + 30} rx="48" ry="12" fill="var(--tile-shadow)" filter={`url(#${id}b)`} />
          <Slab cx={x} cy={y} w={44} h={25} t={9} top="var(--tile-top)" left="var(--tile-side)" right="var(--tile-side)" edge="var(--tile-line)" />
          <Icon x={x - 12} y={y - 17} width={24} height={24} strokeWidth={1.6} color="var(--tile-icon)" />
        </g>
      ))}

      <g>
        <ellipse cx={CENTER.x} cy={CENTER.y + 38} rx="92" ry="22" fill="var(--tile-shadow)" filter={`url(#${id}b)`} />
        <Slab
          cx={CENTER.x}
          cy={CENTER.y}
          w={86}
          h={48}
          t={16}
          top="var(--center-top)"
          left="var(--center-side)"
          right="var(--center-side)"
          edge="var(--accent)"
        />
        <path
          d={`M${CENTER.x} ${CENTER.y - 30}L${CENTER.x + 54} ${CENTER.y}L${CENTER.x} ${CENTER.y + 30}L${CENTER.x - 54} ${CENTER.y}Z`}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="1"
          opacity="0.35"
        />
        <Center x={CENTER.x - 20} y={CENTER.y - 24} width={40} height={40} strokeWidth={2} color="#f2fbfc" />
      </g>
    </svg>
  );
}
