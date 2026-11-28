import { describe, expect, it } from "vitest";

import { itemOf, nearestIndex, panoramaRadius, rotationFor, SEEN_WITHIN, seen, slotsFor, snapTarget, wrap } from "./ring-math";

describe("wrap", () => {
  it.each([
    [0, 0],
    [190, -170],
    [-190, 170],
    [360, 0],
    [725, 5],
    [180, -180],
  ])("%d → %d", (deg, want) => {
    expect(wrap(deg)).toBe(want);
  });
});

describe("slotsFor", () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 6], // two items: three rounds, so the other one is beside the card ahead
    [4, 8], // under ten, every item twice
    [3, 6],
    [5, 10],
    [9, 18],
    [10, 10],
    [14, 14],
  ])("%d items → %d slots", (n, want) => {
    expect(slotsFor(n)).toBe(want);
  });

  it.each([3, 4, 5, 6, 7, 8, 9])("never shows two copies of one of %d items at once", (n) => {
    // Copies of an item are n slots apart; both are in view only if that is under 2 × SEEN_WITHIN.
    expect(n * (360 / slotsFor(n))).toBeGreaterThanOrEqual(2 * SEEN_WITHIN);
  });
});

describe("itemOf", () => {
  it.each([
    [0, 5, 0],
    [7, 5, 2],
    [9, 5, 4],
    [3, 0, 0],
  ])("slot %d of %d items → item %d", (slot, n, want) => {
    expect(itemOf(slot, n)).toBe(want);
  });
});

describe("panoramaRadius", () => {
  it("makes the slots side by side the circumference", () => {
    expect(2 * Math.PI * panoramaRadius(10, 300, 90)).toBeCloseTo(10 * 390);
  });
  it("is a card's width for a single card", () => expect(panoramaRadius(1, 300, 90)).toBe(300));
  it("never puts the cards closer than 1.6 cards", () => expect(panoramaRadius(4, 300, 90)).toBe(480));
});

describe("nearestIndex", () => {
  it.each([
    // 4 slots: a step is 90°. Turning the ring left (negative) brings the next slot ahead.
    { rotation: 0, want: 0 },
    { rotation: -36, want: 0 }, // 0.4 of a step
    { rotation: -54, want: 1 }, // 0.6 of a step
    { rotation: 54, want: 3 }, // wraps backwards
    { rotation: -360, want: 0 },
    { rotation: -450, want: 1 },
  ])("rotation $rotation → slot $want", ({ rotation, want }) => {
    expect(nearestIndex(rotation, 4)).toBe(want);
  });
  it("is 0 for a single card", () => expect(nearestIndex(123, 1)).toBe(0));
});

describe("snapTarget", () => {
  it.each([
    { rotation: -30, velocity: 0, want: 0 },
    { rotation: -50, velocity: 0, want: -90 },
    { rotation: -30, velocity: -100, want: -90 }, // momentum carries it on
    { rotation: 10, velocity: 300, want: 180 },
  ])("$rotation at $velocity°/s → $want", ({ rotation, velocity, want }) => {
    expect(snapTarget(rotation, velocity, 4, 0.6)).toBe(want);
  });
});

describe("rotationFor", () => {
  it.each([
    { i: 1, rotation: 0, want: -90 },
    { i: 3, rotation: 0, want: 90 }, // the short way round
    { i: 2, rotation: -720, want: -540 }, // half a turn either way: keeps whole turns
  ])("slot $i from $rotation → $want", ({ i, rotation, want }) => {
    const r = rotationFor(i, 4, rotation);
    expect(r).toBe(want);
    expect(nearestIndex(r, 4)).toBe(i);
  });
});

describe("seen", () => {
  it.each([
    { angle: 0, visible: true, strength: 1 },
    { angle: -50, visible: true, strength: 1 },
    { angle: 64, visible: true, strength: 0.5 },
    { angle: 78, visible: false, strength: 0 },
    { angle: -150, visible: false, strength: 0 },
  ])("$angle°", ({ angle, visible, strength }) => {
    const s = seen(angle);
    expect(s.visible).toBe(visible);
    expect(s.strength).toBeCloseTo(strength);
  });
});
