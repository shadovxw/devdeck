import type { ReactNode } from "react";

import { StatusDot, type Tone } from "./StatusDot";

/**
 * A small status label: `WARN`, `INFO`, `FAIL`. Flat draws it as a status dot and the word;
 * Neon as the word in a thin box of its status colour (design/pieces.css). The word always
 * carries the meaning, the colour only repeats it.
 */
export function Tag({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
  return (
    <span data-ui="tag" data-tone={tone} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink">
      <StatusDot tone={tone} size={6} className="look-flat" />
      {children}
    </span>
  );
}
