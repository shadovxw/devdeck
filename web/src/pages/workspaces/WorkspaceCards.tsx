import { useState } from "react";

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

/** What a card with no picture shows: the first letters of a name's first two words, else its first two characters. */
export function initials(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length > 1) return Array.from(words[0])[0] + Array.from(words[1])[0];
  return Array.from(words[0] ?? name)
    .slice(0, 2)
    .join("");
}

/** The card's picture: the project's own, or its initials when it has none or it can't be shown. */
function Art({ name, url }: Readonly<{ name: string; url?: string }>) {
  // The address that failed; a changed file has a new one, which is tried again.
  const [broken, setBroken] = useState<string>();
  if (url && broken !== url) {
    // Not draggable: the browser's own image drag would take over the ring's.
    return <img data-ui="project-art" src={url} alt="" draggable={false} onError={() => setBroken(url)} />;
  }
  return (
    <span data-ui="project-art" data-fallback aria-hidden>
      <span data-ui="project-initials">
        {initials(name)}
        <i>.</i>
      </span>
    </span>
  );
}

/**
 * One project as a poster (dev-plans/2026-11-28-project-posters §4): its picture fills the card, with
 * its number and state above and its name and shape below. The frame, cut corners, fades and glow are
 * in design/pieces.css (data-ui="project-card").
 */
function Card({ w, index, state }: Readonly<{ w: WorkspaceSummary; index: number; state: ProjectState }>) {
  return (
    <button type="button" data-ui="project-card" aria-label={`Project ${w.name}`} title={`Open ${w.name}`} className="h-full w-full text-start">
      <span data-ui="project-card-in" className="flex min-h-44 flex-col justify-between">
        {/* First, so the fades of the two blocks after it can tell a picture from the initials. */}
        <Art name={w.name} url={w.poster_url} />
        <span data-ui="project-top" className="flex items-start justify-between gap-3 px-5 pb-8 pt-5">
          <span data-ui="project-kicker" className="min-w-0 truncate">
            PRJ_{String(index + 1).padStart(2, "0")}
            {w.root && <> // {w.root}</>}
          </span>
          <span data-ui="project-state" data-tone={state.tone} className="shrink-0">
            {state.text}
          </span>
        </span>
        <span data-ui="project-foot" className="flex flex-col gap-2 px-5 pb-5 pt-12">
          {/* Wraps, so on a narrow card the tag moves down instead of cutting the name short. */}
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span data-ui="project-diamond" aria-hidden />
            <span data-ui="project-name" className="max-w-[calc(100%-1.25rem)] truncate">
              {w.name}
            </span>
            {w.source === "example" && <span data-ui="project-tag">Example</span>}
          </span>
          <span data-ui="project-shape">{projectShape(w)}</span>
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
