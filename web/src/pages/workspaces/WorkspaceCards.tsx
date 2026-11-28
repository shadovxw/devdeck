import { useId, useState } from "react";

import { CardFan, type CardMotion } from "../../design/fan/CardFan";
import { prefersReducedMotion } from "../../design/EmptyOrb";
import { ServiceStateMark, stateLabel } from "../../design/ServiceStateMark";
import type { RunStatus, ServiceStatus, WorkspaceSummary } from "../../lib/types";
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
    // Not draggable: a press that slips should open the project, not drag its picture off.
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

/** The types a dossier lists: all of them up to four, else the biggest three and the rest as one line. */
export function typeRows(counts: Record<string, number> | undefined) {
  const mix = typeMix(counts);
  if (mix.length <= 4) return mix;
  const rest = mix.slice(3);
  return [...mix.slice(0, 3), { type: `${rest.length} more`, count: rest.reduce((sum, m) => sum + m.count, 0), shade: rest[0].shade }];
}

/**
 * What the card shows when it is expanded: its name again, then what the project is, its repos by type
 * (or, while it runs, a mark for each service), and its totals. It is a sheet that slides up over the lower
 * part of the picture (pieces.css), unseen until then; all but the name describes the card's button either
 * way.
 */
function Dossier({ id, w, services }: Readonly<{ id: string; w: WorkspaceSummary; services: Array<ServiceStatus & { key: string }> }>) {
  const total = w.repos || 1;
  const totals = [
    { n: w.repos, label: w.repos === 1 ? "repo" : "repos" },
    { n: w.stacks, label: w.stacks === 1 ? "run mode" : "run modes" },
    { n: w.flows + (w.scripts ?? 0), label: w.flows + (w.scripts ?? 0) === 1 ? "script" : "scripts" },
  ];
  return (
    <span data-ui="project-sheet">
      <span aria-hidden className="flex items-center gap-2.5">
        <span data-ui="project-diamond" />
        <span data-ui="project-name" className="truncate">
          {w.name}
        </span>
      </span>
      <span id={id} data-ui="project-dossier">
        {w.description && (
          <span data-ui="project-about" className="line-clamp-3">
            {w.description}
          </span>
        )}
        {services.length > 0 ? (
          <span className="flex flex-wrap gap-x-1 gap-y-2">
            {services.map((s) => (
              <span key={s.key} title={`${s.id}: ${stateLabel(s.state)}`}>
                <ServiceStateMark state={s.state} label={false} text={`${s.id} ${stateLabel(s.state)}`} />
              </span>
            ))}
          </span>
        ) : (
          <span className="flex flex-col gap-1.5">
            {typeRows(w.repo_types).map((m) => (
              <span key={m.type} data-ui="project-type">
                <span className="truncate">{m.type}</span> <span>{m.count}</span>
                <i aria-hidden style={{ width: `${(m.count / total) * 100}%`, background: m.shade }} />
              </span>
            ))}
          </span>
        )}
        <span className="grid grid-cols-3 gap-2">
          {totals.map((t) => (
            <span key={t.label} className="flex flex-col">
              <span data-ui="project-total">{t.n}</span> <span data-ui="project-total-label">{t.label}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * One project as a poster (dev-plans/2026-11-28-project-posters §4): its picture fills the card, with
 * its number and state above and its name and shape below. Expanded by the fan, the picture draws up into
 * a band and the dossier opens below the name. The frame, cut corners, fades, glow and the opening are in
 * design/pieces.css (data-ui="project-card").
 */
function Card({ w, index, state, runs }: Readonly<{ w: WorkspaceSummary; index: number; state: ProjectState; runs?: RunStatus[] }>) {
  const dossier = useId();
  const services = (runs ?? []).filter((r) => r.workspace === w.id).flatMap((r) => r.services.map((s) => ({ ...s, key: `${r.stack}/${s.id}` })));
  return (
    <button type="button" data-ui="project-card" aria-label={`Project ${w.name}`} aria-describedby={dossier} title={`Open ${w.name}`} className="h-full w-full text-start">
      <span data-ui="project-card-in" className="flex min-h-44 flex-col justify-between">
        {/* First, so the fades of the two blocks after it can tell a picture from the initials. */}
        <Art name={w.name} url={w.poster_url} />
        <span data-ui="project-top" className="flex items-start justify-between gap-3 px-5 pb-8 pt-5">
          <span data-ui="project-kicker" className="min-w-0 truncate">
            PRJ_{String(index + 1).padStart(2, "0")}
            {w.root && <> // {w.root}</>}
          </span>
          {/* Beside the state, so the name below keeps one line at any width. */}
          <span className="flex shrink-0 items-center gap-2">
            <span data-ui="project-state" data-tone={state.tone}>
              {state.text}
            </span>
            {w.source === "example" && <span data-ui="project-tag">Example</span>}
          </span>
        </span>
        <span data-ui="project-foot" className="flex flex-col gap-2 px-5 pb-5 pt-12">
          <span className="flex items-center gap-2.5">
            <span data-ui="project-diamond" aria-hidden />
            <span data-ui="project-name" className="truncate">
              {w.name}
            </span>
          </span>
          <span data-ui="project-shape" className="truncate">
            {projectShape(w)}
          </span>
        </span>
        <Dossier id={dossier} w={w} services={services} />
      </span>
    </button>
  );
}

/** How much the cards may move: not at all with Effects off or reduced motion (the app's or the OS's). */
export function cardMotion(effects: "off" | "reduced" | "full", reduceMotion: boolean): CardMotion {
  if (effects === "off" || reduceMotion) return "still";
  return effects === "reduced" ? "reduced" : "full";
}

/**
 * The projects as a fan of cards (dev-plans/2026-11-28-project-posters): the one under the pointer or
 * with the keyboard's focus opens up, and a click on any card opens its project.
 */
export function WorkspaceCards({ items, runs, onSelect }: Readonly<{ items: WorkspaceSummary[]; runs?: RunStatus[]; onSelect: (id: string) => void }>) {
  const effects = useUi((u) => effectiveEffects(u.effects));
  const reduce = useUi((u) => u.reduceMotion) || prefersReducedMotion();
  const index = new Map(items.map((w, i) => [w.id, i]));
  return (
    <CardFan
      items={items}
      keyOf={(w) => w.id}
      label="Projects"
      motion={cardMotion(effects, reduce)}
      onOpen={(w) => onSelect(w.id)}
      renderItem={(w) => <Card w={w} index={index.get(w.id) ?? 0} state={projectState(w, runs)} runs={runs} />}
    />
  );
}
