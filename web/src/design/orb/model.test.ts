import { describe, expect, it } from "vitest";

import { orbPalette, spherePoints, thinks, type OrbColors } from "./model";

const colors: OrbColors = { primary: "#c27aff", critical: "#ef4444", good: "#22c55e", warning: "#fbbf24", ink: "#ffffff", live: "#22d3ee" };

describe("orbPalette", () => {
  it("goes from the accent at the top to the error colour at the bottom, through the gradient's middle", () => {
    const p = orbPalette(colors, "idle");
    expect(p.top).toBe("#c27aff");
    expect(p.low).toBe("#ef4444");
    expect(p.mid).not.toBe(p.top);
    expect(p.mid).not.toBe(p.low);
    expect(p.mid).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.rings).toBe("#ffffff");
    expect(p.satellite).toBe("#22d3ee");
  });

  it("is the same while thinking (only the motion changes)", () => {
    expect(orbPalette(colors, "thinking")).toEqual(orbPalette(colors, "idle"));
  });

  it("is the success colour all through for good news, never the accent", () => {
    const p = orbPalette(colors, "ok");
    expect([p.top, p.low]).toEqual(["#22c55e", "#22c55e"]);
    expect(p.mid).toBe("#22c55e");
  });

  it("is the warning colour all through while reconnecting, and thinks then", () => {
    const p = orbPalette(colors, "warn");
    expect([p.top, p.mid, p.low]).toEqual(["#fbbf24", "#fbbf24", "#fbbf24"]);
    expect([thinks("warn"), thinks("thinking"), thinks("idle"), thinks("ok")]).toEqual([true, true, false, false]);
  });

  it("keeps the top colour as the middle when a colour can't be read", () => {
    const p = orbPalette({ ...colors, critical: "not a colour" }, "idle");
    expect(p.mid).toBe("#c27aff");
  });
});

describe("spherePoints", () => {
  it("puts every point on the unit sphere, from the top to the bottom", () => {
    const { positions, seeds } = spherePoints(200);
    expect(positions).toHaveLength(600);
    expect(seeds).toHaveLength(200);
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5);
      expect(seeds[i]).toBeGreaterThanOrEqual(0);
      expect(seeds[i]).toBeLessThan(1);
    }
    expect(positions[1]).toBeCloseTo(1, 5); // the first point is at the top
    expect(positions[199 * 3 + 1]).toBeCloseTo(-1, 5); // the last at the bottom
  });

  it("gives the same points every time, and copes with one point", () => {
    expect(spherePoints(50)).toEqual(spherePoints(50));
    const one = spherePoints(1);
    expect(Math.hypot(one.positions[0], one.positions[1], one.positions[2])).toBeCloseTo(1, 5);
  });
});
