import type { Tone } from "../design/StatusDot";
import { useDoctor, useRuns, useWorkspaces } from "../lib/queries";
import { isProblem } from "../lib/runs";
import type { DoctorReport, RunStatus, WorkspaceSummary } from "../lib/types";

/** What a sidebar row says about now: a dot, maybe a number, and the same in words. */
export type NavStatus = { tone: Tone; count?: number; text: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Stacks: how many run, green when all are ready, yellow while something starts, red on a problem. Nothing when none runs. */
export function stacksStatus(runs: RunStatus[] | undefined): NavStatus | undefined {
  if (!runs || runs.length === 0) return undefined;
  const troubled = runs.filter((r) => r.services.some(isProblem)).length;
  const settling = runs.some((r) => r.state === "starting" || r.services.some((s) => s.state !== "ready" && !isProblem(s) && s.state !== "stopped"));
  const tone: Tone = troubled > 0 ? "critical" : settling ? "warning" : "good";
  let text = `${runs.length} running`;
  if (troubled > 0) text += `, ${troubled} with a problem`;
  else if (settling) text += ", starting";
  return { tone, count: runs.length, text };
}

/** Health: red when Doctor found failures, yellow for warnings, nothing when all is well or not checked. */
export function healthStatus(report: DoctorReport | undefined): NavStatus | undefined {
  if (!report) return undefined;
  if (report.failures > 0) return { tone: "critical", text: `Doctor found ${plural(report.failures, "problem")}` };
  if (report.warnings > 0) return { tone: "warning", text: `Doctor found ${plural(report.warnings, "warning")}` };
  return undefined;
}

/** The workspace Doctor checks by default: the first without errors, else the first. Health and the sidebar agree on it. */
export function defaultDoctorWorkspace(list: WorkspaceSummary[]): string | undefined {
  return (list.find((w) => w.errors === 0) ?? list[0])?.id;
}

/** How often the sidebar re-checks Doctor in the background. */
export const HEALTH_EVERY = 15 * 60_000;

/** The status of each sidebar row that has one, by path. */
export function useNavStatus(): Record<string, NavStatus | undefined> {
  const runs = useRuns();
  const workspaces = useWorkspaces();
  const doctor = useDoctor(defaultDoctorWorkspace(workspaces.data ?? []), undefined, HEALTH_EVERY);
  return {
    "/stacks": stacksStatus(runs.data),
    "/doctor": healthStatus(doctor.data),
  };
}
