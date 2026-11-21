import type { ReactNode } from "react";

type Props = {
  /** Two digits, shown boxed: "01". */
  index: string;
  /** The verb, written like a command: "UP" becomes "$ UP". */
  verb: string;
  /** What the section holds: "STACKS". */
  name: string;
  /** A count at the end of the line: { label: "TOTAL_STACKS", value: "04" }. */
  count?: { label: string; value: string };
  /** A display heading under the line ("Running stacks"). Its last word gets the accent gradient. */
  title?: string;
  /** Anything to show at the right of the heading (a live dot, a toggle). */
  aside?: ReactNode;
};

/**
 * The Neon style's section header (dev-plans/2026-11-21-portfolio-look, decision 5):
 * `[01] $ UP  STACKS ─── TOTAL_STACKS: 04`, then an optional big heading. Flat has no such
 * header, so it isn't drawn there at all (look-neon), and Flat pages stay as they are.
 */
export function SectionHeader({ index, verb, name, count, title, aside }: Readonly<Props>) {
  const words = title?.trim().split(/\s+/) ?? [];
  const last = words.pop();
  return (
    <div data-ui="section-header" className="look-neon">
      <div data-ui="section-line">
        <span data-ui="section-index">{index}</span>
        <span data-ui="section-verb">$ {verb}</span>
        <span data-ui="section-name">{name}</span>
        <span data-ui="section-rule" aria-hidden />
        {count && (
          <span data-ui="section-count">
            {count.label}: {count.value}
          </span>
        )}
        {aside && <span data-ui="section-aside">{aside}</span>}
      </div>
      {last && (
        <h2 data-ui="display">
          {words.length > 0 && `${words.join(" ")} `}
          <span data-ui="gradient-word">{last}</span>
        </h2>
      )}
    </div>
  );
}
