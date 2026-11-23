import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { duration, stagger } from "./motion";

// Read from disk: Vitest empties CSS imports (css: false), even ?raw ones.
const tokens = readFileSync("src/design/tokens.css", "utf8"); // tests run from the web folder

describe("motion tokens", () => {
  it("keep the JavaScript numbers equal to the CSS tokens", () => {
    for (const [name, seconds] of Object.entries(duration)) {
      const match = new RegExp(`--dur-${name}:\\s*(\\d+)ms;`).exec(tokens);
      expect(match, `--dur-${name} in tokens.css`).not.toBeNull();
      expect(Number(match![1]) / 1000, name).toBe(seconds);
    }
  });

  it("collapse every duration under reduced motion, for the OS setting and for performance mode", () => {
    const media = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/.exec(tokens)?.[0] ?? "";
    const attr = /:root\[data-motion="reduced"\] \{[\s\S]*?\}/.exec(tokens)?.[0] ?? "";
    for (const block of [media, attr]) {
      for (const name of Object.keys(duration)) expect(block).toContain(`--dur-${name}: 0.01ms;`);
    }
  });

  it("exposes the stagger position as a CSS variable", () => {
    expect(stagger(3)).toEqual({ "--i": 3 });
  });
});
