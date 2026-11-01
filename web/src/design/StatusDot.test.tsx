import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LevelMark } from "./LevelMark";
import { ServiceStateMark } from "./ServiceStateMark";
import { StatusDot } from "./StatusDot";

afterEach(cleanup);

describe("StatusDot", () => {
  it("is a filled dot by default and a ring for neutral", () => {
    const { container, rerender } = render(<StatusDot tone="good" />);
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("var(--good)");
    rerender(<StatusDot tone="neutral" />);
    expect(container.querySelector("circle")?.getAttribute("fill")).toBe("none");
  });

  it("turns for work in progress and is hidden from screen readers", () => {
    const { container } = render(<StatusDot tone="primary" spin />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("spin-arc");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws every service state as a round mark with its word", () => {
    for (const [state, word] of [["ready", "Ready"], ["stopped", "Stopped"], ["building", "Building"], ["failed", "Failed"]] as const) {
      const { container, unmount } = render(<ServiceStateMark state={state} />);
      expect(container.textContent).toBe(word);
      expect(container.querySelector("polygon, rect, path[d*='L']")).toBeNull();
      unmount();
    }
  });

  it("keeps the whole level word for screen readers", () => {
    const { container } = render(<LevelMark level="warn" />);
    expect(container.querySelector(".sr-only")?.textContent).toBe("warning");
  });
});
