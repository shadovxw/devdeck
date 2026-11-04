import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  local?: { exists: boolean; pushed: boolean; commits?: Commit[]; base_missing?: boolean };
  github?: GithubPr;
  size?: DiffSize;
  /** "files" and/or "lines": which budget the PR is over. */
  over?: string[];
};

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
  issues: Issue[];
};

export const featureKeys = {
  list: ["features"] as const,
  one: (ws: string, name: string) => ["features", ws, name] as const,
  text: (ws: string, name: string) => ["features", ws, name, "status"] as const,
  file: (ws: string, name: string, path: string) => ["features", ws, name, "file", path] as const,
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
