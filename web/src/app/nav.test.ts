import { describe, expect, it } from "vitest";

import { NAV, NAV_ITEMS } from "./nav";

describe("nav config", () => {
  it("has unique, absolute paths and labels", () => {
    const paths = NAV_ITEMS.map((i) => i.path);
    const labels = NAV_ITEMS.map((i) => i.label);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const p of paths) expect(p.startsWith("/")).toBe(true);
  });

  it("gives every page except Plugins an empty state, and its button points to a real page", () => {
    const paths = new Set(NAV_ITEMS.map((i) => i.path));
    for (const item of NAV_ITEMS) {
      if (item.path === "/plugins") continue;
      expect(item.empty, item.path).toBeDefined();
      expect(item.empty!.headline.length, item.path).toBeGreaterThan(0);
      expect(item.phase, item.path).toBeDefined();
      const to = item.empty!.cta?.to;
      if (to) expect(paths.has(to), `${item.path} -> ${to}`).toBe(true);
    }
  });

  it("has Home at the root and no empty groups", () => {
    expect(NAV[0].items[0].path).toBe("/");
    for (const g of NAV) expect(g.items.length).toBeGreaterThan(0);
  });
});
