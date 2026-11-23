import type { Tone } from "../../design/StatusDot";
import type { Commit, FeatureDetail, FeaturePr, Layer, PrState } from "../../lib/features";

/** The words for each state. */
export const STATE_LABEL: Record<PrState, string> = {
  planned: "Planned",
  waiting: "Waiting",
  coding: "Coding",
  draft: "Draft",
  review: "In review",
  changes: "Changes requested",
  approved: "Approved",
  merged: "Merged",
  closed: "Closed",
};

/** The dot colour for each state (merged and approved are the good ones; a request for changes is the one that needs someone). */
export const STATE_TONE: Record<PrState, Tone> = {
  planned: "neutral",
  waiting: "neutral",
  coding: "serious",
  draft: "warning",
  review: "primary",
  changes: "critical",
  approved: "good",
  merged: "good",
  closed: "neutral",
};

/** The order the counts are listed in. */
export const STATE_ORDER: PrState[] = ["merged", "approved", "review", "changes", "draft", "coding", "waiting", "planned", "closed"];

/** A state with no branch behind it yet. */
export const hasBranch = (s: PrState) => s !== "planned" && s !== "waiting";

/** The five stages a PR passes through, for the track in the PR panel. */
export const STAGES = ["Planned", "Coding", "Draft", "Review", "Approved", "Merged"] as const;

/** How far along the track a state is (the index in STAGES). Closed and waiting stay at the start. */
export function stageOf(state: PrState): number {
  switch (state) {
    case "coding":
      return 1;
    case "draft":
      return 2;
    case "review":
    case "changes":
      return 3;
    case "approved":
      return 4;
    case "merged":
      return 5;
    default:
      return 0;
  }
}

/** A layer's name: the one the workspace gives it, or its id. */
export const layerName = (layers: Layer[], id: string) => layers.find((l) => l.id === id)?.name || id;

/** The prompt that tells Claude Code which PR of a feature to pick up next. It stops after each step, as the owner works. */
export function claudePrompt(d: FeatureDetail): string | undefined {
  const pr = d.pr_list.find((p) => p.id === d.pick);
  if (!pr) return undefined;
  const name = d.title || d.name;
  return [
    `Pick up PR ${pr.id} ("${pr.title}", repo ${pr.repo}) of the feature "${name}". The plan is the branch ${d.branch} of the plans repository.`,
    `Read plan.md and feature.yaml there first. Then do the PR one step at a time: make the change, run its tests, add the step's entry to changes.md and mark the step done in feature.yaml.`,
    `The branch is ${pr.branch}, based on ${pr.base}. Keep the PR under ${d.budget.files} files and ${d.budget.lines} lines.`,
    `After each step stop and give me the git commands to run. Don't run git commit or push yourself.`,
  ].join("\n\n");
}

/** One line of the Activity tab. */
export type ActivityItem = {
  at: string;
  /** Where it comes from. */
  source: "git" | "GitHub";
  pr: string;
  repo: string;
  text: string;
  /** A short id to show beside it: a commit hash or a PR number. */
  ref: string;
};

/** What happened across a feature, newest first: the commits on each PR's branch, and the PRs that merged. */
export function activityOf(d: FeatureDetail): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const pr of d.pr_list) {
    for (const c of pr.local?.commits ?? []) items.push(commitItem(pr, c));
    if (pr.github?.merged_at) {
      items.push({ at: pr.github.merged_at, source: "GitHub", pr: pr.id, repo: pr.repo, text: `Pull request merged: ${pr.github.title}`, ref: `#${pr.github.number}` });
    }
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

function commitItem(pr: FeaturePr, c: Commit): ActivityItem {
  return { at: c.date, source: "git", pr: pr.id, repo: pr.repo, text: c.subject, ref: c.hash };
}

/** How far over its budget a PR is, in words, or "" when it is within it. */
export function overBudget(pr: FeaturePr, budget: FeatureDetail["budget"]): string {
  if (!pr.size || !pr.over?.length) return "";
  const parts: string[] = [];
  if (pr.over.includes("lines")) parts.push(`${pr.size.added + pr.size.deleted} lines (budget ${budget.lines})`);
  if (pr.over.includes("files")) parts.push(`${pr.size.files} files (budget ${budget.files})`);
  return parts.join(", ");
}
