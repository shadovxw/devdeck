import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OrbColors, OrbState } from "./model";

// The scene needs WebGL; a stand-in records what OrbCanvas asks of it.
const calls = vi.hoisted(() => ({
  created: [] as { state: OrbState; colors: OrbColors; still: boolean }[],
  states: [] as OrbState[],
  colors: [] as OrbColors[],
  disposed: 0,
}));

vi.mock("./scene", () => ({
  createOrb: (_canvas: HTMLCanvasElement, opts: { state: OrbState; colors: OrbColors; still: boolean }) => {
    calls.created.push(opts);
    return {
      setState: (s: OrbState) => calls.states.push(s),
      setColors: (c: OrbColors) => calls.colors.push(c),
      dispose: () => {
        calls.disposed++;
      },
    };
  },
}));

const { default: OrbCanvas, readOrbColors } = await import("./OrbCanvas");

const root = document.documentElement;

beforeEach(() => {
  calls.created.length = 0;
  calls.states.length = 0;
  calls.colors.length = 0;
  calls.disposed = 0;
  root.style.setProperty("--primary", "#c27aff");
  root.style.setProperty("--critical", "#ef4444");
});

afterEach(() => {
  cleanup();
  root.removeAttribute("style");
});

describe("readOrbColors", () => {
  it("reads the theme's colours from the page, with safe defaults for what is missing", () => {
    const c = readOrbColors();
    expect(c.primary).toBe("#c27aff");
    expect(c.critical).toBe("#ef4444");
    expect(c.good).toMatch(/^#/);
    expect(c.ink).toMatch(/^#/);
    expect(c.live).toMatch(/^#/);
  });
});

describe("OrbCanvas", () => {
  it("builds the orb with the theme's colours, still or not", () => {
    render(<OrbCanvas state="idle" still />);
    expect(calls.created).toHaveLength(1);
    expect(calls.created[0].colors.primary).toBe("#c27aff");
    expect(calls.created[0].still).toBe(true);
  });

  it("takes new colours when the theme changes", async () => {
    render(<OrbCanvas state="idle" still={false} />);
    root.style.setProperty("--primary", "#22d3ee");
    await waitFor(() => expect(calls.colors.at(-1)?.primary).toBe("#22d3ee"));
  });

  it("changes state without rebuilding the scene", () => {
    const { rerender } = render(<OrbCanvas state="idle" still={false} />);
    rerender(<OrbCanvas state="thinking" still={false} />);
    expect(calls.states.at(-1)).toBe("thinking");
    expect(calls.created).toHaveLength(1);
  });

  it("rebuilds when stillness changes, and lets go of everything when it leaves", () => {
    const { rerender, unmount } = render(<OrbCanvas state="idle" still={false} />);
    rerender(<OrbCanvas state="idle" still />);
    expect(calls.created).toHaveLength(2);
    expect(calls.disposed).toBe(1);
    unmount();
    expect(calls.disposed).toBe(2);
    // After unmount, a theme change reaches nothing.
    const before = calls.colors.length;
    root.style.setProperty("--primary", "#000000");
    expect(calls.colors.length).toBe(before);
  });
});
