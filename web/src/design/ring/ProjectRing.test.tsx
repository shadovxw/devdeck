import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ASPECT, ProjectRing, ringSizes, type RingMotion } from "./ProjectRing";

// Four items fill eight slots (45° apart): each item shows twice, half a turn apart.
const items = ["alpha", "beta", "gamma", "delta"];

function ring(motion: RingMotion, list = items) {
  const onOpen = vi.fn();
  render(
    <ProjectRing
      items={list}
      keyOf={(s) => s}
      nameOf={(s) => s}
      label="Things"
      motion={motion}
      onOpen={onOpen}
      renderItem={(s) => (
        <button type="button" aria-label={`Card ${s}`}>
          {s}
        </button>
      )}
    />,
  );
  return { onOpen, region: screen.getByRole("region", { name: "Things" }) };
}

describe("ProjectRing", () => {
  afterEach(cleanup);

  it("opens only the card ahead; a click on another brings it ahead", async () => {
    const { onOpen, region } = ring("still");
    expect(within(region).getByText("alpha, 1 of 4", { selector: "p" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Card beta" }));
    expect(onOpen).not.toHaveBeenCalled();
    await waitFor(() => expect(within(region).getByText("beta, 2 of 4", { selector: "p" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Card beta" }));
    expect(onOpen).toHaveBeenCalledWith("beta");
  });

  it("turns with the arrow keys, the short way round, and the focus follows", async () => {
    const { region } = ring("still");
    fireEvent.keyDown(region, { key: "ArrowLeft" });
    await waitFor(() => expect(within(region).getByText("delta, 4 of 4", { selector: "p" })).toBeTruthy());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Card delta" })));
    fireEvent.keyDown(region, { key: "ArrowRight" });
    await waitFor(() => expect(within(region).getByText("alpha, 1 of 4", { selector: "p" })).toBeTruthy());
  });

  it("shows each item once at a time; the cards beside and behind the viewer are hidden", async () => {
    const { region } = ring("still");
    expect(region.querySelectorAll("[data-ui=ring-slot]")).toHaveLength(8);
    // Ahead and ±45° are seen (alpha, beta, delta); the rest are hidden from the keyboard and screen readers.
    await waitFor(() => expect(region.querySelectorAll("[data-ui=ring-slot]:not([aria-hidden])")).toHaveLength(3));
    for (const name of ["alpha", "beta", "delta"]) expect(screen.getAllByRole("button", { name: `Card ${name}` })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Card gamma" })).toBeNull();
  });

  it("works with a single card", () => {
    const { onOpen } = ring("full", ["solo"]);
    fireEvent.click(screen.getByRole("button", { name: "Card solo" }));
    expect(onOpen).toHaveBeenCalledWith("solo");
  });
});

describe("ringSizes", () => {
  it.each([
    { width: 1200, slots: 10, card: 288 },
    { width: 1600, slots: 10, card: 300 },
    { width: 375, slots: 10, card: 225 },
  ])("$width px, $slots slots", ({ width, slots, card }) => {
    const s = ringSizes(width, slots);
    expect(s.card).toBe(card);
    expect(s.height).toBeCloseTo(card * ASPECT);
    // The card ahead fits across a phone with the 16 px gutters.
    expect(s.card).toBeLessThanOrEqual(width - 32);
  });
});
