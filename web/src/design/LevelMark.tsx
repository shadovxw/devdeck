import type { LogLevel } from "../lib/types";
import { StatusDot, toneColor, type Tone } from "./StatusDot";

// A level is a round dot plus a word. Trace and debug are empty rings, info a quiet grey
// dot, warn amber, error red and fatal black (worse than red, like the strip's failing minute).
const tones: Record<LogLevel, { word: string; label: string; tone: Tone; ring?: boolean }> = {
  trace: { word: "TRACE", label: "trace", tone: "neutral", ring: true },
  debug: { word: "DEBUG", label: "debug", tone: "ink-3", ring: true },
  info: { word: "INFO", label: "info", tone: "ink-3" },
  warn: { word: "WARN", label: "warning", tone: "warning" },
  error: { word: "ERROR", label: "error", tone: "critical" },
  fatal: { word: "FATAL", label: "fatal", tone: "ink" },
};

/** The colour of each level, for charts that draw bars by level. */
export const levelLook: Record<LogLevel, { word: string; label: string; color: string }> = Object.fromEntries(
  (Object.keys(tones) as LogLevel[]).map((l) => [l, { word: tones[l].word, label: tones[l].label, color: toneColor[tones[l].tone] }]),
) as Record<LogLevel, { word: string; label: string; color: string }>;

export const levelOrder: LogLevel[] = ["trace", "debug", "info", "warn", "error", "fatal"];

/** The dot of a level alone, for a legend or a filter. */
export function LevelShape({ level, size = 8 }: Readonly<{ level: LogLevel; size?: number }>) {
  const { tone, ring } = tones[level];
  return <StatusDot tone={tone} ring={ring} size={size} />;
}

/** A level as its dot and its word; screen readers get the whole word. */
export function LevelMark({ level = "info" }: Readonly<{ level?: LogLevel }>) {
  const { word, label } = tones[level];
  return (
    <span className="inline-flex w-[4.5rem] shrink-0 items-center gap-1.5 text-ink-2" data-level={level}>
      <LevelShape level={level} />
      <span aria-hidden>{word}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
