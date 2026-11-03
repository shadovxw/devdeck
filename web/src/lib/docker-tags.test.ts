import { describe, expect, it } from "vitest";

import { nextTag } from "./docker";

describe("nextTag", () => {
  it.each([
    [["1.0.95", "1.0.94", "1.0.88"], "1.0.96"],
    [["1.0.9", "1.0.10"], "1.0.11"], // numbers, not text
    [["0.1.180", "0.1.175"], "0.1.181"],
    [["v2.3", "v2.2"], "v2.4"],
    [["2"], "3"],
    [["1.0.95", "latest", "dev", "1.0.95-rc1"], "1.0.96"], // not plain versions: ignored
    [["1.2", "1.2.0"], "1.3"], // the same version twice: the newest one (first) sets the shape
    [["latest", "dev"], undefined],
    [[], undefined],
  ])("%j → %j", (names, want) => {
    expect(nextTag(names)).toBe(want);
  });
});
