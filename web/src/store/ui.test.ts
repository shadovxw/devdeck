import { afterEach, describe, expect, it } from "vitest";

import { useUi } from "./ui";

afterEach(() => {
  localStorage.clear();
  useUi.getState().setReduceMotion(false);
  useUi.getState().setLook("paper");
});

describe("look", () => {
  it("is Paper by default: no attribute and nothing kept", () => {
    expect(useUi.getState().look).toBe("paper");
    expect(document.documentElement.dataset.look).toBeUndefined();
  });

  it("marks the page for Neon and remembers it; Paper clears both", () => {
    useUi.getState().setLook("neon");
    expect(document.documentElement.dataset.look).toBe("neon");
    expect(localStorage.getItem("devdeck.look")).toBe("neon");

    useUi.getState().setLook("paper");
    expect(document.documentElement.dataset.look).toBeUndefined();
    expect(localStorage.getItem("devdeck.look")).toBeNull();
  });

  it("ignores a value it doesn't know", async () => {
    localStorage.setItem("devdeck.look", "sparkles");
    const { vi } = await import("vitest");
    vi.resetModules();
    const fresh = (await import("./ui")).useUi;
    expect(fresh.getState().look).toBe("paper");
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

  it("follows the style until chosen: off for Flat, full for Neon", async () => {
    const { effectiveEffects } = await import("./ui");
    expect(effectiveEffects("paper", null)).toBe("off");
    expect(effectiveEffects("neon", null)).toBe("full");
    expect(effectiveEffects("neon", "reduced")).toBe("reduced");
    expect(effectiveEffects("paper", "full")).toBe("full");
  });

  it("marks the page with the effects in use; off is no mark", () => {
    expect(document.documentElement.dataset.effects).toBeUndefined();
    useUi.getState().setLook("neon");
    expect(document.documentElement.dataset.effects).toBe("full");
    useUi.getState().setEffects("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("devdeck.effects")).toBe("reduced");
    useUi.getState().setEffects("off");
    expect(document.documentElement.dataset.effects).toBeUndefined();
    useUi.getState().setEffects(null);
    expect(localStorage.getItem("devdeck.effects")).toBeNull();
    expect(document.documentElement.dataset.effects).toBe("full");
    useUi.getState().setLook("paper");
    expect(document.documentElement.dataset.effects).toBeUndefined();
  });
});
