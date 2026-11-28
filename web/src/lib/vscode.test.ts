import { describe, expect, it } from "vitest";

import { vscodeRepo } from "../pages/project/vscode-links";
import { fileCounts } from "./vscode";

describe("vscodeRepo", () => {
  it.each([
    ["C:\\code\\acme", "demo-api", "vscode://file/C:/code/acme/demo-api"],
    ["/home/me/acme/", "./demo-worker/", "vscode://file/home/me/acme/demo-worker"],
    ["/home/me/acme", ".", "vscode://file/home/me/acme"],
    ["/home/me/acme", "", "vscode://file/home/me/acme"],
    ["/home/me/my code", "demo api", "vscode://file/home/me/my%20code/demo%20api"],
  ])("%s + %s", (root, path, want) => {
    expect(vscodeRepo(root, path)).toBe(want);
  });
});

describe("fileCounts", () => {
  it("counts folders and tasks", () => {
    expect(fileCounts(JSON.stringify({ folders: [{}, {}], tasks: { version: "2.0.0", tasks: [{}, {}, {}] } }))).toEqual({ folders: 2, tasks: 3 });
  });
  it("is zero for text that isn't JSON", () => {
    expect(fileCounts("nope")).toEqual({ folders: 0, tasks: 0 });
  });
});
