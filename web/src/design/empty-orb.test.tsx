import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../store/ui";
import { EmptyOrb, supportsWebGL } from "./EmptyOrb";

// The real canvas needs WebGL, which the test browser doesn't have.
vi.mock("./orb/MiniCanvas", () => ({ default: ({ variant }: { variant: string }) => <canvas data-testid="mini-canvas" data-variant={variant} /> }));
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

describe("the empty-state kinds", () => {
  it("kind 1: the mini orb in its variant, the mono line, headline, action and command", async () => {
    const { MemoryRouter } = await import("react-router");
    const { EmptyState } = await import("./EmptyState");
    const { Layers } = await import("lucide-react");
    useUi.setState({ effects: null });
    const { container } = render(
      <MemoryRouter>
        <EmptyState icon={Layers} variant="stacks" empty={{ headline: "No stacks yet", text: "Why", kicker: "00 $ Stacks · none yet", command: "devdeck schema stack", cta: { label: "New stack", to: "/stacks" } }} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "No stacks yet" })).toBeTruthy();
    expect(screen.getByText("00 $ Stacks · none yet")).toBeTruthy();
    expect(screen.getByText("$ devdeck schema stack")).toBeTruthy();
    expect(screen.getByRole("link", { name: /New stack/ }).getAttribute("href")).toBe("/stacks");
    // the test browser has no WebGL: the plain art stands in for the orb
    expect(container.querySelector('[data-ui="mini-orb"]')).toBeNull();
  });

  it("the mini orb itself, where WebGL works, carries its variant", async () => {
    const { MiniOrb } = await import("./EmptyOrb");
    useUi.setState({ effects: null });
    const { container } = render(<MiniOrb variant="logs" fallback={art} webgl />);
    expect(container.querySelector('[data-ui="mini-orb"]')!.getAttribute("data-variant")).toBe("logs");
  });

  it("kind 3: no orb, the count and a way to clear it", async () => {
    const { NoResults } = await import("./EmptyState");
    const clear = vi.fn();
    const { container } = render(<NoResults query="postgres" onClear={clear} />);
    expect(screen.getByText("0 results for “postgres”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(clear).toHaveBeenCalledOnce();
    expect(container.querySelector("canvas, [data-ui='mini-orb']")).toBeNull();
  });
});

describe("good news", () => {
  it("marks Findings' and Notifications' empties so their line is green, not the accent", async () => {
    const { MemoryRouter } = await import("react-router");
    const { EmptyState } = await import("./EmptyState");
    const { Bell } = await import("lucide-react");
    const { container } = render(
      <MemoryRouter>
        <EmptyState icon={Bell} variant="notifications" empty={{ headline: "You're caught up", text: "x", kicker: "00 $ Notifications · nothing new" }} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-ui="empty"]')!.hasAttribute("data-good")).toBe(true);
  });
});
