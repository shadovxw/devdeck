import { describe, expect, it } from "vitest";

import type { RunStatus, ServiceStatus } from "../../lib/types";
import { projectShape, projectState } from "./project-state";

const svc = (id: string, state: ServiceStatus["state"]): ServiceStatus => ({ id, kind: "command", state, restarts: 0 });
const run = (workspace: string, services: ServiceStatus[]): RunStatus => ({ workspace, stack: "full", state: "running", started_at: "", services });
const w = { id: "acme", errors: 0, warnings: 0 };

describe("projectState", () => {
  it.each([
    ["nothing loaded", w, undefined, { text: "Stopped", tone: "quiet" }],
    ["stopped", w, [], { text: "Stopped", tone: "quiet" }],
    ["running, all ready", w, [run("acme", [svc("api", "ready"), svc("web", "ready")])], { text: "Running 2/2", tone: "good" }],
    ["running, one still starting", w, [run("acme", [svc("api", "ready"), svc("web", "starting")])], { text: "Running 1/2", tone: "good" }],
    ["a failed service wins", { ...w, warnings: 3 }, [run("acme", [svc("api", "failed")])], { text: "1 failing", tone: "critical" }],
    ["another project's run doesn't count", w, [run("other", [svc("api", "ready")])], { text: "Stopped", tone: "quiet" }],
    ["warnings in its files", { ...w, warnings: 2 }, [], { text: "2 problems", tone: "warning" }],
    ["an error in its files", { ...w, errors: 1 }, [], { text: "1 problem", tone: "critical" }],
  ] as const)("%s", (_, ws, runs, want) => {
    expect(projectState(ws, runs as RunStatus[] | undefined)).toEqual(want);
  });
});

describe("projectShape", () => {
  it.each([
    [{ repos: 1, stacks: 0, flows: 0 }, "1 repo"],
    [{ repos: 4, stacks: 3, flows: 0 }, "4 repos · 3 run modes"],
    [{ repos: 4, stacks: 1, flows: 2 }, "4 repos · 1 run mode · 2 scripts"],
  ])("%o → %s", (shape, want) => {
    expect(projectShape(shape)).toBe(want);
  });
});
