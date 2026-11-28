import { describe, expect, it } from "vitest";

import { askText, runSummary, stepLabel, whereItRuns, type Script, type ScriptRun } from "./scripts";

const sync: Pick<Script, "repo" | "for_each" | "steps"> = { for_each: "repo", steps: [{ git: "fetch" }, { git: "checkout", branch: "dev" }, { git: "pull" }] };

describe("scripts in words", () => {
  it.each([
    [{ git: "fetch" } as const, "fetch"],
    [{ git: "checkout", branch: "dev" } as const, "checkout dev"],
    [{ run: "npm test" }, "npm test"],
  ])("labels %o as %s", (step, want) => {
    expect(stepLabel(step)).toBe(want);
  });

  it.each([
    ["one repo", { repo: "api", steps: [{ run: "npm test" }] }, "in api"],
    ["for each repo", sync, "in every repo"],
    ["git steps run everywhere", { steps: [{ git: "status" as const }] }, "in every repo"],
    ["a command once", { steps: [{ run: "make" }] }, "in the first repo"],
  ])("where: %s", (_, s, want) => {
    expect(whereItRuns(s)).toBe(want);
  });

  it("says what a script that changes files will do before it runs", () => {
    expect(askText(sync)).toBe("This runs fetch, then checkout dev, then pull in every repo. A repo with uncommitted changes is skipped, never reset.");
    expect(askText({ repo: "api", steps: [{ run: "npm run lint" }] })).toBe("This runs npm run lint in api.");
  });

  it("sums a run up as the server does", () => {
    const repo = (state: ScriptRun["repos"][number]["state"]) => ({ repo: "x", state, steps: [] });
    expect(runSummary({ repos: [repo("ok"), repo("ok"), repo("skipped"), repo("failed")] })).toBe("4 repos · 2 ok · 1 skipped · 1 failed");
    expect(runSummary({ repos: [repo("ok")] })).toBe("1 repo · 1 ok");
  });
});
