import { describe, expect, it } from "vitest";

import { familyOf, FOOTER_GROUP, HOME_GROUP, NAV, NAV_ITEMS, navByPath, sidebarPathOf } from "./nav";

describe("nav config", () => {
  it("has unique, absolute paths and labels", () => {
    const paths = NAV_ITEMS.map((i) => i.path);
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("gives every page except the built ones an empty state, and its button points to a real page", () => {
    const paths = new Set(NAV_ITEMS.map((i) => i.path));
    for (const item of NAV_ITEMS) {
      if (item.path === "/plugins") continue;
      expect(item.empty, item.path).toBeDefined();
      expect(item.empty!.headline.length, item.path).toBeGreaterThan(0);
      const built = ["/", "/overview", "/workspaces", "/repos", "/features", "/stacks", "/logs", "/images", "/hosts", "/doctor", "/connections", "/connections/github", "/connections/docker", "/claude", "/docs", "/settings"];
      expect(item.built, item.path).toBe(built.includes(item.path));
      expect(item.phase === undefined, item.path).toBe(item.built);
      const to = item.empty!.cta?.to;
      if (to) expect(paths.has(to), `${item.path} -> ${to}`).toBe(true);
    }
  });

  it("has Home at the root and no empty groups", () => {
    expect(NAV[0].items[0].path).toBe("/");
    for (const g of NAV) expect(g.items.length).toBeGreaterThan(0);
  });

  it("puts GitHub, Docker Hub and Claude access in the Connections family, in the footer group", () => {
    const connections = NAV.flatMap((g) => g.items).find((i) => i.path === "/connections");
    expect(connections?.children?.map((c) => c.path)).toEqual(["/connections/github", "/connections/docker", "/claude"]);
    expect(navByPath("/connections/github").parent).toBe("Connections");
    expect(navByPath("/connections/github").group).toBe("System");
  });

  it("nests sub-pages under their parent and still lists them once as pages", () => {
    const databases = NAV.flatMap((g) => g.items).find((i) => i.path === "/databases");
    expect(databases?.children?.map((c) => c.path)).toEqual(["/migrations", "/sql", "/scripts"]);
    expect(NAV.flatMap((g) => g.items).some((i) => i.path === "/migrations")).toBe(false); // not top-level
    expect(navByPath("/migrations").parent).toBe("Databases");
    expect(navByPath("/migrations").group).toBe("Data");
    expect(NAV_ITEMS.filter((i) => i.path === "/migrations")).toHaveLength(1);
  });
});

describe("families", () => {
  it("lists a family parent first, and finds it from any of its pages", () => {
    expect(familyOf("/logs")?.map((i) => i.path)).toEqual(["/stacks", "/logs", "/resources", "/images"]);
    expect(familyOf("/stacks")?.[0].path).toBe("/stacks");
    expect(familyOf("/doctor")?.map((i) => i.tab ?? i.label)).toEqual(["Doctor", "Findings"]);
    expect(familyOf("/hosts")).toBeUndefined();
  });

  it("shows a family page under its first page in the sidebar", () => {
    expect(sidebarPathOf("/images")).toBe("/stacks");
    expect(sidebarPathOf("/claude")).toBe("/connections");
    expect(sidebarPathOf("/hosts")).toBe("/hosts");
  });

  it("names the Doctor page Health, and groups the footer as System", () => {
    expect(navByPath("/doctor").label).toBe("Health");
    expect(navByPath("/doctor").group).toBe("Run"); // until Flows ships, Automate would hold nothing built
    expect(NAV.find((g) => g.name === FOOTER_GROUP)?.items.map((i) => i.path)).toEqual(["/connections", "/secrets", "/plugins", "/notifications", "/docs", "/settings"]);
    expect(NAV[0].name).toBe(HOME_GROUP);
  });
});
