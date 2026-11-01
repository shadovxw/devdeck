import { Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { LogQuery } from "../../lib/log-query";
import { applyInput, tokensOf, withoutToken } from "../../lib/log-tokens";

type Props = {
  value: LogQuery;
  onChange: (next: LogQuery) => void;
};

/**
 * One bar for the filters that name something: services, fields, a search text or pattern,
 * one kind of error, the end of a stretch. Each is a removable token. Type a filter and press
 * Enter to add it (`service:api`, `-user.id:42`, `/time(out|d out)/`, or plain text); Backspace
 * on an empty box takes the last token off; "/" anywhere on the page jumps here.
 */
export function QueryBar({ value, onChange }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const tokens = tokensOf(value);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        input.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      const applied = applyInput(value, text);
      if ("error" in applied) return setError(applied.error);
      setError(undefined);
      if (text.trim()) onChange(applied.query);
      setText("");
    } else if (e.key === "Backspace" && text === "" && tokens.length > 0) {
      onChange(withoutToken(value, tokens[tokens.length - 1]));
    } else if (e.key === "Escape") {
      setText("");
      setError(undefined);
    }
  }

  return (
    <div className="relative min-w-60 flex-1">
      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5 bg-fill px-2.5 py-1 hover:bg-fill-hover has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-focus">
        <Search size={15} aria-hidden className="shrink-0 text-ink-3" />
        {tokens.length > 0 && (
          <ul aria-label="Active filters" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {tokens.map((t) => (
              <li key={`${t.kind}:${t.key}${t.value}`} className="inline-flex items-center bg-bg font-mono text-[12px]">
                <span className={`ps-2 ${t.not ? "text-critical" : "text-ink-3"}`}>{t.key}</span>
                <span className={`pe-1 text-ink ${t.key ? "ps-px" : "ps-2"}`}>{t.value}</span>
                <button type="button" aria-label={t.remove} onClick={() => onChange(withoutToken(value, t))} className="inline-flex size-6 items-center justify-center text-ink-3 hover:text-ink">
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="sr-only" htmlFor="log-search">
          Search
        </label>
        <input
          id="log-search"
          ref={input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(undefined);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search text, /regex/, or field:value"
          aria-invalid={error !== undefined}
          aria-describedby={error ? "log-search-problem" : undefined}
          spellCheck={false}
          autoComplete="off"
          className="min-w-40 flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-ink-3"
        />
        <kbd aria-hidden className="bg-bg px-1.5 font-mono text-[10.5px] text-ink-3">
          /
        </kbd>
      </div>
      {error && (
        <span id="log-search-problem" role="alert" className="absolute top-10 text-[12px] text-critical">
          {error}
        </span>
      )}
    </div>
  );
}
