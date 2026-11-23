import { describe, expect, it } from "vitest";

import type { FeatureDetail, FeaturePr } from "../../lib/features";
import { githubUrl } from "./StateChip";
import { activityOf, claudePrompt, hasBranch, layerName, overBudget, stageOf, STAGES, STATE_LABEL, STATE_ORDER, STATE_TONE } from "./state";

const pr = (over: Partial<FeaturePr> = {}): FeaturePr => ({
  id: "a1", repo: "demo-api", slug: "x", title: "First", branch: "acme-a1-x", base: "acme", layers: [], steps: [], steps_done: 0, state: "planned", ...over,
});

const detail = (prs: FeaturePr[], over: Partial<FeatureDetail> = {}): FeatureDetail => ({
  workspace: "demo", name: "blob", branch: "plan/blob", title: "Move data", kind: "feature", repos: ["demo-api"], prs: prs.length, steps: 0, steps_done: 0, read_only: false,
  errors: 0, warnings: 0, budget: { files: 10, lines: 500 }, pr_list: prs, next_up: [], counts: {}, repo_layers: [], problems: [], files: [], tools: [], issues: [], ...over,
});

describe("states", () => {
  it("has a word and a colour for every state, and lists each once", () => {
    expect(new Set(STATE_ORDER).size).toBe(STATE_ORDER.length);
    for (const s of STATE_ORDER) {
      expect(STATE_LABEL[s], s).toBeTruthy();
      expect(STATE_TONE[s], s).toBeTruthy();
    }
  });

  it("places each state on the track, with changes requested still in review", () => {
    expect(STAGES).toHaveLength(6);
    expect(stageOf("planned")).toBe(0);
    expect(stageOf("waiting")).toBe(0);
    expect(stageOf("coding")).toBe(1);
    expect(stageOf("draft")).toBe(2);
    expect(stageOf("review")).toBe(3);
    expect(stageOf("changes")).toBe(3);
    expect(stageOf("approved")).toBe(4);
    expect(stageOf("merged")).toBe(5);
    expect(hasBranch("planned")).toBe(false);
    expect(hasBranch("waiting")).toBe(false);
    expect(hasBranch("coding")).toBe(true);
  });

  it("names a layer by its name, or its id when the workspace gives none", () => {
    expect(layerName([{ id: "db", name: "DB / migrations" }, { id: "model" }], "db")).toBe("DB / migrations");
    expect(layerName([{ id: "model" }], "model")).toBe("model");
    expect(layerName([], "x")).toBe("x");
  });
});

describe("the prompt for Claude", () => {
  it("names the PR to pick up, the plan, the branch and the budget, and asks it to stop after each step", () => {
    const d = detail([pr({ id: "a4", title: "Fourth", branch: "acme-a4-x", base: "acme-a3-x" })], { pick: "a4" });
    const text = claudePrompt(d) ?? "";
    expect(text).toContain('PR a4 ("Fourth", repo demo-api)');
    expect(text).toContain("plan/blob");
    expect(text).toContain("acme-a4-x, based on acme-a3-x");
    expect(text).toContain("under 10 files and 500 lines");
    expect(text).toContain("give me the git commands");
    expect(text).toContain("Don't run git commit or push yourself");
  });

  it("is nothing when no PR is waiting to be started", () => {
    expect(claudePrompt(detail([pr()]))).toBeUndefined();
  });
});

describe("the activity", () => {
  it("lists commits and merges, newest first, with where they came from", () => {
    const d = detail([
      pr({ id: "a1", state: "merged", github: { number: 7, title: "First", head: "h", base: "b", state: "merged", draft: false, url: "u", additions: 1, deletions: 1, changed_files: 1, merged_at: "2026-11-02T10:00:00Z" } }),
      pr({ id: "a2", local: { exists: true, pushed: false, commits: [{ hash: "abc1234", date: "2026-11-03T09:00:00Z", subject: "step two" }, { hash: "def5678", date: "2026-11-01T09:00:00Z", subject: "step one" }] } }),
    ]);
    expect(activityOf(d).map((a) => [a.source, a.pr, a.ref])).toEqual([
      ["git", "a2", "abc1234"],
      ["GitHub", "a1", "#7"],
      ["git", "a2", "def5678"],
    ]);
    expect(activityOf(detail([pr()]))).toEqual([]);
  });
});

describe("the size budget", () => {
  const budget = { files: 10, lines: 500 };
  it("says which budget a PR is over, in numbers", () => {
    expect(overBudget(pr({ size: { files: 12, added: 400, deleted: 150 }, over: ["lines", "files"] }), budget)).toBe("550 lines (budget 500), 12 files (budget 10)");
    expect(overBudget(pr({ size: { files: 3, added: 10, deleted: 0 } }), budget)).toBe("");
    expect(overBudget(pr(), budget)).toBe("");
  });
});

describe("links", () => {
  it("only links github.com addresses", () => {
    expect(githubUrl("https://github.com/acme/api/pull/7")).toBe("https://github.com/acme/api/pull/7");
    for (const bad of ["javascript:alert(1)", "http://github.com/x", "https://evil.example/github.com/", "//github.com/x", ""]) expect(githubUrl(bad), bad).toBeUndefined();
    expect(githubUrl(undefined)).toBeUndefined();
  });
});
