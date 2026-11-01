import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";

import type { Mute } from "../../lib/log-mutes";
import { parseMuteInput } from "../../lib/log-mutes";
import { displayOfPattern } from "../../lib/log-tokens";

type Props = {
  mutes: Mute[];
  onAdd: (pattern: string) => void;
  onToggle: (pattern: string) => void;
  onRemove: (pattern: string) => void;
  /** Lines the applied mutes left out of the range, when known. */
  muted?: number;
};

const label = "font-mono text-[11px] uppercase leading-[14px] tracking-[0.06em] text-ink-3";

/**
 * Noise to hide: lines whose text matches one of these patterns are left out of the list, the
 * counts and the histogram, and nothing is deleted. A check mark means the pattern is applied.
 */
export function MutedNoise({ mutes, onAdd, onToggle, onRemove, muted }: Props) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const parsed = parseMuteInput(text);
      if ("error" in parsed) return setError(parsed.error);
      onAdd(parsed.pattern);
      setText("");
      setError(undefined);
      setAdding(false);
    } else if (e.key === "Escape") {
      setText("");
      setError(undefined);
      setAdding(false);
    }
  }

  return (
    <section aria-label="Muted noise" className="flex min-w-0 flex-col gap-2">
      <h2 className={`${label} m-0 flex items-baseline gap-3 font-normal`}>
        Muted noise
        <span className="ms-auto flex gap-3 text-[12px] normal-case tracking-normal">
          {muted ? <span className="font-mono text-ink-3">{muted.toLocaleString()} hidden</span> : null}
          <button type="button" onClick={() => setAdding((v) => !v)} aria-expanded={adding} className="text-ink-3 hover:text-ink hover:underline">
            + add
          </button>
        </span>
      </h2>
      {adding && (
        <div className="relative">
          <label className="sr-only" htmlFor="mute-input">
            Text or /pattern/ to hide
          </label>
          <input
            id="mute-input"
            autoFocus
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(undefined);
            }}
            onKeyDown={onKeyDown}
            placeholder="Text or /pattern/, then Enter"
            aria-invalid={error !== undefined}
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full bg-fill px-2.5 font-mono text-[12px] text-ink outline-none placeholder:text-ink-3 hover:bg-fill-hover"
          />
          {error && (
            <span role="alert" className="absolute top-9 text-[12px] text-critical">
              {error}
            </span>
          )}
        </div>
      )}
      {mutes.length === 0 && !adding && <p className="m-0 text-[13px] text-ink-3">Nothing muted.</p>}
      <ul className="m-0 flex list-none flex-col p-0">
        {mutes.map((m) => (
          <li key={m.pattern} className="group flex items-center hover:bg-fill">
            <label className={`flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1.5 py-1 text-[12px] ${m.on ? "text-ink" : "text-ink-3"}`}>
              <input type="checkbox" checked={m.on} onChange={() => onToggle(m.pattern)} className="size-3 shrink-0 cursor-pointer" />
              <span className="truncate font-mono" title={displayOfPattern(m.pattern)}>
                {displayOfPattern(m.pattern)}
              </span>
            </label>
            <button
              type="button"
              aria-label={`Remove the muted pattern ${displayOfPattern(m.pattern)}`}
              onClick={() => onRemove(m.pattern)}
              className="inline-flex size-6 items-center justify-center text-ink-3 opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X size={12} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
