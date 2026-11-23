import { Copy } from "lucide-react";
import { useState } from "react";

import type { DoctorCheck } from "../lib/types";
import { StatusMark } from "./StatusMark";

/** A command or a link is shown as code; a sentence is shown as text. */
const looksLikeCommand = /^(git|winget|npm|npx|go|docker|brew|scoop|apt|python|pip|copy|cp|cd)\s/;

export function FixLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (/^https?:\/\//.test(text)) {
    return (
      <a href={text} target="_blank" rel="noreferrer" className="break-all font-mono text-xs text-accent hover:underline">
        {text}
      </a>
    );
  }
  if (!looksLikeCommand.test(text)) return <span className="text-[13px] text-ink-2">{text}</span>;

  const copy = () => {
    // Clipboard access can be refused; the text stays selectable either way.
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <span className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-ctl bg-inset px-2 py-1 font-mono text-xs text-ink-2">{text}</code>
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy"}
        aria-label={`Copy: ${text}`}
        className="grid size-7 shrink-0 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink active:scale-90"
      >
        <Copy size={14} aria-hidden />
      </button>
    </span>
  );
}

export function CheckRow({ check }: { check: DoctorCheck }) {
  return (
    <li className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 flex">
          <StatusMark level={check.status} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[14px] text-ink">{check.title}</p>
          {check.detail && <p className="m-0 mt-0.5 break-words text-[13px] text-ink-3">{check.detail}</p>}
        </div>
        {check.stack && <span className="mt-0.5 shrink-0 font-mono text-xs text-ink-3">{check.stack}</span>}
      </div>
      {check.fix && check.fix.length > 0 && (
        <div className="ms-6 flex flex-col gap-1.5">
          {check.fix.map((line) => (
            <FixLine key={line} text={line} />
          ))}
        </div>
      )}
    </li>
  );
}
