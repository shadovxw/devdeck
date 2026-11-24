import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

/** A step of a script: a git step (fetch, pull, checkout, status) or a command run in the repo. */
export type ScriptStep = { git?: "fetch" | "pull" | "checkout" | "status"; branch?: string; run?: string };

export type ScriptSource = "built-in" | "file" | "package.json" | "Makefile";

/** A step's, a repo's or a run's state. */
export type RunState = "waiting" | "running" | "ok" | "skipped" | "failed";

export type ScriptRun = {
  id: string;
  workspace: string;
  script: string;
  title: string;
  state: RunState;
  started_at: string;
  finished_at?: string;
  repos: Array<{ repo: string; state: RunState; reason?: string; steps: Array<{ label: string; state: RunState; output?: string }> }>;
};

/** A project's script as the Scripts tab lists it (GET /workspaces/:id/scripts). */
export type Script = {
  id: string;
  title?: string;
  for_each?: "repo";
  repo?: string;
  steps: ScriptStep[];
  source: ScriptSource;
  /** It can change files, so it asks before it runs. */
  writes: boolean;
  last?: ScriptRun;
};

/** A step in a few words: "fetch", "checkout dev", "npm test" (as the server says it). */
export function stepLabel(s: ScriptStep): string {
  if (s.git === "checkout") return `checkout ${s.branch ?? ""}`.trim();
  return s.git ?? s.run ?? "";
}

/** Where a script runs, in words: "in api", "in every repo". */
export function whereItRuns(s: Pick<Script, "repo" | "for_each" | "steps">): string {
  if (s.repo) return `in ${s.repo}`;
  if (s.for_each === "repo" || s.steps.every((st) => st.git)) return "in every repo";
  return "in the first repo";
}

/**
 * What the run sheet says before a script that changes files runs (dev-plans/2026-11-22-projects
 * §4.4): what it does, where, and that a repo with uncommitted changes is left alone.
 */
export function askText(s: Pick<Script, "repo" | "for_each" | "steps">): string {
  const steps = s.steps.map(stepLabel).join(", then ");
  const git = s.steps.some((st) => st.git === "checkout" || st.git === "pull");
  return `This runs ${steps} ${whereItRuns(s)}.${git ? " A repo with uncommitted changes is skipped, never reset." : ""}`;
}

/** The run in a line, as the server says it: "3 repos · 2 ok · 1 skipped". */
export function runSummary(run: Pick<ScriptRun, "repos">): string {
  const n = run.repos.length;
  const count = (st: RunState) => run.repos.filter((r) => r.state === st).length;
  const parts = [`${n} ${n === 1 ? "repo" : "repos"}`];
  for (const st of ["ok", "skipped", "failed"] as const) if (count(st) > 0) parts.push(`${count(st)} ${st}`);
  return parts.join(" · ");
}

const keys = {
  list: (workspace: string) => ["scripts", workspace] as const,
  run: (id: string) => ["script-run", id] as const,
};

export function useScripts(workspace: string) {
  return useQuery({
    queryKey: keys.list(workspace),
    queryFn: ({ signal }) => api.get<Script[]>(`/workspaces/${encodeURIComponent(workspace)}/scripts`, signal),
  });
}

/** Starts a script. A script that changes files needs confirm: true. */
export function useRunScript(workspace: string) {
  return useMutation({
    mutationFn: (v: { script: string; confirm: boolean }) =>
      api.post<ScriptRun>(`/workspaces/${encodeURIComponent(workspace)}/scripts/${encodeURIComponent(v.script)}/run`, { confirm: v.confirm }),
  });
}

/** A run as it stands, asked again every half second while it runs; the list refreshes when it ends. */
export function useScriptRun(id: string | undefined, workspace: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.run(id ?? ""),
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const run = await api.get<ScriptRun>(`/script-runs/${encodeURIComponent(id ?? "")}`, signal);
      if (run.state !== "running") void qc.invalidateQueries({ queryKey: keys.list(workspace) });
      return run;
    },
    refetchInterval: (q) => (q.state.data?.state === "running" ? 500 : false),
  });
}
