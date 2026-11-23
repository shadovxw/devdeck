import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = {
  /** The heading, an upper-case mono label. */
  title: string;
  /** What comes before the title, written like a command ("02 $"). */
  kicker?: string;
  /** A link or button at the right of the heading ("View all →"). */
  action?: ReactNode;
  /** The section's accessible name; the title by default. */
  label?: string;
  className?: string;
  children: ReactNode;
};

/**
 * A block of a page: a panel set apart by the theme's card colour, with its heading as a mono
 * label row (design/pieces.css).
 */
export function Panel({ title, kicker, action, label, className, children }: Readonly<Props>) {
  return (
    <section data-ui="panel" aria-label={label ?? title} className={cn("min-w-0", className)}>
      <div data-ui="panel-head" className="mb-5 flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-[14px] font-semibold leading-5 text-ink">
          {kicker && <span>{kicker} </span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
