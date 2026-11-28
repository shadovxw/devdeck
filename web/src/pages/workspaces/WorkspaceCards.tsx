import { ProjectRing, type RingMotion } from "../../design/ring/ProjectRing";
import { prefersReducedMotion } from "../../design/EmptyOrb";
import type { RunStatus, WorkspaceSummary } from "../../lib/types";
import { effectiveEffects, useUi } from "../../store/ui";
import { projectShape, projectState, type ProjectState } from "./project-state";

// Ink at falling strengths, so the mix reads in every theme (Paper is monochrome) without a palette of its own.
const SHADES = ["var(--ink)", "color-mix(in srgb, var(--ink) 62%, var(--bg))", "color-mix(in srgb, var(--ink) 36%, var(--bg))", "color-mix(in srgb, var(--ink) 16%, var(--bg))"];

/** The repos by type, biggest first: the first three types get their own shade, the rest share the lightest. */
export function typeMix(counts: Record<string, number> | undefined): Array<{ type: string; count: number; shade: string }> {
  return Object.entries(counts ?? {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type, count], i) => ({ type, count, shade: SHADES[Math.min(i, SHADES.length - 1)] }));
}

/**
 * One project, as on the design's Projects board (dev-plans/2026-11-22-projects §4.1): a mono line
 * with its number and folder, its state, its name, what it is, and its shape in a line. The frame,
 * cut corners and glow are in design/pieces.css (data-ui="project-card").
 */
function Card({ w, index, state }: Readonly<{ w: WorkspaceSummary; index: number; state: ProjectState }>) {
  const mix = typeMix(w.repo_types);
  const mixLabel = "Repos by type: " + mix.map((m) => m.type + " " + m.count).join(", ");
  return (
    <button type="button" data-ui="project-card" aria-label={`Project ${w.name}`} title={`Open ${w.name}`} className="h-full w-full text-start">
        <span data-ui="project-card-in" className="flex min-h-44 flex-col gap-3 p-5">
          <span className="flex items-start justify-between gap-3">
            <span data-ui="project-kicker" className="min-w-0 truncate">
              PRJ_{String(index + 1).padStart(2, "0")}
              {w.root && <> // {w.root}</>}
            </span>
            <span data-ui="project-state" data-tone={state.tone} className="shrink-0">
              {state.text}
            </span>
          </span>
          <span className="flex items-center gap-2.5">
            <span data-ui="project-diamond" aria-hidden />
            <span data-ui="project-name" className="truncate">
              {w.name}
            </span>
            {w.source === "example" && <span data-ui="project-tag">Example</span>}
          </span>
          {w.description && <span className="line-clamp-5 text-[13px] leading-5 text-ink-3">{w.description}</span>}
          <span className="mt-auto flex items-center justify-between gap-3">
            <span data-ui="project-shape">{projectShape(w)}</span>
            {mix.length > 0 && (
              <span className="flex h-1 w-20 gap-px overflow-hidden" role="img" aria-label={mixLabel}>
                {mix.map((m) => (
                  <i key={m.type} style={{ flex: m.count, background: m.shade }} />
                ))}
              </span>
            )}
          </span>
        </span>
    </button>
  );
}

/** How much the ring may move: still with Effects off or reduced motion (the app's or the OS's). */
export function ringMotion(effects: "off" | "reduced" | "full", reduceMotion: boolean): RingMotion {
  if (effects === "off" || reduceMotion) return "still";
  return effects === "reduced" ? "reduced" : "full";
}

/**
 * The projects on a ring (dev-plans/2026-11-28-projects-ring): drag or use the arrows to turn it,
 * click a card to bring it to the front, click the front card to open its project. Always the ring:
 * it stands still instead of drifting when motion is turned down.
 */
export function WorkspaceCards({ items, runs, onSelect }: Readonly<{ items: WorkspaceSummary[]; runs?: RunStatus[]; onSelect: (id: string) => void }>) {
  const effects = useUi((u) => effectiveEffects(u.effects));
  const reduce = useUi((u) => u.reduceMotion) || prefersReducedMotion();
  const index = new Map(items.map((w, i) => [w.id, i]));
  return (
    <ProjectRing
      items={items}
      keyOf={(w) => w.id}
      nameOf={(w) => w.name}
      label="Projects"
      motion={ringMotion(effects, reduce)}
      onOpen={(w) => onSelect(w.id)}
      renderItem={(w) => <Card w={w} index={index.get(w.id) ?? 0} state={projectState(w, runs)} />}
    />
  );
}
