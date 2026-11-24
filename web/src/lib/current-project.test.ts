import { afterEach, describe, expect, it } from "vitest";

import { pickProject, useCurrentProject } from "./current-project";

afterEach(() => {
  localStorage.clear();
  useCurrentProject.setState({ id: null });
});

describe("pickProject", () => {
  const ids = ["acme", "demo"];
  it.each([
    ["the address wins", "demo", "acme", "acme", "demo"],
    ["then the current project", null, "demo", "acme", "demo"],
    ["a current project that is gone is ignored", null, "deleted", "acme", "acme"],
    ["nothing current: the page's default", null, null, "acme", "acme"],
    ["no projects at all", null, null, undefined, undefined],
  ] as const)("%s", (_, asked, current, fallback, want) => {
    expect(pickProject(asked, current, [...ids], fallback)).toBe(want);
  });
});

describe("the current project", () => {
  it("is kept in this browser", () => {
    useCurrentProject.getState().set("acme");
    expect(useCurrentProject.getState().id).toBe("acme");
    expect(localStorage.getItem("devdeck.project")).toBe("acme");
  });
});
