import { describe, expect, it } from "vitest";

import { advance, AT, introAt, introMode, outBack, skipTo, WORD } from "./timeline";

describe("introAt", () => {
  it("starts empty: nothing built, the backdrop up", () => {
    const f = introAt(0);
    expect([f.gather, f.stem, f.ribbonOpacity, f.turn, f.exit, f.stream, f.tagline, f.word]).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(f.letters.every((l) => l === 0)).toBe(true);
    expect([f.backdrop, f.canvas]).toEqual([1, 1]);
  });

  it.each([
    ["the particles have gathered", 1.1, (f: ReturnType<typeof introAt>) => f.gather, 1],
    ["the stem is in", 0.95, (f: ReturnType<typeof introAt>) => f.stem, 1],
    ["the mark has turned to face you", 1.95, (f: ReturnType<typeof introAt>) => f.turn, 1],
    ["every letter is up", 2.6, (f: ReturnType<typeof introAt>) => f.letters.at(-1), 1],
    ["the mark has left for the sidebar", 3.42, (f: ReturnType<typeof introAt>) => f.exit, 1],
    ["the particles are in the orb", 4.0, (f: ReturnType<typeof introAt>) => f.stream, 1],
    ["the backdrop is gone", 3.5, (f: ReturnType<typeof introAt>) => f.backdrop, 0],
    ["the canvas is gone at the end", AT.end, (f: ReturnType<typeof introAt>) => f.canvas, 0],
  ])("%s at %ss", (_, t, pick, want) => {
    expect(pick(introAt(t))).toBeCloseTo(want, 5);
  });

  it("has a letter per character, rising one after another", () => {
    const f = introAt(2.0);
    expect(f.letters).toHaveLength(WORD.length);
    for (let i = 1; i < f.letters.length; i++) expect(f.letters[i]).toBeLessThanOrEqual(f.letters[i - 1]);
  });

  it("blinks the cursor, then keeps it on", () => {
    expect(introAt(1.3).cursor).toBe(false);
    expect(introAt(1.45).cursor).toBe(true);
    expect(introAt(1.6).cursor).toBe(false);
    expect(introAt(2.5).cursor).toBe(true);
  });

  it("lights the sweep only while it crosses", () => {
    expect(introAt(2.1).sweep).toBe(0);
    expect(introAt(2.5).sweep).toBeCloseTo(1, 5);
    expect(introAt(2.9).sweep).toBe(0);
  });

  it("swings the ribbon slightly past shut before it settles", () => {
    expect(Math.max(...[0.7, 0.8, 0.9].map(outBack))).toBeGreaterThan(1);
    expect(outBack(1)).toBe(1);
  });
});

describe("advance and skip", () => {
  it("runs on while the server is there", () => {
    expect(advance(2.9, 0.1, true)).toBeCloseTo(3.0, 5);
  });

  it("holds at the lockup while it is not", () => {
    expect(advance(2.9, 0.1, false)).toBe(AT.hold);
    expect(advance(AT.hold, 0.5, false)).toBe(AT.hold);
    expect(advance(1.0, 0.1, false)).toBeCloseTo(1.1, 5);
  });

  it("skips to the end when ready, to the lockup when not, and never back", () => {
    expect(skipTo(0.5, true)).toBe(AT.end - 0.3);
    expect(skipTo(0.5, false)).toBe(AT.hold);
    expect(skipTo(4.1, true)).toBe(4.1);
  });
});

describe("introMode", () => {
  const base = { seen: false, look: "neon", effects: "full" as const, reduceMotion: false, webgl: true };
  it.each([
    ["Neon, full effects, WebGL: the 3D intro", base, "3d"],
    ["seen this session", { ...base, seen: true }, "none"],
    ["Flat", { ...base, look: "paper" }, "none"],
    ["effects off", { ...base, effects: "off" as const }, "none"],
    ["effects reduced: the fade", { ...base, effects: "reduced" as const }, "fade"],
    ["reduce motion: the fade", { ...base, reduceMotion: true }, "fade"],
    ["no WebGL: the SVG lockup", { ...base, webgl: false }, "svg"],
  ])("%s", (_, o, want) => {
    expect(introMode(o)).toBe(want);
  });
});
