import { isProblem } from "../../lib/runs";
import type { RunStatus, WorkspaceSummary } from "../../lib/types";

/** What a project card's state chip says, and its tone (dev-plans/2026-11-22-projects §4.1). */
export type ProjectState = { text: string; tone: "good" | "warning" | "critical" | "quiet" };

/**
 * Running first (with how many services are up), then problems in its files, then stopped.
 * A failed service is critical whatever else is true.
 */
export function projectState(w: Pick<WorkspaceSummary, "id" | "errors" | "warnings">, runs: RunStatus[] | undefined): ProjectState {
  const mine = (runs ?? []).filter((r) => r.workspace === w.id);
  const services = mine.flatMap((r) => r.services);
  if (services.some(isProblem)) {
    const n = services.filter(isProblem).length;
    return { text: `${n} failing`, tone: "critical" };
  }
  if (mine.length > 0) {
    const ready = services.filter((s) => s.state === "ready").length;
    return { text: `Running ${ready}/${services.length}`, tone: "good" };
  }
  const problems = w.errors + w.warnings;
  if (problems > 0) return { text: `${problems} ${problems === 1 ? "problem" : "problems"}`, tone: w.errors > 0 ? "critical" : "warning" };
  return { text: "Stopped", tone: "quiet" };
}

/**
 * The project's shape in a line: "4 repos · 3 run modes · 1 script". Parts with none are left out, but repos
 * always show. Scripts are the ones the project file declares and the flows, which become scripts.
 */
export function projectShape(w: Pick<WorkspaceSummary, "repos" | "stacks" | "flows" | "scripts">): string {
  const part = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const scripts = w.flows + (w.scripts ?? 0);
  return [part(w.repos, "repo", "repos"), w.stacks > 0 && part(w.stacks, "run mode", "run modes"), scripts > 0 && part(scripts, "script", "scripts")].filter(Boolean).join(" · ");
}
