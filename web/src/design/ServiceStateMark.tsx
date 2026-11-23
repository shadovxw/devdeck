import type { ServiceState } from "../lib/types";
import { StatusDot, type Tone } from "./StatusDot";

// A service's state is a round dot plus a word, never colour alone. Stopped and waiting
// are an empty ring; working states (building, starting, stopping) are a turning arc.
const look: Record<ServiceState, { label: string; tone: Tone; ring?: boolean; spin?: boolean }> = {
  ready: { label: "Ready", tone: "good" },
  waiting: { label: "Waiting", tone: "neutral", ring: true },
  stopped: { label: "Stopped", tone: "neutral", ring: true },
  building: { label: "Building", tone: "primary", spin: true },
  starting: { label: "Starting", tone: "primary", spin: true },
  stopping: { label: "Stopping", tone: "ink-3", spin: true },
  restarting: { label: "Restarting", tone: "serious" },
  blocked: { label: "Blocked", tone: "critical" },
  failed: { label: "Failed", tone: "critical" },
};

export const stateLabel = (state: ServiceState) => look[state].label;

/**
 * The mark for a service state. With `label`, the word follows it; otherwise the
 * word is for screen readers. `text` swaps the word, for a whole stack ("Running").
 */
export function ServiceStateMark({ state, label = true, text: word }: { state: ServiceState; label?: boolean; text?: string }) {
  const { tone, ring, spin, label: text0 } = look[state];
  const text = word ?? text0;
  return (
    <span className="inline-flex items-center gap-2 text-ink" data-state={state}>
      <StatusDot tone={tone} ring={ring} spin={spin} className={state === "restarting" ? "pulse-mark" : ""} />
      {label ? text : <span className="sr-only">{text}</span>}
    </span>
  );
}
