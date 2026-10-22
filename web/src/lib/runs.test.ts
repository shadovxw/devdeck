import { describe, expect, it } from "vitest";

import { composeIds, formatUptime, isComposeId, mergeRun, serviceLabel, startOrder, tally } from "./runs";
import type { RunStatus, ServiceStatus, StackDef } from "./types";

const svc = (id: string, state: ServiceStatus["state"]): ServiceStatus => ({ id, kind: "go", state, restarts: 0 });
const run = (workspace: string, stack: string, state: RunStatus["state"], services: ServiceStatus[] = []): RunStatus => ({
  workspace,
  stack,
  state,
  started_at: "2026-10-17T10:00:00Z",
  services,
});

describe("mergeRun", () => {
  it("adds a stack, replaces it on the next update and keeps the list sorted", () => {
    let list = mergeRun(undefined, run("w", "b", "starting"));
    list = mergeRun(list, run("w", "a", "starting"));
    expect(list.map((r) => r.stack)).toEqual(["a", "b"]);

    list = mergeRun(list, run("w", "a", "running"));
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.stack === "a")?.state).toBe("running");
  });

  it("drops a stack once it has stopped, and ignores stopping an unknown one", () => {
    const list = mergeRun([run("w", "a", "running")], run("w", "a", "stopped"));
    expect(list).toEqual([]);
    expect(mergeRun([], run("w", "x", "stopped"))).toEqual([]);
  });

  it("keeps same-named stacks of other workspaces apart", () => {
    const list = mergeRun([run("one", "full", "running")], run("two", "full", "starting"));
    expect(list.map((r) => r.workspace)).toEqual(["one", "two"]);
  });
});

describe("startOrder", () => {
  const stack: StackDef = {
    name: "full",
    compose: [{ repo: "infra", file: "c.yml" }],
    services: [
      { id: "web", kind: "node", after: ["api"] },
      { id: "api", kind: "go", after: ["db"] },
      { id: "db", kind: "command" },
      { id: "auth", kind: "go" },
    ],
  };

  it("puts compose first, then each wave of services that can start together", () => {
    expect(startOrder(stack)).toEqual([["compose"], ["db", "auth"], ["api"], ["web"]]);
  });

  it("does not hang on a loop or an unknown dependency", () => {
    const loop: StackDef = {
      name: "x",
      services: [
        { id: "a", kind: "go", after: ["b"] },
        { id: "b", kind: "go", after: ["a"] },
        { id: "c", kind: "go", after: ["ghost"] },
      ],
    };
    const cols = startOrder(loop);
    expect(cols.flat().sort()).toEqual(["a", "b", "c"]);
    expect(startOrder({ name: "empty" })).toEqual([]);
  });
});

describe("tally", () => {
  it("counts services, the ready ones and the problems", () => {
    const t = tally([
      run("w", "a", "running", [svc("x", "ready"), svc("y", "ready")]),
      run("w", "b", "degraded", [svc("z", "failed"), svc("q", "blocked"), svc("r", "restarting"), svc("s", "starting")]),
    ]);
    expect(t).toEqual({ stacks: 2, services: 6, ready: 2, problems: 3 });
    expect(tally([])).toEqual({ stacks: 0, services: 0, ready: 0, problems: 0 });
  });
});

describe("formatUptime", () => {
  it.each([
    [0, "0s"],
    [999, "0s"],
    [59_000, "59s"],
    [134_000, "2m 14s"],
    [3_660_000, "1h 1m"],
    [90_000_000, "1d 1h"],
    [-5, "0s"],
  ])("%d ms is %s", (ms, text) => {
    expect(formatUptime(ms)).toBe(text);
  });
});

describe("compose files of a stack", () => {
  const file = (repo: string) => ({ repo, file: "docker-compose.yml" });

  it("names none, one and several files the way the server does", () => {
    expect(composeIds({ name: "s" })).toEqual([]);
    expect(composeIds({ name: "s", compose: [file("vault")] })).toEqual(["compose"]);
    expect(composeIds({ name: "s", compose: [file("vault"), file("storage"), file("vault")] })).toEqual(["compose-vault", "compose-storage", "compose-vault-3"]);
  });

  it("starts all compose files in the first column, even with no services", () => {
    const stack: StackDef = { name: "infra", compose: [file("vault"), file("storage")] };
    expect(startOrder(stack)).toEqual([["compose-vault", "compose-storage"]]);
  });

  it("labels them as dependencies", () => {
    expect(serviceLabel("compose")).toBe("Dependencies");
    expect(serviceLabel("compose-vault")).toBe("Dependencies · vault");
    expect(serviceLabel("api")).toBe("api");
    expect(isComposeId("compose-vault")).toBe(true);
    expect(isComposeId("composer")).toBe(false);
  });
});

describe("startOrder with named compose files", () => {
  const file = (id: string, extra: object = {}) => ({ id, repo: id, file: "c.yml", ...extra });

  it("places compose files and services in one order by their after lists", () => {
    const stack: StackDef = {
      name: "full",
      compose: [file("vault"), file("storage"), file("gateway", { after: ["nats"] }), file("keycloak", { after: ["catalog"] })],
      services: [
        { id: "nats", kind: "command", after: ["vault", "storage"] },
        { id: "auth", kind: "go", after: ["gateway"] },
        { id: "catalog", kind: "go", after: ["auth"] },
        { id: "frontend", kind: "node", after: ["catalog"] },
      ],
    };
    expect(startOrder(stack)).toEqual([["vault", "storage"], ["nats"], ["gateway"], ["auth"], ["catalog"], ["keycloak", "frontend"]]);
  });

  it("names a compose file by its id", () => {
    expect(composeIds({ name: "s", compose: [{ id: "vault", repo: "v", file: "c.yml" }] })).toEqual(["vault"]);
    expect(composeIds({ name: "s", compose: [{ id: "a", repo: "v", file: "c.yml" }, { id: "b", repo: "v", file: "c.yml" }] })).toEqual(["a", "b"]);
  });
});
