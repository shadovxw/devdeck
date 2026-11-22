import { HOME_GROUP, NAV, NAV_ITEMS, type NavItem } from "../../app/nav";
import type { OrbState } from "../../design/orb/model";
import { isProblem } from "../../lib/runs";
import type { RunStatus } from "../../lib/types";

/** One tile of the launch grid: a mono label and the pages it opens. */
export type LaunchTile = { label: string; pages: NavItem[] };

/**
 * The launch grid (dev-plans/2026-11-21-portfolio-look §8a): one tile per sidebar group with a
 * built page, in the sidebar's order, built from nav.ts so a new page shows up by itself. Home's
 * own group becomes "Overview", without Home itself. Sub-pages are left out: they are tabs of
 * the page that lists them.
 */
export function launchTiles(groups = NAV): LaunchTile[] {
  return groups
    .map((g) => ({
      label: g.name === HOME_GROUP ? "Overview" : g.name,
      pages: g.items.filter((i) => i.built && i.path !== "/"),
    }))
    .filter((t) => t.pages.length > 0);
}

/** How well a page matches what was typed: lower is better, undefined is no match. */
function rank(item: NavItem, q: string): number | undefined {
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
  if (label.includes(q)) return 2;
  if (item.group.toLowerCase().startsWith(q) || item.parent?.toLowerCase().startsWith(q)) return 3;
  if (item.empty && `${item.empty.headline} ${item.empty.text}`.toLowerCase().includes(q)) return 4;
  return undefined;
}

/**
 * The pages "Where to?" offers for what was typed: built pages only, Home left out (you are on
 * it), best match first, at most `limit`. Nothing typed, nothing offered.
 */
export function searchPages(query: string, items = NAV_ITEMS, limit = 7): NavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items
    .filter((i) => i.built && i.path !== "/")
    .map((item, order) => ({ item, order, r: rank(item, q) }))
    .filter((x): x is { item: NavItem; order: number; r: number } => x.r !== undefined)
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.item);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * What the launcher's orb does and the line under it. It "thinks" only while devdeck is really
 * working (a stack starting or stopping); otherwise it idles and the line says what runs.
 */
export function orbStatus(runs: RunStatus[] | undefined): { state: OrbState; text: string } {
  if (!runs) return { state: "idle", text: "Idle" };
  const busy = runs.find((r) => r.state === "starting" || r.state === "stopping");
  if (busy) return { state: "thinking", text: `Thinking · ${busy.state === "starting" ? "starting" : "stopping"} ${busy.stack}` };
  if (runs.length === 0) return { state: "idle", text: "Idle · Ready" };
  const problems = runs.reduce((n, r) => n + r.services.filter(isProblem).length, 0);
  if (problems > 0) return { state: "idle", text: `Idle · ${plural(problems, "service needs", "services need")} a look` };
  return { state: "idle", text: `Idle · ${plural(runs.length, "stack", "stacks")} running` };
}

/** The colour family of a group on the orb launcher: Work cyan, Run the accent, System the gradient's middle. */
export type LaunchTone = "work" | "run" | "system" | "data" | "automate";

const TONES: Record<string, LaunchTone> = { devdeck: "run", Work: "work", Run: "run", Data: "data", Automate: "automate", System: "system" };

/** One page on the orb launcher: where it sits on the ellipse (cos, sin of its angle) and which side it reads from. */
export type OrbitNode = { item: NavItem; tone: LaunchTone; cos: number; sin: number; side: "left" | "right" | "center" };

/** The arc the pages sit on, clockwise from the upper right (the design's -45° to 225°): the bottom stays free for the orb's line. */
export const ARC = { from: -45, to: 225 } as const;

/**
 * The orb launcher's pages (the "Home without sidebar" design): every built sidebar page but
 * Home, in the sidebar's order, spread evenly over the arc. Pages right of the orb read from
 * their left edge, pages left of it from their right edge, the rest are centred.
 */
export function orbitNodes(groups = NAV): OrbitNode[] {
  const pages = launchTiles(groups).flatMap((t) => t.pages);
  const step = pages.length > 1 ? (ARC.to - ARC.from) / (pages.length - 1) : 0;
  return pages.map((item, i) => {
    const a = ((ARC.from + step * i) * Math.PI) / 180;
    const cos = Math.round(Math.cos(a) * 1e4) / 1e4;
    const sin = Math.round(Math.sin(a) * 1e4) / 1e4;
    const side = cos > 0.2 ? "right" : cos < -0.2 ? "left" : "center";
    return { item, tone: TONES[item.group] ?? "run", cos, sin, side };
  });
}

/** The legend under the launcher: each group with pages on it, its tone and blurb (Home's own group is left out). */
export function launchLegend(groups = NAV): { name: string; tone: LaunchTone; blurb: string }[] {
  return groups
    .filter((g) => g.name !== HOME_GROUP && g.blurb && g.items.some((i) => i.built))
    .map((g) => ({ name: g.name, tone: TONES[g.name] ?? "run", blurb: g.blurb! }));
}
