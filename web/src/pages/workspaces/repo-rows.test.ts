import { describe, expect, it } from "vitest";

import type { GitRepo } from "../../lib/git";
import type { Repo } from "../../lib/types";
import { typeMix } from "./WorkspaceCards";
import { filterRows, gitLabel, noFilter, repoRows, sharedPrefix } from "./repo-rows";

const work = (over: Partial<NonNullable<GitRepo["work"]>> = {}) => ({ branch: "main", detached: false, upstream: "origin/main", ahead: 0, behind: 0, changed: 0, ...over });
const git = (repo: string, w?: GitRepo["work"]): GitRepo => ({
  workspace: "demo",
  workspace_name: "demo",
  repo,
  path: `/code/${repo}`,
  remote: "",
  expected: { name: "", email: "" },
  actual: { name: "", email: "" },
  state: "ok",
  work: w,
});

describe("sharedPrefix", () => {
  it.each([
    [["acme-api", "acme-web", "acme-docs", "portal"], "acme-"],
    [["acme-api", "acme-web"], ""], // too few to call it a prefix
    [["api", "web", "docs"], ""],
    [["a-x", "b-x", "c-x", "d-x"], ""], // no prefix more than half share
    [[], ""],
  ])("%j → %j", (ids, want) => {
    expect(sharedPrefix(ids)).toBe(want);
  });
});

describe("gitLabel", () => {
  it.each([
    [undefined, "no .git", "none"],
    [git("a"), "no .git", "none"],
    [git("a", work()), "clean", "clean"],
    [git("a", work({ changed: 3 })), "3 changed", "dirty"],
    [git("a", work({ ahead: 2 })), "↑2", "plain"],
    [git("a", work({ ahead: 1, behind: 4 })), "↑1 ↓4", "plain"],
    [git("a", work({ changed: 1, behind: 4 })), "1 changed", "dirty"], // changes come first
  ])("%#", (row, text, tone) => {
    expect(gitLabel(row)).toEqual({ text, tone });
  });
});

describe("repoRows and filterRows", () => {
  const repos: Repo[] = [
    { id: "api", path: "services/api", type: "go" },
    { id: "web", path: "web", type: "node" },
    { id: "infra", path: "infra", local_only: true },
  ];
  const rows = repoRows(repos, [git("api", work({ changed: 2 })), git("web", work({ behind: 1 }))]);

  it("joins the file's repos with git by id, and calls an untyped repo other", () => {
    expect(rows.map((r) => [r.repo.id, r.type, r.git?.repo])).toEqual([
      ["api", "go", "api"],
      ["web", "node", "web"],
      ["infra", "other", undefined],
    ]);
  });

  it("filters by text in the id or the folder, by type, and by the toggles", () => {
    const ids = (f: Partial<typeof noFilter>) => filterRows(rows, { ...noFilter, ...f }).map((r) => r.repo.id);
    expect(ids({})).toEqual(["api", "web", "infra"]);
    expect(ids({ text: "  WE " })).toEqual(["web"]);
    expect(ids({ text: "services" })).toEqual(["api"]);
    expect(ids({ types: ["go", "other"] })).toEqual(["api", "infra"]);
    expect(ids({ changed: true })).toEqual(["api"]);
    expect(ids({ behind: true })).toEqual(["web"]);
    expect(ids({ changed: true, behind: true })).toEqual([]);
  });
});

describe("typeMix", () => {
  it("orders by count, then name, and gives the first three types their own shade", () => {
    const mix = typeMix({ node: 3, go: 10, other: 2, docker: 5, a: 1 });
    expect(mix.map((m) => `${m.type} ${m.count}`)).toEqual(["go 10", "docker 5", "node 3", "other 2", "a 1"]);
    expect(new Set(mix.slice(0, 4).map((m) => m.shade)).size).toBe(4);
    expect(mix[4].shade).toBe(mix[3].shade); // the rest share the lightest
    expect(typeMix(undefined)).toEqual([]);
  });
});
