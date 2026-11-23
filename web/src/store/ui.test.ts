import { afterEach, describe, expect, it } from "vitest";

import { useUi } from "./ui";

afterEach(() => {
  localStorage.clear();
  useUi.getState().setReduceMotion(false);
});

describe("one style", () => {
  it("clears the old Flat/Neon choice and marks nothing for it", async () => {
    localStorage.setItem("devdeck.look", "neon");
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = (await import("./ui")).useUi;
    expect("look" in fresh.getState()).toBe(false);
    expect(localStorage.getItem("devdeck.look")).toBeNull();
    expect(document.documentElement.dataset.look).toBeUndefined();
  });
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

describe("effects", () => {
  afterEach(() => useUi.getState().setEffects(null));

  it("is full until chosen", async () => {
    const { effectiveEffects } = await import("./ui");
    expect(effectiveEffects(null)).toBe("full");
    expect(effectiveEffects("reduced")).toBe("reduced");
    expect(effectiveEffects("off")).toBe("off");
  });

  it("marks the page with the effects in use; off is no mark", () => {
    useUi.getState().setEffects("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("devdeck.effects")).toBe("reduced");
    useUi.getState().setEffects("off");
    expect(document.documentElement.dataset.effects).toBeUndefined();
    useUi.getState().setEffects(null);
    expect(localStorage.getItem("devdeck.effects")).toBeNull();
    expect(document.documentElement.dataset.effects).toBe("full");
  });
});

describe("your name", () => {
  afterEach(() => useUi.getState().setName(""));

  it("is empty by default and remembered once set; clearing it forgets it", () => {
    expect(useUi.getState().name).toBe("");
    useUi.getState().setName("Sam");
    expect(useUi.getState().name).toBe("Sam");
    expect(localStorage.getItem("devdeck.name")).toBe("Sam");
    useUi.getState().setName("  ");
    expect(localStorage.getItem("devdeck.name")).toBeNull();
  });

  it("keeps at most 40 characters", () => {
    useUi.getState().setName("x".repeat(60));
    expect(useUi.getState().name).toHaveLength(40);
  });
});
