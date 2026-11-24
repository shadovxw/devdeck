import { describe, expect, it } from "vitest";

import { usedByText } from "./databases";

describe("usedByText", () => {
  it.each([
    [[], "nothing points at it"],
    [["api"], "api"],
    [["api", "worker"], "api, worker"],
    [["a", "b", "c", "d"], "shared by 4 repos"],
  ])("%o → %s", (list, want) => {
    expect(usedByText(list)).toBe(want);
  });
});
