import type { ToolState } from "../lib/types";

// Status is never colour alone: each state has its own shape and a label
// (flight-deck convention, dev-plans/02-frontend-design-system.md §2.1).
const look: Record<ToolState, { label: string; color: string; shape: "dot" | "triangle" | "diamond" | "square" }> = {
  ok: { label: "Ready", color: "var(--good)", shape: "dot" },
  degraded: { label: "Degraded", color: "var(--warning)", shape: "triangle" },
  outdated: { label: "Outdated", color: "var(--serious)", shape: "diamond" },
  missing: { label: "Missing", color: "var(--critical)", shape: "square" },
};

function Shape({ shape, color }: { shape: (typeof look)[ToolState]["shape"]; color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill={color}>
      {shape === "dot" && <circle cx="6" cy="6" r="4.5" />}
      {shape === "triangle" && <path d="M6 1.2 11 10.2H1Z" />}
      {shape === "diamond" && <path d="M6 .8 11.2 6 6 11.2.8 6Z" />}
      {shape === "square" && <rect x="1.8" y="1.8" width="8.4" height="8.4" />}
    </svg>
  );
}

export function StatusPill({ state, title }: { state: ToolState; title?: string }) {
  const { label, color, shape } = look[state];
  return (
    <span className="inline-flex items-center gap-2 text-ink-2" title={title}>
      <Shape shape={shape} color={color} />
      {label}
    </span>
  );
}
