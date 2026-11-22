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

  it("only Findings is good news, and it turns slowly", () => {
    expect(MINI_VARIANTS.filter(isGoodNews)).toEqual(["findings"]);
    expect(miniSpin("findings")).toBeLessThan(miniSpin("plain"));
    expect(miniSpin("logs")).toBe(0);
    expect(miniSpin("workspaces")).toBe(0);
  });
});
