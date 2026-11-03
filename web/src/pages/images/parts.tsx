import type { ReactNode } from "react";

export const short = (sha?: string) => (sha ? sha.slice(0, 7) : "");

/** A state as a word with a shape, never colour alone. */
export function Mark({ ok, children, title }: Readonly<{ ok: boolean; children: ReactNode; title?: string }>) {
  const tone = ok ? "var(--good)" : "var(--critical)";
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-ink-2" title={title}>
      <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden className="shrink-0">
        {ok ? <circle cx="6" cy="6" r="4.5" fill={tone} /> : <path d="M6 1.2 11 10.2H1Z" fill={tone} />}
      </svg>
      {children}
    </span>
  );
}

/** docker's output as it arrives. */
export function Output({ lines }: Readonly<{ lines: string[] }>) {
  if (lines.length === 0) return null;
  return (
    <pre aria-label="Build output" role="log" className="m-0 max-h-[18rem] overflow-auto rounded-ctl bg-bg p-3 font-mono text-[12px] leading-5 text-ink-2">
      {lines.join("\n")}
    </pre>
  );
}
