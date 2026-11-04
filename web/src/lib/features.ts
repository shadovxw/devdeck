import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { api, ApiError } from "./api";
import type { Issue } from "./types";

/** The states a PR can be in. They are worked out from git and GitHub; nobody types them. */
export type PrState = "planned" | "waiting" | "coding" | "draft" | "review" | "changes" | "approved" | "merged" | "closed";

/** One feature in the list: read from its feature.yaml alone, with no call to GitHub. */
export type FeatureSummary = {
  workspace: string;
  name: string;
  /** The plan's branch, plan/<name>. */
  branch: string;
  title?: string;
  kind: "feature" | "fix" | "task" | "spike";
  /** The feature branch the PRs are cut from. */
  feature?: string;
  base?: string;
  repos: string[];
  prs: number;
  steps: number;
  steps_done: number;
  worktree?: string;
  read_only: boolean;
  errors: number;
  warnings: number;
};

export type FeatureList = {
  features: FeatureSummary[];
  /** Workspaces whose plans repository couldn't be read. */
  problems: { workspace: string; message: string }[];
  /** The user's workspaces with no plans_repo. */
  no_plans_repo: string[];
};

export type FeatureStep = { title: string; layers?: string[]; status?: "todo" | "doing" | "done"; commit?: string };

export type PrCheck = { name: string; state: "pass" | "fail" | "pending" };

export type GithubPr = {
  number: number;
  title: string;
  head: string;
  base: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  decision?: "approved" | "changes_requested" | "review_required";
  url: string;
  additions: number;
  deletions: number;
  changed_files: number;
  merged_at?: string;
  updated_at?: string;
  checks?: PrCheck[];
};

export type Commit = { hash: string; date: string; subject: string };

export type DiffSize = { files: number; added: number; deleted: number };

export type FeaturePr = {
  id: string;
  repo: string;
  slug: string;
  title: string;
  branch: string;
  base: string;
  /** The PR below this one in the same repo. */
  below?: string;
  after?: string[];
  layers: string[];
  steps: FeatureStep[];
  steps_done: number;
  state: PrState;
  next?: { text: string; who: "claude" | "you" | "reviewers" };
  local?: { exists: boolean; pushed: boolean; head?: string; commits?: Commit[]; base_missing?: boolean };
  github?: GithubPr;
  size?: DiffSize;
  /** "files" and/or "lines": which budget the PR is over. */
  over?: string[];
  /** The last result of each review tool on this PR, by tool id. */
  reviews?: Record<string, ReviewView>;
};

export type ReviewStatus = "pass" | "warn" | "fail" | "error" | "skip";

/** What a review tool said last time, read from the plan's reviews/ folder. */
export type ReviewView = {
  status: ReviewStatus;
  summary: string;
  ran: string;
  commit?: string;
  /** The branch has moved on since this ran. */
  stale: boolean;
  /** Where the result is inside the plan. */
  file: string;
};

export type ToolInfo = {
  id: string;
  name: string;
  about: string;
  programs: { name: string; found: boolean; hint?: string }[];
  /** False when none of its programs is installed here. */
  usable: boolean;
};

export type RunState = "queued" | "running" | "done" | "cancelled";

/** One run of a tool on a PR's branch. Runs live in memory on the server; the result file is the record. */
export type ReviewRun = {
  id: string;
  workspace: string;
  feature: string;
  pr: string;
  repo: string;
  tool: string;
  state: RunState;
  status?: ReviewStatus;
  summary?: string;
  commit?: string;
  file?: string;
  queued: string;
  started?: string;
  finished?: string;
};

export type ReviewStarted = { started: ReviewRun[]; skipped: { pr: string; tool?: string; reason: string }[] };

export type Layer = { id: string; name?: string; paths?: string[] };

export type FeatureDetail = FeatureSummary & {
  budget: { files: number; lines: number };
  pr_list: FeaturePr[];
  next_up: { pr: string; text: string; who: string }[];
  /** The PR to hand Claude next. */
  pick?: string;
  counts: Partial<Record<PrState, number>>;
  repo_layers: { id: string; layers: Layer[] }[];
  /** What kept some of the live state from being read; the rest is still shown. */
  problems: string[];
  files: string[];
  /** The review tools, and whether their programs are installed here. */
  tools: ToolInfo[];
  issues: Issue[];
};

export const featureKeys = {
  list: ["features"] as const,
  one: (ws: string, name: string) => ["features", ws, name] as const,
  text: (ws: string, name: string) => ["features", ws, name, "status"] as const,
  file: (ws: string, name: string, path: string) => ["features", ws, name, "file", path] as const,
  runs: (ws: string, name: string) => ["features", ws, name, "runs"] as const,
};

const root = (ws: string, name: string) => `/features/${encodeURIComponent(ws)}/${encodeURIComponent(name)}`;

export function useFeatures() {
  return useQuery({
    queryKey: featureKeys.list,
    queryFn: ({ signal }) => api.get<FeatureList>("/features", signal),
  });
}

