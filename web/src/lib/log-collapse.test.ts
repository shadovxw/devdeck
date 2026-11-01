import { describe, expect, it } from "vitest";

import { collapseRepeats, plainRows } from "./log-collapse";
import type { LogEntry } from "./types";

const line = (seq: number, service: string, text: string, level: LogEntry["level"] = "info"): LogEntry => ({ seq, time: "2026-10-31T10:00:00Z", workspace: "demo", stack: "full", service, stream: "stdout", text, level });

describe("collapseRepeats", () => {
  it("folds neighbouring repeats into the first line with a count", () => {
    const rows = collapseRepeats([line(1, "api", "tick"), line(2, "api", "tick"), line(3, "api", "tick"), line(4, "api", "done")]);
    expect(rows.map((r) => [r.entry.seq, r.repeat])).toEqual([[1, 3], [4, 1]]);
  });

  it("does not fold lines that differ in service or level, or repeats that are not neighbours", () => {
    const rows = collapseRepeats([line(1, "api", "tick"), line(2, "web", "tick"), line(3, "web", "tick", "error"), line(4, "api", "tick"), line(5, "web", "tick", "error")]);
    expect(rows.map((r) => r.repeat)).toEqual([1, 1, 1, 1, 1]);
  });

  it("treats a line with no level as info, and ignores fields", () => {
    const a = { ...line(1, "api", "x"), level: undefined, fields: { n: 1 } };
    const b = { ...line(2, "api", "x"), fields: { n: 2 } };
    expect(collapseRepeats([a, b]).map((r) => r.repeat)).toEqual([2]);
  });

  it("folds lines with the same error fingerprint even when their text differs", () => {
    const a = { ...line(1, "api", "claim failed at 10:00:01", "error"), fingerprint: "abc" };
    const b = { ...line(2, "api", "claim failed at 10:00:06", "error"), fingerprint: "abc" };
    const c = { ...line(3, "api", "claim failed at 10:00:11", "error"), fingerprint: "def" };
    expect(collapseRepeats([a, b, c]).map((r) => [r.entry.seq, r.repeat])).toEqual([[1, 2], [3, 1]]);
  });

  it("is empty for no lines, and plainRows keeps every line", () => {
    expect(collapseRepeats([])).toEqual([]);
    expect(plainRows([line(1, "api", "a"), line(2, "api", "a")]).map((r) => r.repeat)).toEqual([1, 1]);
  });
});
