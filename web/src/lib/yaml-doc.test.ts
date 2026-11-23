import { describe, expect, it } from "vitest";

import { addRepo, formValues, idFromPath, markLocalOnly, outline, removeRepo, repoAtLine, repoIndexOfPath, sectionAtLine, setRepoField, setTopLevel, yamlErrors } from "./yaml-doc";

const sample = `# my workspace
version: 1
name: demo
root: ~/code

repos:
  # the api
  - id: api
    path: api
    type: go
  - id: infra
    path: infra # not a git repo
`;

describe("outline", () => {
  it("lists the top-level keys and the repos with their lines", () => {
    const o = outline(sample);
    expect(o.sections.map((s) => [s.key, s.line])).toEqual([
      ["version", 2],
      ["name", 3],
      ["root", 4],
      ["repos", 6],
    ]);
    expect(o.repos.map((r) => [r.id, r.path, r.type, r.from, r.to])).toEqual([
      ["api", "api", "go", 8, 10],
      ["infra", "infra", undefined, 11, 12],
    ]);
  });

  it("finds the repo and the section under a line", () => {
    const o = outline(sample);
    expect(repoAtLine(o, 9)?.id).toBe("api");
    expect(repoAtLine(o, 12)?.id).toBe("infra");
    expect(repoAtLine(o, 3)).toBeUndefined();
    expect(sectionAtLine(o, 9)?.key).toBe("repos");
    expect(sectionAtLine(o, 1)).toBeUndefined();
  });

  it("copes with text that is not a workspace", () => {
    expect(outline("")).toEqual({ sections: [], repos: [] });
    expect(outline("- just\n- a list\n")).toEqual({ sections: [], repos: [] });
    expect(outline("repos: nope\n").repos).toEqual([]);
  });
});

describe("edits keep the file as the user wrote it", () => {
  it("marks a repo local_only without touching comments or order", () => {
    const out = markLocalOnly(sample, 1);
    expect(out).toContain("# my workspace");
    expect(out).toContain("# the api");
    expect(out).toContain("path: infra # not a git repo");
    expect(out).toMatch(/- id: infra\n\s+path: infra # not a git repo\n\s+local_only: true\n/);
    expect(out.indexOf("name: demo")).toBeLessThan(out.indexOf("repos:"));
    expect(outline(out).repos[1].localOnly).toBe(true);
  });

  it("sets and clears a repo field", () => {
    const set = setRepoField(sample, 0, "type", "node");
    expect(outline(set).repos[0].type).toBe("node");
    const cleared = setRepoField(set, 0, "type", "");
    expect(outline(cleared).repos[0].type).toBeUndefined();
    expect(setRepoField(sample, 9, "type", "go")).toBe(sample);
  });

  it("sets a top-level value and removes it when empty", () => {
    expect(setTopLevel(sample, "name", "other")).toContain("name: other");
    expect(setTopLevel(sample, "description", "Hello")).toContain("description: Hello");
    expect(setTopLevel(sample, "root", "")).not.toContain("root:");
  });

  it("adds and removes repos", () => {
    const added = addRepo(sample, "services/Billing API");
    const repos = outline(added).repos;
    expect(repos.map((r) => r.id)).toEqual(["api", "infra", "billing-api"]);
    expect(repos[2].path).toBe("services/Billing API");
    expect(outline(removeRepo(added, 0)).repos.map((r) => r.id)).toEqual(["infra", "billing-api"]);
    expect(removeRepo(sample, 5)).toBe(sample);
    expect(outline(addRepo("version: 1\nname: x\n", "a")).repos.map((r) => r.id)).toEqual(["a"]);
  });
});

describe("formValues", () => {
  it("reads the plain fields", () => {
    const f = formValues(sample);
    expect(f).toMatchObject({ name: "demo", root: "~/code", description: "", ok: true });
    expect(f.repos).toHaveLength(2);
  });
  it("is empty, not thrown, for text that does not parse", () => {
    expect(formValues("name: [oops").ok).toBe(false);
    expect(formValues("").ok).toBe(false);
  });
});

describe("small helpers", () => {
  it("reads the repo index out of an issue path", () => {
    expect(repoIndexOfPath("/repos/1/path")).toBe(1);
    expect(repoIndexOfPath("/repos/12")).toBe(12);
    expect(repoIndexOfPath("/name")).toBeUndefined();
    expect(repoIndexOfPath(undefined)).toBeUndefined();
  });
  it("makes an id from a path", () => {
    expect(idFromPath("services/api")).toBe("api");
    expect(idFromPath("C:\\code\\My Repo")).toBe("my-repo");
    expect(idFromPath("")).toBe("");
  });
  it("reports syntax errors with a line", () => {
    expect(yamlErrors(sample)).toEqual([]);
    const errs = yamlErrors("name: demo\nrepos: [a\n");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].line).toBeGreaterThanOrEqual(2);
  });
});