/** One feature with the live state of its PRs. GitHub's answer is kept for a minute on the server. */
export function useFeature(ws: string, name: string) {
  return useQuery({
    queryKey: featureKeys.one(ws, name),
    queryFn: ({ signal }) => api.get<FeatureDetail>(root(ws, name), signal),
    refetchInterval: 60_000,
  });
}

/** Asks GitHub again now (the server otherwise reuses its answer for a minute) and puts the result in place. */
export function useRefreshFeature(ws: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.get<FeatureDetail>(`${root(ws, name)}?refresh=1`),
    onSuccess: (d) => {
      qc.setQueryData(featureKeys.one(ws, name), d);
      void qc.invalidateQueries({ queryKey: featureKeys.text(ws, name) });
    },
  });
}

/** GET a path that answers with text, not JSON. */
async function getText(path: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch("/api/v1" + path, { signal });
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: unknown };
      if (typeof body.message === "string") message = body.message;
    } catch {
      // not JSON; keep the status text
    }
    throw new ApiError(res.status, message);
  }
  return res.text();
}

/** The feature as the text `devdeck feature status` prints. */
export function useFeatureText(ws: string, name: string, enabled: boolean) {
  return useQuery({
    queryKey: featureKeys.text(ws, name),
    queryFn: ({ signal }) => getText(`${root(ws, name)}/status`, signal),
    enabled,
  });
}

/** One file of the plan (plan.md, changes.md, a review) as text. */
export function useFeatureFile(ws: string, name: string, path: string | undefined) {
  return useQuery({
    queryKey: featureKeys.file(ws, name, path ?? ""),
    queryFn: ({ signal }) =>
      api.get<{ path: string; text: string }>(`${root(ws, name)}/files/${(path ?? "").split("/").map(encodeURIComponent).join("/")}`, signal),
    enabled: Boolean(path),
  });
}

const isActive = (r: ReviewRun) => r.state === "queued" || r.state === "running";

/** The runs of this feature. Asked once a second while any is waiting or running, and once more when the last one ends, so the saved results show. */
export function useReviewRuns(ws: string, name: string) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: featureKeys.runs(ws, name),
    queryFn: ({ signal }) => api.get<{ runs: ReviewRun[] }>(`${root(ws, name)}/reviews`, signal),
    refetchInterval: (q) => (q.state.data?.runs.some(isActive) ? 1000 : false),
  });
  const active = query.data?.runs.filter(isActive).length ?? 0;
  const seen = useRef(0);
  useEffect(() => {
    // Fewer active runs than a moment ago: one ended, and its result file is new.
    if (active < seen.current) void qc.invalidateQueries({ queryKey: featureKeys.one(ws, name) });
    seen.current = active;
  }, [active, qc, ws, name]);
  return query;
}

/** Starts review tools: one tool on one PR, or (with nothing given) every installed tool on every PR that has a branch. */
export function useStartReviews(ws: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { pr?: string; tool?: string }) => api.post<ReviewStarted>(`${root(ws, name)}/reviews`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKeys.runs(ws, name) }),
  });
}

export function useCancelRun(ws: string, name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`${root(ws, name)}/reviews/${encodeURIComponent(id)}/cancel`),
    onSuccess: () => qc.invalidateQueries({ queryKey: featureKeys.runs(ws, name) }),
  });
}

/** What the page needs to run reviews and follow them. */
export type ReviewControls = {
  runs: ReviewRun[];
  /** Starts a tool on a PR; with no tool, every tool on that PR; with neither, everything. */
  start: (pr?: string, tool?: string) => void;
  cancel: (id: string) => void;
  /** True while a request to start is on its way. */
  starting: boolean;
  /** What the server said when it refused, or what was started and skipped last time. */
  message?: string;
  /** Opens a file of the plan in the Files tab. */
  openFile: (path: string) => void;
};

/** The run that is waiting or running for a tool on a PR, if there is one. */
export const activeRun = (runs: ReviewRun[], pr: string, tool: string) => runs.find((r) => r.pr === pr && r.tool === tool && isActive(r));

/** What happened when reviews were started, in a sentence. */
export function describeStart(r: ReviewStarted): string {
  const started = `Started ${r.started.length} ${r.started.length === 1 ? "run" : "runs"}.`;
  if (r.skipped.length === 0) return started;
  const why = r.skipped.map((s) => `${[s.pr, s.tool].filter(Boolean).join(" ")}: ${s.reason}`).join("; ");
  return `${started} Skipped ${r.skipped.length}: ${why}.`;
}

/** The runs of a feature, with what starts and stops them, for the page to share between its parts. */
export function useReviews(ws: string, name: string, openFile: (path: string) => void): ReviewControls {
  const runs = useReviewRuns(ws, name);
  const start = useStartReviews(ws, name);
  const cancel = useCancelRun(ws, name);
  const [message, setMessage] = useState<string>();
  return {
    runs: runs.data?.runs ?? [],
    start: (pr, tool) =>
      start.mutate(
        { pr, tool },
        {
          onSuccess: (r) => setMessage(describeStart(r)),
          onError: (e) => setMessage(e instanceof ApiError ? e.message : "The review couldn’t be started."),
        },
      ),
    cancel: (id) => cancel.mutate(id),
    starting: start.isPending,
    message,
    openFile,
  };
}
