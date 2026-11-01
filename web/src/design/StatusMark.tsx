import { StatusDot, type Tone } from "./StatusDot";

export type Level = "ok" | "warn" | "fail";

const look: Record<Level, { label: string; tone: Tone }> = {
  ok: { label: "Passed", tone: "good" },
  warn: { label: "Warning", tone: "warning" },
  fail: { label: "Failed", tone: "critical" },
};

/** A round dot in the status colour; the word follows it, or is for screen readers only. */
export function StatusMark({ level, label = false }: { level: Level; label?: boolean }) {
  const { tone, label: text } = look[level];
  return (
    <>
      <StatusDot tone={tone} />
      {label ? text : <span className="sr-only">{text}</span>}
    </>
  );
}
