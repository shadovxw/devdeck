import { EllipsisVertical } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean };

type Props = {
  /** What the button is for, said to screen readers ("More actions"). */
  label: string;
  items: MenuItem[];
  className?: string;
};

/**
 * A small menu behind a "more" button. It opens next to the button (fixed, so a
 * scrolling or clipping parent can't cut it off), closes on Escape, on a click outside
 * and after a choice, and the arrow keys move between its items.
 */
export function Menu({ label, items, className = "" }: Props) {
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setAt(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function toggle(e: MouseEvent) {
    e.stopPropagation(); // the button may sit inside something that reacts to clicks, such as a table row
    if (open) return setAt(null);
    const r = button.current?.getBoundingClientRect();
    setAt({ top: (r?.bottom ?? 0) + 4, right: window.innerWidth - (r?.right ?? 0) });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setAt(null);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = Array.from(list.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={`inline-grid size-8 place-items-center rounded-ctl text-ink-3 transition hover:bg-accent-soft hover:text-ink ${className}`}
      >
        <EllipsisVertical size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={list}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          onClick={(e) => e.stopPropagation()}
          style={{ position: "fixed", top: at.top, right: at.right }}
          className="z-50 flex min-w-48 flex-col rounded-ctl bg-fill p-1 shadow-none ring-1 ring-line-strong"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setAt(null);
                item.onSelect();
              }}
              className="rounded-ctl px-3 py-2 text-start text-[13px] text-ink-2 transition hover:bg-accent-soft hover:text-ink disabled:cursor-not-allowed disabled:opacity-45"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
