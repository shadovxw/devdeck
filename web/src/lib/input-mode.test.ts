import { describe, expect, it } from "vitest";

import { startInputMode } from "./input-mode";

describe("input mode", () => {
  it("tracks keyboard versus pointer on <html data-input>", () => {
    startInputMode();
    startInputMode(); // calling twice must not double the listeners
    expect(document.documentElement.dataset.input).toBe("pointer");

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true }));
    expect(document.documentElement.dataset.input).toBe("keyboard");

    window.dispatchEvent(new Event("pointerdown"));
    expect(document.documentElement.dataset.input).toBe("pointer");
  });
});
