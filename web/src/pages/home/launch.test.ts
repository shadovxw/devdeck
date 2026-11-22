import { describe, expect, it } from "vitest";

import { NAV, NAV_ITEMS } from "../../app/nav";
import type { RunStatus, ServiceStatus } from "../../lib/types";
import { launchLegend, launchTiles, orbitNodes, orbStatus, searchPages } from "./launch";

const svc = (id: string, state: ServiceStatus["state"]): ServiceStatus => ({ id, kind: "command", state, restarts: 0 });
const run = (stack: string, state: RunStatus["state"], services: ServiceStatus[] = [svc("api", "ready")]): RunStatus => ({
  workspace: "acme",
  stack,
  state,
  started_at: "",
  services,
});

describe("launchTiles", () => {
  const tiles = launchTiles();

  it("has one tile per group with a built page, in the sidebar's order, Home's group as Overview", () => {
    expect(tiles.map((t) => t.label)).toEqual(NAV.filter((g) => g.items.some((i) => i.built && i.path !== "/")).map((g) => (g.name === "devdeck" ? "Overview" : g.name)));
    expect(tiles[0]).toMatchObject({ label: "Overview" });
    expect(tiles[0].pages.map((p) => p.path)).toEqual(["/overview"]);
  });

  it("lists every built sidebar page except Home, and nothing unbuilt", () => {
    const listed = tiles.flatMap((t) => t.pages.map((p) => p.path));
    const sidebar = NAV.flatMap((g) => g.items).filter((i) => i.built && i.path !== "/").map((i) => i.path);
    expect(listed).toEqual(sidebar);
    expect(listed).not.toContain("/databases");
  });
});

describe("searchPages", () => {
  it.each([
    ["a name's start", "sta", "/stacks"],
    ["any word of a name", "hosts", "/hosts"],
    ["ignores case", "LOGS", "/logs"],
    ["a sub-page by name", "images", "/images"],
  ])("best match first: %s", (_, q, want) => {
    expect(searchPages(q)[0]?.path).toBe(want);
  });

  it("offers nothing for nothing typed", () => {
    expect(searchPages("  ")).toEqual([]);
  });

  it.each([
    ["Home", "home", "/"],
    ["an unbuilt page", "databases", "/databases"],
  ])("leaves out %s", (_, q, path) => {
    expect(searchPages(q).map((p) => p.path)).not.toContain(path);
  });

  it("finds sub-pages by their parent, and pages by what they are for", () => {
    expect(searchPages("stacks").map((p) => p.path)).toEqual(expect.arrayContaining(["/stacks", "/logs"]));
    expect(searchPages("folder").map((p) => p.path)).toContain("/workspaces");
  });

  it("ranks a name match above a group match and keeps at most the limit", () => {
    const r = searchPages("s", NAV_ITEMS, 3);
    expect(r).toHaveLength(3);
    expect(r[0].label.toLowerCase().startsWith("s")).toBe(true);
  });
});

describe("orbStatus", () => {
  it.each([
    ["not loaded yet", undefined, "idle", "Idle"],
    ["nothing running", [], "idle", "Idle · Ready"],
    ["one running", [run("web", "running")], "idle", "Idle · 1 stack running"],
    ["two running", [run("web", "running"), run("jobs", "running")], "idle", "Idle · 2 stacks running"],
    ["a stack starting: it thinks", [run("web", "running"), run("jobs", "starting")], "thinking", "Thinking · starting jobs"],
    ["a stack stopping", [run("web", "stopping")], "thinking", "Thinking · stopping web"],
    ["a failed service", [run("web", "degraded", [svc("api", "failed"), svc("db", "ready")])], "idle", "Idle · 1 service needs a look"],
  ] as const)("%s", (_, runs, state, text) => {
    expect(orbStatus(runs as RunStatus[] | undefined)).toEqual({ state, text });
  });
});

describe("orbitNodes", () => {
  const nodes = orbitNodes();

  it("puts every built sidebar page but Home on the arc, in the sidebar's order", () => {
    expect(nodes.map((n) => n.item.path)).toEqual(launchTiles().flatMap((t) => t.pages.map((p) => p.path)));
    expect(nodes[0].item.path).toBe("/overview");
  });

  it("starts at the upper right and ends at the upper left", () => {
    const first = nodes[0];
    const last = nodes.at(-1)!;
    expect(first.cos).toBeCloseTo(Math.SQRT1_2, 3);
    expect(first.sin).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(last.cos).toBeCloseTo(-Math.SQRT1_2, 3);
    expect(last.sin).toBeCloseTo(-Math.SQRT1_2, 3);
  });

  it("reads right-hand pages from their left edge and left-hand ones from their right", () => {
    expect(nodes[0].side).toBe("right");
    expect(nodes.at(-1)!.side).toBe("left");
  });

  it("colours a page by its group, Overview with Run", () => {
    const tone = (p: string) => nodes.find((n) => n.item.path === p)?.tone;
    expect([tone("/overview"), tone("/workspaces"), tone("/stacks"), tone("/settings")]).toEqual(["run", "work", "run", "system"]);
  });

  it("gives every page a hint", () => {
    expect(nodes.filter((n) => !n.item.hint).map((n) => n.item.path)).toEqual([]);
  });
});

describe("launchLegend", () => {
  it("lists the groups with pages, with their words", () => {
    expect(launchLegend().map((g) => [g.name, g.blurb])).toEqual([
      ["Work", "your code"],
      ["Run", "what's running"],
      ["System", "setup"],
    ]);
  });
});
