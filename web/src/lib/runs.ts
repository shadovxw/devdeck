import type { RunStatus, ServiceStatus, StackDef } from "./types";

/** Where a run lives in lists: by workspace and stack. */
export const runKey = (workspace: string, stack: string) => `${workspace}/${stack}`;

/**
 * Applies one live update to the list of runs: it replaces that stack's entry,
 * or adds it, or drops it once the stack has stopped. The list stays sorted by
 * workspace then stack, as the server sends it.
 */
export function mergeRun(list: RunStatus[] | undefined, update: RunStatus): RunStatus[] {
  const key = runKey(update.workspace, update.stack);
  const rest = (list ?? []).filter((r) => runKey(r.workspace, r.stack) !== key);
  if (update.state === "stopped") return rest;
  return [...rest, update].sort((a, b) => runKey(a.workspace, a.stack).localeCompare(runKey(b.workspace, b.stack)));
}

/**
 * Orders a stack's services into columns: each column holds the services that
 * can start together once the ones in the columns before it are ready. Compose
 * dependencies, when there are any, are the first column. A service that waits
 * for something unknown is placed as if it didn't, so a bad file still shows.
 */
export function startOrder(stack: StackDef): string[][] {
  const services = stack.services ?? [];
  const columns: string[][] = [];

  // Compose files with an id are steps in the order, next to the services. Without
  // ids they are simply the first column: every service waits for them.
  const named = (stack.compose ?? []).some((c) => c.id);
  const ids = composeIds(stack);
  const steps: Array<{ id: string; after?: string[] }> = services.map((s) => ({ id: s.id, after: s.after }));
  if (named) {
    steps.unshift(...(stack.compose ?? []).map((c, i) => ({ id: ids[i], after: c.after })));
  } else if (ids.length > 0) {
    columns.push(ids);
  }

  const known = new Set(steps.map((s) => s.id));
  const placed = new Set<string>();
  while (placed.size < steps.length) {
    const column = steps.filter((s) => !placed.has(s.id) && (s.after ?? []).every((a) => placed.has(a) || !known.has(a)));
    // A loop can't be started; the server refuses it, but still show what is left.
    const next = column.length > 0 ? column : steps.filter((s) => !placed.has(s.id));
    for (const s of next) placed.add(s.id);
    columns.push(next.map((s) => s.id));
  }
  return columns;
}

export type Tally = { stacks: number; services: number; ready: number; problems: number };

/** Counts for the Home status strip. A problem is a service that failed, is blocked or keeps restarting. */
export function tally(runs: RunStatus[]): Tally {
  const t: Tally = { stacks: runs.length, services: 0, ready: 0, problems: 0 };
  for (const run of runs) {
    for (const s of run.services) {
      t.services++;
      if (s.state === "ready") t.ready++;
      if (isProblem(s)) t.problems++;
    }
  }
  return t;
}

export const isProblem = (s: ServiceStatus) => s.state === "failed" || s.state === "blocked" || s.state === "restarting";

/** "2m 14s": how long something has been up. */
export function formatUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * The ids devdeck gives a stack's compose files in a run: "compose" for one
 * file, "compose-<repo>" for each when there are several (a second file of the
 * same repo gets its position added). Mirrors the server, which names them.
 */
export function composeIds(stack: StackDef): string[] {
  const files = stack.compose ?? [];
  if (files.length === 0) return [];
  if (files.length === 1 && !files[0].id) return ["compose"];
  const used = new Set<string>();
  return files.map((c, i) => {
    if (c.id) {
      used.add(c.id);
      return c.id;
    }
    let id = `compose-${c.repo}`;
    if (used.has(id)) id += `-${i + 1}`;
    used.add(id);
    return id;
  });
}

export const isComposeId = (id: string) => id === "compose" || id.startsWith("compose-");

/** What to call a service of a run: a stack's compose files are its "Dependencies". */
export function serviceLabel(id: string): string {
  if (id === "compose") return "Dependencies";
  return id.startsWith("compose-") ? `Dependencies · ${id.slice("compose-".length)}` : id;
}
