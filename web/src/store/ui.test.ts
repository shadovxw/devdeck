import { afterEach, describe, expect, it } from "vitest";

import { useUi } from "./ui";

afterEach(() => {
  localStorage.clear();
  useUi.getState().setReduceMotion(false);
});

describe("reduce motion", () => {
  it("marks the page, so every loop stops and every move is a cut, and remembers the choice", () => {
    useUi.getState().setReduceMotion(true);
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(localStorage.getItem("devdeck.reduce-motion")).toBe("1");

    useUi.getState().setReduceMotion(false);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(localStorage.getItem("devdeck.reduce-motion")).toBeNull();
  });

  it("starts from what was kept", async () => {
    localStorage.setItem("devdeck.reduce-motion", "1");
    const { vi } = await import("vitest");
    vi.resetModules(); // the store reads storage when its module loads
    const fresh = (await import("./ui")).useUi;
    expect(fresh.getState().reduceMotion).toBe(true);
    expect(document.documentElement.dataset.motion).toBe("reduced");
  });
});
