import { describe, expect, it } from "vitest";

import type { DoctorReport, RunStatus, ServiceStatus, WorkspaceSummary } from "../lib/types";
import { defaultDoctorWorkspace, healthStatus, stacksStatus } from "./nav-status";

const svc = (id: string, state: ServiceStatus["state"]): ServiceStatus => ({ id, kind: "command", state, restarts: 0 });
const run = (stack: string, services: ServiceStatus[], state: RunStatus["state"] = "running"): RunStatus => ({
  workspace: "acme",
  stack,
  state,
  started_at: "2026-11-22T10:00:00Z",
  services,
});

describe("stacksStatus", () => {
  it.each([
    ["nothing runs", [], undefined],
    ["all ready", [run("a", [svc("api", "ready")]), run("b", [svc("web", "ready")])], { tone: "good", count: 2, text: "2 running" }],
    ["one starting", [run("a", [svc("api", "starting")], "starting")], { tone: "warning", count: 1, text: "1 running, starting" }],
    ["one waiting for another", [run("a", [svc("api", "ready"), svc("web", "waiting")])], { tone: "warning", count: 1, text: "1 running, starting" }],
    ["a failed service", [run("a", [svc("api", "failed")], "degraded"), run("b", [svc("web", "ready")])], { tone: "critical", count: 2, text: "2 running, 1 with a problem" }],
    ["a problem wins over starting", [run("a", [svc("api", "restarting"), svc("web", "starting")])], { tone: "critical", count: 1, text: "1 running, 1 with a problem" }],
  ] as const)("%s", (_, runs, want) => {
    expect(stacksStatus(runs as unknown as RunStatus[])).toEqual(want);
  });

  it("says nothing before the list has loaded", () => {
    expect(stacksStatus(undefined)).toBeUndefined();
  });
});

describe("healthStatus", () => {
  const report = (failures: number, warnings: number): DoctorReport => ({ workspace: "acme", checks: [], passed: 5, warnings, failures, checked_at: "2026-11-22T10:00:00Z" });

  it.each([
    ["not checked", undefined, undefined],
    ["all passed", report(0, 0), undefined],
    ["warnings", report(0, 2), { tone: "warning", text: "Doctor found 2 warnings" }],
    ["one failure", report(1, 3), { tone: "critical", text: "Doctor found 1 problem" }],
  ] as const)("%s", (_, r, want) => {
    expect(healthStatus(r)).toEqual(want);
  });
});

describe("defaultDoctorWorkspace", () => {
  const ws = (id: string, errors: number) => ({ id, errors }) as WorkspaceSummary;
  it("is the first workspace without errors, else the first, else none", () => {
    expect(defaultDoctorWorkspace([ws("broken", 2), ws("good", 0)])).toBe("good");
    expect(defaultDoctorWorkspace([ws("broken", 2)])).toBe("broken");
    expect(defaultDoctorWorkspace([])).toBeUndefined();
  });
});
