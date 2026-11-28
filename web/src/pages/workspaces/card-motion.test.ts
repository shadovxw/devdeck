import { describe, expect, it } from "vitest";

import { cardMotion } from "./WorkspaceCards";

describe("cardMotion", () => {
  it.each([
    ["full", false, "full"],
    ["reduced", false, "reduced"],
    ["off", false, "still"],
    ["full", true, "still"],
    ["reduced", true, "still"],
  ] as const)("effects %s, reduce motion %s → %s", (effects, reduce, want) => {
    expect(cardMotion(effects, reduce)).toBe(want);
  });
});
