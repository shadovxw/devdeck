import { describe, expect, it } from "vitest";

import { defaultMode } from "../pages/project/ProjectHeader";
import { conversionSummary, type Conversion } from "./convert";
import type { RunStatus } from "./types";
import { fileNameOf } from "./workspace-file";

const conv = (modes: number, databases: number): Conversion => ({ yaml: "", modes: Array.from({ length: modes }, (_, i) => `stacks/m${i}.yaml`), databases, issues: [] });

describe("conversionSummary", () => {
  it.each([
    [conv(1, 0), "1 run mode goes inline"],
    [conv(3, 1), "3 run modes go inline · 1 database"],
    [conv(0, 2), "0 run modes go inline · 2 databases"],
  ])("%#", (c, want) => {
    expect(conversionSummary(c)).toBe(want);
  });
});

describe("fileNameOf", () => {
  it("names the project's file by its kind", () => {
    expect(fileNameOf("project")).toBe("project.yaml");
    expect(fileNameOf("workspace")).toBe("workspace.yaml");
    expect(fileNameOf(undefined)).toBe("workspace.yaml");
  });
});

describe("defaultMode", () => {
  const running: RunStatus[] = [{ workspace: "acme", stack: "api-only", state: "running", started_at: "", services: [] }];
  it.each<[string[], RunStatus[], string | undefined, string]>([
    [["full", "api-only"], [], undefined, "full"],
    [["full", "api-only"], [], "api-only", "api-only"],
    [["full", "api-only"], [], "gone", "full"],
    [["full", "api-only"], running, "full", "api-only"],
  ])("%j, file says %s", (stacks, runs, preferred, want) => {
    expect(defaultMode(stacks, runs, preferred)).toBe(want);
  });
});
