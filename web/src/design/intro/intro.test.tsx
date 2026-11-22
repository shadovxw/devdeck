import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUi } from "../../store/ui";
import { chooseIntro, markIntroSeen } from "./choose";
import { Intro } from "./Intro";

const draws: number[] = [];
const disposed = vi.fn();
vi.mock("./scene", () => ({
  createIntroScene: () => ({ draw: (_f: unknown, t: number) => draws.push(t), dispose: disposed }),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance", "setTimeout", "Date"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  draws.length = 0;
  disposed.mockClear();
  sessionStorage.clear();
  useUi.setState({ effects: null, reduceMotion: false });
});

/** Runs the frame clock for this many seconds. */
const play = async (seconds: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(seconds * 1000);
  });
};

function renderIntro(mode: "3d" | "fade" | "svg", over: Partial<{ ready: boolean; offline: boolean }> = {}) {
  const onApp = vi.fn();
  const onDone = vi.fn();
  const props = { mode, ready: true, offline: false, onApp, onDone, ...over };
  const view = render(<Intro {...props} />);
  return { onApp, onDone, rerender: (p: Partial<typeof props>) => view.rerender(<Intro {...props} {...p} />) };
}

describe("the launch intro", () => {
  it("3D: draws, mounts the app under the stage, hides Home's own orb until the particles land, then ends", async () => {
    const { onApp, onDone } = renderIntro("3d");
    await play(0.2);
    expect(draws.length).toBeGreaterThan(0);
    expect(document.documentElement.dataset.intro).toBe("");
    await play(2.3);
    expect(onApp).not.toHaveBeenCalled();
    await play(0.2);
    expect(onApp).toHaveBeenCalledOnce();
    expect(onDone).not.toHaveBeenCalled();
    await play(1.8);
    expect(onDone).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.intro).toBeUndefined();
  });

  it("3D: holds on the lockup with a progress line until the server answers", async () => {
    const { onApp, onDone, rerender } = renderIntro("3d", { ready: false });
    await play(4);
    expect(onApp).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ui="intro-wait"]')).toBeTruthy();
    expect(Math.max(...draws)).toBeCloseTo(2.95, 2);

    rerender({ ready: true });
    await play(1.4);
    expect(onApp).toHaveBeenCalledOnce();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("3D: ends on the lockup when the server is offline, for the offline screen to take over", async () => {
    const { onApp, onDone } = renderIntro("3d", { ready: false, offline: true });
    await play(3.1);
    expect(onDone).toHaveBeenCalledOnce();
    expect(onApp).not.toHaveBeenCalled();
    expect(disposed).not.toHaveBeenCalled(); // cleaned up on unmount
  });

  it("any key skips to the end", async () => {
    const { onDone } = renderIntro("3d");
    await play(0.5);
    fireEvent.keyDown(window, { key: "Enter" });
    await play(0.4);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("a click skips too", async () => {
    const { onDone } = renderIntro("svg");
    await play(0.3);
    fireEvent.pointerDown(window);
    await play(0.5);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("svg (no WebGL): the flat lockup with its letters, then the app", async () => {
    const { onApp, onDone } = renderIntro("svg");
    expect(screen.getByText("Your developer cockpit")).toBeTruthy();
    expect(document.querySelectorAll('[data-ui="intro-word"] > span')).toHaveLength(7);
    await play(0.1);
    expect(onApp).toHaveBeenCalledOnce();
    await play(1.9);
    expect(onDone).not.toHaveBeenCalled();
    await play(0.5);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("fade (reduce motion): a short fade in and out, no 3D", async () => {
    const { onDone } = renderIntro("fade");
    await play(1.0);
    expect(onDone).toHaveBeenCalledOnce();
    expect(draws).toHaveLength(0);
    expect(document.querySelector("canvas")).toBeNull();
  });
});

describe("chooseIntro", () => {
  it("plays on the first start of a session only", () => {
    useUi.setState({ effects: "reduced" });
    expect(chooseIntro()).toBe("fade");
    markIntroSeen();
    expect(chooseIntro()).toBe("none");
  });

  it("never plays with Effects off", () => {
    useUi.setState({ effects: "off" });
    expect(chooseIntro()).toBe("none");
  });

  it("is the SVG lockup where there is no WebGL (as in the test browser)", () => {
    useUi.setState({ effects: "full" });
    expect(chooseIntro()).toBe("svg");
  });
});
