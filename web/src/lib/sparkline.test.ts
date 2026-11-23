import { describe, expect, it } from "vitest";

import { downsample, rateOf, sparkPoints } from "./sparkline";

describe("downsample", () => {
  it("leaves a short series alone and sums a long one into the points asked for", () => {
    expect(downsample([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(downsample([1, 1, 1, 1, 2, 2], 3)).toEqual([2, 2, 4]);
    expect(downsample(Array.from({ length: 90 }, () => 1), 20).reduce((a, b) => a + b, 0)).toBe(90);
  });
});

describe("sparkPoints", () => {
  it("puts the busiest point at the top and zero at the bottom, across the full width", () => {
    expect(sparkPoints([0, 4, 2], 20, 10)).toEqual([[0, 9], [10, 1], [20, 5]]);
    expect(sparkPoints([0, 0], 10, 10)).toEqual([[0, 9], [10, 9]]);
  });
});

describe("rateOf", () => {
  it.each([
    [0, 600, "once"],
    [1, 600, "once"],
    [120, 600, "every 5s"],
    [5, 600, "every 2 min"],
    [3, 36000, "every 3 h"],
  ])("%i in %is is %s", (total, seconds, want) => {
    expect(rateOf(total, seconds)).toBe(want);
  });
});
