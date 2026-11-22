import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../store/ui";
import { EmptyOrb, supportsWebGL } from "./EmptyOrb";

// The real canvas needs WebGL, which the test browser doesn't have.
vi.mock("./orb/OrbCanvas", () => ({
  default: ({ state, still }: { state: string; still: boolean }) => <canvas data-testid="orb-canvas" data-orb-state={state} data-still={String(still)} />,
}));

afterEach(() => {
  cleanup();
  useUi.setState({ effects: null, reduceMotion: false });
});

const art = <div data-testid="art" />;

describe("EmptyOrb", () => {
  it("knows the test browser has no WebGL, and remembers the answer", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(supportsWebGL()).toBe(false);
    expect(supportsWebGL()).toBe(false);
    expect(getContext.mock.calls.length).toBeLessThanOrEqual(2); // webgl2, then webgl, once
    getContext.mockRestore();
  });

  it("shows the art with Effects off, and without WebGL", () => {
    useUi.setState({ effects: "off" });
    const { rerender } = render(<EmptyOrb fallback={art} webgl />);
    expect(screen.getByTestId("art")).toBeTruthy();
    useUi.setState({ effects: null });
    rerender(<EmptyOrb fallback={art} webgl={false} />);
    expect(screen.getByTestId("art")).toBeTruthy();
  });

  it("loads the orb with effects on, animated, decorative", async () => {
    useUi.setState({ effects: null });
    const { container } = render(<EmptyOrb fallback={art} webgl state="thinking" size="mini" />);
    const canvas = await screen.findByTestId("orb-canvas");
    expect(canvas.getAttribute("data-orb-state")).toBe("thinking");
    expect(canvas.getAttribute("data-still")).toBe("false");
    const box = container.querySelector('[data-ui="orb"]')!;
    expect(box.getAttribute("aria-hidden")).toBe("true");
    expect(box.getAttribute("data-size")).toBe("mini");
    expect(screen.queryByTestId("art")).toBeNull();
  });

  it.each([
    ["Reduce motion", { reduceMotion: true }],
    ["Reduced effects", { effects: "reduced" as const }],
  ])("draws a still frame with %s", async (_, state) => {
    useUi.setState({ effects: null, ...state });
    render(<EmptyOrb fallback={art} webgl />);
    expect((await screen.findByTestId("orb-canvas")).getAttribute("data-still")).toBe("true");
  });
});
