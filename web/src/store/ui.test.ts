import { afterEach, describe, expect, it } from "vitest";

import { syncThemeColor, useUi } from "./ui";

const color = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content;

afterEach(() => {
  localStorage.clear();
  useUi.getState().setTheme("system");
});

describe("theme colour", () => {
  it("matches the page background of the chosen theme", () => {
    useUi.getState().setTheme("light");
    expect(color()).toBe("#f3f6f6");
    expect(document.documentElement.dataset.theme).toBe("light");

    useUi.getState().setTheme("dark");
    expect(color()).toBe("#0c1012");
  });

  it("follows the OS preference for the system theme (dark in the test browser)", () => {
    syncThemeColor("system");
    expect(color()).toBe("#0c1012"); // the test setup reports no light preference
  });

  it("creates the tag when the page has none", () => {
    document.querySelector('meta[name="theme-color"]')?.remove();
    syncThemeColor("light");
    expect(color()).toBe("#f3f6f6");
  });
});
