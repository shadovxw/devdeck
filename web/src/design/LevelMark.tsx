import type { LogLevel } from "../lib/types";

// A level is never colour alone: each has its own shape and a word (the same rule
// as the service states). Trace and debug are rings, info a dot, warn a triangle,
// error a square, fatal a diamond.
export const levelLook: Record<LogLevel, { word: string; label: string; shape: "ring" | "dot" | "triangle" | "square" | "diamond"; color: string }> = {
  trace: { word: "TRC", label: "trace", shape: "ring", color: "var(--ink-3)" },
  debug: { word: "DBG", label: "debug", shape: "ring", color: "var(--ink-2)" },
  info: { word: "INF", label: "info", shape: "dot", color: "var(--accent)" },
  warn: { word: "WRN", label: "warning", shape: "triangle", color: "var(--warning)" },
  error: { word: "ERR", label: "error", shape: "square", color: "var(--critical)" },
  fatal: { word: "FTL", label: "fatal", shape: "diamond", color: "var(--critical)" },
};

export const levelOrder: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/** The shape of a level alone, for a legend or a chart. */
export function LevelShape({ level, size = 10 }: { level: LogLevel; size?: number }) {
  const { shape, color } = levelLook[level];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="shrink-0">
      {shape === "dot" && <circle cx="6" cy="6" r="4.5" fill={color} />}
      {shape === "ring" && <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.6" />}
      {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" fill={color} />}
      {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill={color} />}
      {shape === "diamond" && <path d="M6 .8 11.2 6 6 11.2.8 6Z" fill={color} />}
    </svg>
  );
}

/** A level as its shape and a three-letter word; screen readers get the whole word. */
export function LevelMark({ level = "info" }: { level?: LogLevel }) {
  const { word, label } = levelLook[level];
  return (
    <span className="inline-flex w-12 shrink-0 items-center gap-1.5 text-ink-2" data-level={level}>
      <LevelShape level={level} />
      <span aria-hidden>{word}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
