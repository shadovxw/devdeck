import { describe, expect, it } from "vitest";

import type { LogEntry } from "../../lib/types";
import { linesInLastMinute, liveLabel, statusLine } from "./status";

const base = { state: "ready", count: 1, paused: false, live: true } as const;

describe("statusLine", () => {
  it.each([
    [{ ...base, state: "loading" }, "Loading…"],
    [{ ...base, state: "error", error: "boom" }, "boom"],
    [{ ...base, state: "error" }, "Could not load the logs."],
    [base, "1 line"],
    [{ ...base, count: 1500 }, "1,500 lines"],
    [{ ...base, count: 3, muted: 2200, paused: true }, "3 lines · 2,200 muted · paused"],
    [{ ...base, count: 0, live: false }, "0 lines · a past stretch"],
  ] as const)("%j is %s", (input, want) => {
    expect(statusLine(input)).toBe(want);
  });
});

describe("liveLabel and linesInLastMinute", () => {
  it("names what the view is doing", () => {
    expect([liveLabel(true, false), liveLabel(true, true), liveLabel(false, true)]).toEqual(["Live", "Paused", "Past stretch"]);
  });

  it("counts only the lines from the last minute", () => {
    const line = (time: string): LogEntry => ({ seq: 1, time, workspace: "demo", stack: "full", service: "api", stream: "stdout", text: "x" });
    const now = Date.parse("2026-11-01T10:01:00Z");
    expect(linesInLastMinute([line("2026-11-01T10:00:30Z"), line("2026-11-01T10:00:00Z"), line("2026-11-01T09:00:00Z")], now)).toBe(1);
  });
});
