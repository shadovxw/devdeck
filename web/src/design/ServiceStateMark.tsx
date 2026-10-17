import type { ServiceState } from "../lib/types";

// A service's state is never colour alone: every state has its own shape and a
// word (the same rule as the status pills). Working states (building, starting,
// stopping) turn; trouble states (restarting, blocked, failed) are a triangle
// or a square.
const look: Record<ServiceState, { label: string; shape: "dot" | "ring" | "arc" | "triangle" | "square"; color: string }> = {
  ready: { label: "Ready", shape: "dot", color: "var(--good)" },
  waiting: { label: "Waiting", shape: "ring", color: "var(--ink-3)" },
  stopped: { label: "Stopped", shape: "ring", color: "var(--ink-3)" },
  building: { label: "Building", shape: "arc", color: "var(--accent)" },
  starting: { label: "Starting", shape: "arc", color: "var(--accent)" },
  stopping: { label: "Stopping", shape: "arc", color: "var(--ink-3)" },
  restarting: { label: "Restarting", shape: "triangle", color: "var(--warning)" },
  blocked: { label: "Blocked", shape: "triangle", color: "var(--warning)" },
  failed: { label: "Failed", shape: "square", color: "var(--critical)" },
};

export const stateLabel = (state: ServiceState) => look[state].label;

/**
 * The shape for a service state. With `label`, the word follows it; otherwise the
 * word is for screen readers. `text` swaps the word, for a whole stack ("Running").
 */
export function ServiceStateMark({ state, label = true, text: word }: { state: ServiceState; label?: boolean; text?: string }) {
  const { shape, color, label: text0 } = look[state];
  const text = word ?? text0;
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" data-state={state}>
      <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className={`shrink-0 ${shape === "arc" ? "spin-arc" : state === "restarting" ? "pulse-mark" : ""}`}>
        {shape === "dot" && <circle cx="6" cy="6" r="4.5" fill={color} />}
        {shape === "ring" && <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.6" />}
        {shape === "arc" && (
          <>
            <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1.6" />
            <path d="M6 2a4 4 0 0 1 4 4" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
          </>
        )}
        {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" fill={color} />}
        {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" fill={color} />}
      </svg>
      {label ? text : <span className="sr-only">{text}</span>}
    </span>
  );
}
