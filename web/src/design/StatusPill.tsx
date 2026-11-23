import { useState } from "react";

import type { ToolState } from "../lib/types";
import { StatusDot, type Tone } from "./StatusDot";

// Status is a round dot plus a word, never colour alone (dev-plans/02-frontend-design-system.md
// section 2.4): the dot carries the colour and the word stays black.
const look: Record<ToolState, { label: string; tone: Tone }> = {
  ok: { label: "Ready", tone: "good" },
  degraded: { label: "Degraded", tone: "warning" },
  outdated: { label: "Outdated", tone: "serious" },
  missing: { label: "Missing", tone: "critical" },
};

export function StatusPill({ state, title }: { state: ToolState; title?: string }) {
  const { label, tone } = look[state];

  // When the state changes, flash the pill once. A change in the first render is not a
  // change, so nothing flashes on load. (Adjusting state while rendering is React's
  // documented way to react to a prop change without an effect.)
  const [shown, setShown] = useState(state);
  const [flashes, setFlashes] = useState(0);
  if (shown !== state) {
    setShown(state);
    setFlashes((n) => n + 1);
  }

  return (
    <span
      // A new key restarts the one-shot flash animation.
      key={flashes}
      className={`-mx-1.5 inline-flex items-center gap-2 px-1.5 py-0.5 text-ink ${flashes > 0 ? "flash" : ""}`}
      title={title}
    >
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}
