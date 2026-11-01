// The one status mark (dev-plans/02-frontend-design-system.md section 6.5): a round dot,
// an empty ring for "stopped", or a turning arc for work in progress. The word beside
// it carries the meaning, so a dot never stands alone without a label or an aria-label.
export const toneColor = {
  good: "var(--good)",
  warning: "var(--warning)",
  serious: "var(--serious)",
  critical: "var(--critical)",
  neutral: "var(--neutral)",
  // Not health: used by log levels and work in progress.
  ink: "var(--ink)",
  "ink-2": "var(--ink-2)",
  "ink-3": "var(--ink-3)",
  primary: "var(--primary)",
} as const;

export type Tone = keyof typeof toneColor;

type Props = {
  tone: Tone;
  /** An empty ring instead of a filled dot. Neutral (stopped, skipped) is always drawn this way. */
  ring?: boolean;
  /** A turning arc: building, starting, stopping. */
  spin?: boolean;
  /** Pixels. 8 by default, 6 inside dense rows. */
  size?: number;
  className?: string;
};

function Mark({ color, ring, spin }: Readonly<{ color: string; ring: boolean; spin: boolean }>) {
  if (spin) {
    return (
      <>
        <circle cx="4" cy="4" r="3" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.5" />
        <path d="M4 1a3 3 0 0 1 3 3" fill="none" stroke={color} strokeWidth="1.5" />
      </>
    );
  }
  if (ring) return <circle cx="4" cy="4" r="3" fill="none" stroke={color} strokeWidth="1.5" />;
  return <circle cx="4" cy="4" r="4" fill={color} />;
}

export function StatusDot({ tone, ring = tone === "neutral", spin = false, size = 8, className = "" }: Readonly<Props>) {
  const color = toneColor[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" aria-hidden className={`shrink-0 ${spin ? "spin-arc" : ""} ${className}`} data-tone={tone}>
      <Mark color={color} ring={ring} spin={spin} />
    </svg>
  );
}
