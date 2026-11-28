import { describe, expect, it } from "vitest";

import { ringMotion } from "./WorkspaceCards";

describe("ringMotion", () => {
  it.each([
    ["full", false, "full"],
    ["reduced", false, "reduced"],
    ["off", false, "still"],
    ["full", true, "still"],
    ["reduced", true, "still"],
  ] as const)("effects %s, reduce motion %s → %s", (effects, reduce, want) => {
    expect(ringMotion(effects, reduce)).toBe(want);
  });
});
