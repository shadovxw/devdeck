import { Plus } from "lucide-react";

import type { RunStatus, WorkspaceSummary } from "../../lib/types";
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
function Card({ w, index, state, onSelect }: Readonly<{ w: WorkspaceSummary; index: number; state: ProjectState; onSelect: () => void }>) {
  const mix = typeMix(w.repo_types);
  const mixLabel = "Repos by type: " + mix.map((m) => m.type + " " + m.count).join(", ");
  return (
    <li className="contents">
      <button type="button" data-ui="project-card" aria-label={`Project ${w.name}`} title={`Open ${w.name}`} onClick={onSelect} className="text-start">
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
          {w.description && <span className="line-clamp-2 text-[13px] leading-5 text-ink-3">{w.description}</span>}
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
    </li>
  );
}

/** The projects as cards, with a tile at the end to add another. A card opens its project. */
export function WorkspaceCards({
  items,
  runs,
  onSelect,
  onAdd,
}: Readonly<{ items: WorkspaceSummary[]; runs?: RunStatus[]; onSelect: (id: string) => void; onAdd: () => void }>) {
  return (
    <ul aria-label="Projects" className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(20rem,1fr))] gap-4 p-0">
      {items.map((w, i) => (
        <Card key={w.id} w={w} index={i} state={projectState(w, runs)} onSelect={() => onSelect(w.id)} />
      ))}
      <li className="contents">
        <button type="button" data-ui="project-add" onClick={onAdd} className="flex min-h-44 flex-col items-center justify-center gap-2 p-5 text-center">
          <Plus size={20} aria-hidden />
          <b data-ui="project-add-label">New project</b>
          <span className="max-w-64 text-[13px] leading-5 text-ink-3">One repo, or a folder of them. devdeck finds the rest.</span>
        </button>
      </li>
    </ul>
  );
}
