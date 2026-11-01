import { describe, expect, it } from "vitest";

import { serviceStats, servicesWithErrors } from "./log-services";
import type { LogEntry } from "./types";

const line = (service: string, level: LogEntry["level"]): LogEntry => ({ seq: 1, time: "2026-10-31T10:00:00Z", workspace: "demo", stack: "full", service, stream: "stdout", text: "x", level });

describe("serviceStats", () => {
  const entries = [line("api", "info"), line("api", "error"), line("api", "info"), line("web", "warn"), line("web", "info")];

  it("counts loaded lines per service, busiest first, with the worst level", () => {
    expect(serviceStats(entries, ["api", "web", "worker"], [])).toEqual([
      { name: "api", count: 3, tone: "critical" },
      { name: "web", count: 2, tone: "warning" },
      { name: "worker", count: 0, tone: "neutral" },
    ]);
  });

  it("has no count for a service left out when others are picked", () => {
    const stats = serviceStats(entries.filter((e) => e.service === "api"), ["api", "web"], ["api"]);
    expect(stats).toEqual([
      { name: "api", count: 3, tone: "critical" },
      { name: "web", count: undefined, tone: "neutral" },
    ]);
  });

  it("uses the server's counts over the range when they are in, for every service", () => {
    const series = [
      { key: "api", total: 900, errors: 2, counts: [300, 300, 300] },
      { key: "db", total: 40, counts: [10, 10, 20] },
    ];
    const stats = serviceStats(entries, ["api", "web", "db"], ["web"], series);
    expect(stats.map((s) => [s.name, s.count, s.tone])).toEqual([
      ["api", 900, "critical"],
      ["db", 40, "good"],
      ["web", 2, "warning"], // not counted by the server: the loaded lines
    ]);
    expect(stats[0].counts).toEqual([300, 300, 300]);
  });

  it("lists a service that has lines but is not in the names", () => {
    expect(serviceStats([line("db", "info")], [], []).map((s) => s.name)).toEqual(["db"]);
  });
});

describe("servicesWithErrors", () => {
  it("names the services with an error or fatal line, once each", () => {
    expect(servicesWithErrors([line("web", "error"), line("api", "fatal"), line("web", "error"), line("db", "warn")])).toEqual(["api", "web"]);
  });
});
