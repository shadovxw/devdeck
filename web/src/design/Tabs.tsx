import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/** The look of one tab (dev-plans/02-frontend-design-system.md section 6.2), for the toggles that are not a single choice. */
export const tabClass = (selected: boolean) =>
  cn(
    "inline-flex h-7 items-center gap-1.5 border-b-2 text-[13px] font-medium transition-colors",
    selected ? "border-selected text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
  );

export type TabItem<T extends string> = { value: T; label: ReactNode; count?: number };

type Props<T extends string> = {
  /** What the tabs switch between, said to screen readers ("Levels"). */
  label: string;
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/**
 * Text tabs with a black underline on the selected one: List / Map, All / Errors / Warnings.
 * One tab is in the tab order; the arrow keys, Home and End move between them.
 */
export function Tabs<T extends string>({ label, items, value, onChange, className }: Props<T>) {
  const list = useRef<HTMLDivElement>(null);

  function onKey(e: KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const at = items.findIndex((i) => i.value === value);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowRight" ? 1 : items.length - 1)) % items.length;
    onChange(items[next].value);
    list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKey} className={cn("inline-flex gap-5", className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button key={item.value} type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} onClick={() => onChange(item.value)} className={tabClass(selected)}>
            {item.label}
            {item.count !== undefined && <span className="font-mono text-[11px] text-ink-3">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
