import { describe, expect, it } from "vitest";

import { heartbeat, isGoodNews, MINI_POINTS, MINI_VARIANTS, miniLayout, miniPositions, miniSpin } from "./mini-model";

const xs = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, i) => a[i * 3]);
const ys = (a: Float32Array) => Array.from({ length: a.length / 3 }, (_, i) => a[i * 3 + 1]);

describe("miniLayout", () => {
  it.each(MINI_VARIANTS)("%s: every point placed, within the canvas, the same every time", (v) => {
    const a = miniLayout(v);
    expect(a.base).toHaveLength(MINI_POINTS * 3);
    expect(a.glow).toHaveLength(MINI_POINTS);
    expect(Array.from(a.base).every((c) => Number.isFinite(c) && Math.abs(c) <= 1.5)).toBe(true);
    expect(Array.from(miniLayout(v).base)).toEqual(Array.from(a.base));
  });

  it("workspaces: three orbs in a row, only the middle lit", () => {
    const { base, glow } = miniLayout("workspaces");
    const x = xs(base);
    const lit = x.filter((_, i) => glow[i] === 1);
    expect(Math.max(...lit.map(Math.abs))).toBeLessThan(0.5); // the lit one is in the middle
    expect(Math.min(...x)).toBeLessThan(-0.6);
    expect(Math.max(...x)).toBeGreaterThan(0.6);
    expect(Array.from(glow).filter((g) => g < 1).length).toBeGreaterThan(MINI_POINTS / 2);
  });

  it("repos: a ring, so nothing sits at the centre", () => {
    const { base } = miniLayout("repos");
    const r = xs(base).map((x, i) => Math.hypot(x, ys(base)[i] / 0.55));
    expect(Math.min(...r)).toBeGreaterThan(0.6);
  });

  it("stacks: three layers with gaps between them", () => {
    const y = ys(miniLayout("stacks").base);
    expect(y.some((v) => v > 0.55)).toBe(true);
    expect(y.some((v) => v < -0.55)).toBe(true);
    // the gaps: nothing just past the cuts
    expect(y.filter((v) => (v > 0.34 && v < 0.54) || (v < -0.34 && v > -0.54)).length).toBe(0);
  });

  it("resources: a flat line through the orb", () => {
    const { base } = miniLayout("resources");
    const line = ys(base).filter((_, i) => i % 5 === 0);
    expect(line.every((v) => v === 0)).toBe(true);
    expect(Math.max(...xs(base).filter((_, i) => i % 5 === 0))).toBeGreaterThan(0.9);
  });
});

describe("miniPositions", () => {
  const out = new Float32Array(MINI_POINTS * 3);

  it("logs fall, and wrap back to the top", () => {
    const layout = miniLayout("logs");
    const a = ys(miniPositions("logs", layout, 0, out).slice());
    const b = ys(miniPositions("logs", layout, 0.5, out).slice());
    const fell = a.filter((v, i) => b[i] < v).length;
    expect(fell).toBeGreaterThan(MINI_POINTS * 0.8);
    expect(b.every((v) => v >= -1.1 && v <= 1.1)).toBe(true);
  });

  it("resources beat while the line stays flat", () => {
    const layout = miniLayout("resources");
    const rest = miniPositions("resources", layout, 0.9, out).slice();
    const beat = miniPositions("resources", layout, 0.15, out).slice();
    expect(Math.abs(beat[3])).toBeGreaterThan(Math.abs(rest[3])); // point 1: the orb grows on the beat
    expect(beat[1]).toBe(0); // point 0: on the line, still flat
  });

  it("plain stays where it rests (the scene turns it as a whole)", () => {
    const layout = miniLayout("plain");
    expect(Array.from(miniPositions("plain", layout, 3, out))).toEqual(Array.from(layout.base));
  });
});

describe("the rest", () => {
  it("beats twice and rests", () => {
    expect(heartbeat(0.15)).toBeGreaterThan(0.9);
    expect(heartbeat(0.9)).toBeLessThan(0.01);
  });

  it("only Findings and Notifications are good news, and turn slowly", () => {
    expect(MINI_VARIANTS.filter(isGoodNews)).toEqual(["findings", "notifications"]);
    expect(miniSpin("findings")).toBeLessThan(miniSpin("plain"));
    expect(miniSpin("logs")).toBe(0);
    expect(miniSpin("workspaces")).toBe(0);
  });
});

describe("the rest of the table (P5b)", () => {
  const out = new Float32Array(MINI_POINTS * 3);

  it("hosts: the satellite drifts away from the orb", () => {
    const layout = miniLayout("hosts");
    const a = miniPositions("hosts", layout, 0, out).slice();
    const b = miniPositions("hosts", layout, 4, out).slice();
    expect(b[0]).toBeGreaterThan(a[0]); // point 0 is on the satellite
    expect(b[3]).toBe(a[3]); // point 1 is on the orb, which stays
  });

  it("data: a cylinder, still, every point at the same distance from its axis", () => {
    const { base } = miniLayout("data");
    const r = xs(base).map((x, i) => Math.hypot(x, base[i * 3 + 2]));
    expect(Math.min(...r)).toBeCloseTo(0.62, 3);
    expect(Math.max(...r)).toBeCloseTo(0.62, 3);
    expect(miniSpin("data")).toBe(0);
  });

  it("flows: points travel from one node to the other and start again", () => {
    const layout = miniLayout("flows");
    const a = miniPositions("flows", layout, 0, out).slice();
    const b = miniPositions("flows", layout, 0.2, out).slice();
    expect(b[2 * 3]).toBeGreaterThan(a[2 * 3]); // point 2 travels the path
    expect(xs(miniPositions("flows", layout, 7, out)).every((x) => x >= -1.2 && x <= 1.2)).toBe(true);
  });

  it("secrets: a shell with a small, dimmer core inside", () => {
    const { base, glow } = miniLayout("secrets");
    const core = Math.hypot(base[0], base[1], base[2]);
    expect(core).toBeLessThan(0.3);
    expect(glow[0]).toBeLessThan(1);
  });

  it("sockets: six empty sockets around a smaller orb", () => {
    const { base } = miniLayout("sockets");
    const sockets = xs(base).filter((_, i) => i % 3 === 0).map((x, j) => Math.hypot(x, base[j * 9 + 1]));
    expect(Math.min(...sockets)).toBeGreaterThan(0.85);
  });

  it("notifications: tiny, quiet, and good news like Findings", () => {
    const { base } = miniLayout("notifications");
    expect(Math.max(...Array.from(base).map(Math.abs))).toBeLessThanOrEqual(0.41);
    expect(isGoodNews("notifications")).toBe(true);
  });
});
