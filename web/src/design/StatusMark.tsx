export type Level = "ok" | "warn" | "fail";

const look: Record<Level, { label: string; color: string }> = {
  ok: { label: "Passed", color: "var(--good)" },
  warn: { label: "Warning", color: "var(--warning)" },
  fail: { label: "Failed", color: "var(--critical)" },
};

/**
 * Same shapes as the status pills, so colour is never the only signal:
 * ok is a dot, a warning a triangle, a failure a square.
 */
export function StatusMark({ level, label = false }: { level: Level; label?: boolean }) {
  const { color, label: text } = look[level];
  return (
    <>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill={color} className="shrink-0">
        {level === "ok" && <circle cx="6" cy="6" r="4.5" />}
        {level === "warn" && <path d="M6 1.2 11 10.2H1Z" />}
        {level === "fail" && <rect x="1.8" y="1.8" width="8.4" height="8.4" />}
      </svg>
      {label ? text : <span className="sr-only">{text}</span>}
    </>
  );
}
