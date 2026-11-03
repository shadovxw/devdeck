import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";

import { pillSmall } from "../../design/pills";

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

/** docker's output as it arrives, with a button that copies the whole of it. */
export function Output({ lines }: Readonly<{ lines: string[] }>) {
  const [copied, setCopied] = useState(false);
  if (lines.length === 0) return null;

  const copy = () => {
    // Clipboard access can be refused; the text stays selectable either way.
    navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-3">
          Build output · {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
        <button type="button" className={pillSmall} onClick={copy}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          {copied ? "Copied" : "Copy log"}
        </button>
      </div>
      <pre aria-label="Build output" role="log" className="m-0 max-h-[24rem] overflow-auto rounded-ctl bg-bg p-3 font-mono text-[12px] leading-5 text-ink-2">
        {lines.join("\n")}
      </pre>
    </div>
  );
}
