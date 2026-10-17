import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StatusPill } from "./StatusPill";

afterEach(cleanup);

describe("StatusPill", () => {
  it("does not flash on first render", () => {
    const { container } = render(<StatusPill state="ok" />);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(container.querySelector(".flash")).toBeNull();
  });

  it("flashes once when the state changes, and not when it re-renders unchanged", () => {
    const { container, rerender } = render(<StatusPill state="degraded" />);
    expect(container.querySelector(".flash")).toBeNull();

    rerender(<StatusPill state="ok" />);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(container.querySelector(".flash")).not.toBeNull();

    // the same state again keeps the same element (a new key would restart the animation)
    const el = container.querySelector(".flash");
    rerender(<StatusPill state="ok" title="again" />);
    expect(container.querySelector(".flash")).toBe(el);
  });

  it("never relies on colour alone: every state has a label", () => {
    for (const [state, label] of [
      ["ok", "Ready"],
      ["degraded", "Degraded"],
      ["outdated", "Outdated"],
      ["missing", "Missing"],
    ] as const) {
      const { unmount } = render(<StatusPill state={state} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });
});
