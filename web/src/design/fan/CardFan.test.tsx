import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardFan, cardWidthFor, FAN_SIZE, fanSizeFor, GAP, hitFor, poseFor, SCALE, spacingFor, STRIP_BELOW, TILTED_HALF } from "./CardFan";

const five = ["alpha", "beta", "gamma", "delta", "epsilon"];

function fan(items = five) {
  const onOpen = vi.fn();
  render(
    <CardFan
      items={items}
      keyOf={(s) => s}
      label="Things"
      motion="still"
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

const cardOf = (name: string) => screen.getByRole("button", { name: `Card ${name}` }).closest("[data-ui=fan-card]") as HTMLElement;
/** Where the pointer is read for a card: its place in the layer over the fan, in the same order. */
const hitOf = (name: string) => document.querySelectorAll<HTMLElement>("[data-ui=fan-hit]")[screen.getAllByRole("button").findIndex((b) => b.textContent === name)];
const expanded = () => [...document.querySelectorAll("[data-ui=fan-card][data-expanded]")].map((li) => li.textContent);
const mouse = { pointerType: "mouse", buttons: 0 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.input;
});

describe("CardFan", () => {
  it("lays the cards in order, and a click on any of them opens it", () => {
    const { onOpen } = fan();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(five);
    fireEvent.click(screen.getByRole("button", { name: "Card delta" }));
    expect(onOpen).toHaveBeenCalledWith("delta");
    // A mouse clicks the card's hit area, not the card.
    fireEvent.click(hitOf("beta"));
    expect(onOpen).toHaveBeenLastCalledWith("beta");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("opens up the card under a mouse at once, far above the rest, and closes it when the mouse leaves", () => {
    fan();
    const places = five.map((n) => cardOf(n).style.left);
    const hits = () => five.map((n) => [hitOf(n).style.left, hitOf(n).style.width].join(" "));
    const resting = hits();
    const restingWidth = parseFloat(hitOf("gamma").style.width);
    fireEvent.pointerEnter(hitOf("gamma"), mouse);
    expect(expanded()).toEqual(["gamma"]);
    expect(Number(cardOf("gamma").style.zIndex)).toBeGreaterThan(FAN_SIZE * 2);
    // The places never move. The open card is read over all of itself.
    expect(five.map((n) => cardOf(n).style.left)).toEqual(places);
    expect(parseFloat(hitOf("gamma").style.width)).toBeGreaterThan(restingWidth);
    fireEvent.pointerLeave(hitOf("gamma"), mouse);
    expect(expanded()).toEqual([]);
    expect(hits()).toEqual(resting);
    expect(cardOf("gamma").style.zIndex).toBe("3");
  });

  it("goes from one card to the next as one change", () => {
    fan();
    fireEvent.pointerEnter(hitOf("beta"), mouse);
    fireEvent.pointerEnter(hitOf("gamma"), mouse);
    expect(expanded()).toEqual(["gamma"]);
    // A leave that arrives late, for a card already left, closes nothing.
    fireEvent.pointerLeave(hitOf("beta"), mouse);
    expect(expanded()).toEqual(["gamma"]);
  });

  it("reads each card's visible part: up to where the next one starts, and all of the last", () => {
    fan();
    // Nothing has a size here, so the fan is laid out for its first guess of 1024 px.
    const apart = spacingFor(1024, cardWidthFor(1024, five.length), five.length);
    expect(hitOf("alpha").style.left).toBe(cardOf("alpha").style.left);
    expect(parseFloat(hitOf("alpha").style.width)).toBeCloseTo(apart);
    expect(parseFloat(hitOf("beta").style.width)).toBeCloseTo(apart);
    expect(hitOf("epsilon").style.width).toBe(cardOf("epsilon").style.width);
  });

  it.each([
    { name: "a finger", pointer: { pointerType: "touch", buttons: 0 } },
    { name: "a held button", pointer: { pointerType: "mouse", buttons: 1 } },
  ])("doesn't open up for $name", ({ pointer }) => {
    fan();
    fireEvent.pointerEnter(hitOf("alpha"), pointer);
    fireEvent.pointerMove(hitOf("alpha"), pointer);
    expect(expanded()).toEqual([]);
  });

  it("opens up for the keyboard's focus, and not for the focus a click leaves", () => {
    fan();
    document.documentElement.dataset.input = "keyboard";
    act(() => screen.getByRole("button", { name: "Card beta" }).focus());
    expect(expanded()).toEqual(["beta"]);
    act(() => screen.getByRole("button", { name: "Card gamma" }).focus());
    expect(expanded()).toEqual(["gamma"]);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(expanded()).toEqual([]);

    document.documentElement.dataset.input = "pointer";
    act(() => screen.getByRole("button", { name: "Card alpha" }).focus());
    expect(expanded()).toEqual([]);
  });

  it("starts another fan after six", () => {
    const { region } = fan([...five, "zeta", "eta", "theta"]);
    expect([...region.querySelectorAll("ul")].map((ul) => ul.children.length)).toEqual([FAN_SIZE, 2]);
    fireEvent.pointerEnter(hitOf("eta"), mouse);
    expect(expanded()).toEqual(["eta"]);
  });

  it("stands the cards straight in one scrolling row when narrow, where a tap opens", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(351);
    const { region, onOpen } = fan([...five, "zeta", "eta"]);
    expect(region.dataset.layout).toBe("strip");
    expect(region.querySelectorAll("ul")).toHaveLength(1);
    expect(region.querySelector("[data-ui=fan-pose], [data-ui=fan-hit]")).toBeNull();
    fireEvent.pointerEnter(cardOf("alpha"), mouse);
    expect(expanded()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Card eta" }));
    expect(onOpen).toHaveBeenCalledWith("eta");
  });
});

describe("poseFor", () => {
  const rest = 1 / SCALE;
  const spacing = 144;
  it.each([
    { name: "at rest: tilted, in place, scaled down", i: 0, open: -1, side: 0, y: 10, rotate: -8, scale: rest },
    { name: "the expanded card: straight, full size and a little up", i: 2, open: 2, side: 0, y: -8, rotate: 0, scale: 1 },
    { name: "one to its left moves left", i: 0, open: 2, side: -1, y: 10, rotate: -8, scale: rest },
    { name: "one to its right moves right", i: 4, open: 2, side: 1, y: -2, rotate: -5, scale: rest },
  ])("$name", ({ i, open, side, y, rotate, scale }) => {
    const got = poseFor(i, open, 5, 200, spacing);
    expect(Math.sign(got.x)).toBe(side);
    expect([got.y, got.rotate, got.scale]).toEqual([y, rotate, scale]);
  });

  it("stands one card straight", () => {
    expect(poseFor(0, -1, 1, 200, 0).rotate).toBe(0);
  });
});

// Widths a fan is laid out for, with as many cards as it can hold there and fewer.
const layouts = [STRIP_BELOW, 760, 900, 1180, 1400].flatMap((width) =>
  [1, 2, 3, 5, 6].filter((count) => count <= fanSizeFor(width)).map((count) => ({ width, count })),
);

describe("the fan's sizes", () => {
  it.each([
    { width: STRIP_BELOW, want: 3 },
    { width: 770, want: 4 },
    { width: 900, want: 5 },
    { width: 1024, want: FAN_SIZE },
    { width: 2000, want: FAN_SIZE },
  ])("takes $want cards to a fan at $width px", ({ width, want }) => {
    expect(fanSizeFor(width)).toBe(want);
  });

  it.each(layouts)("$count cards at $width px: a clear gap beside whichever is open, and nothing past the edges", ({ width, count }) => {
    const card = cardWidthFor(width, count);
    const spacing = spacingFor(width, card, count);
    expect(card).toBeGreaterThanOrEqual(180);
    expect(card).toBeLessThanOrEqual(260);
    if (count > 1) expect(spacing).toBeGreaterThanOrEqual(card * 0.5 - 0.01); // each covered card still shows a part
    const start = -(spacing * (count - 1) + card) / 2;
    for (let open = 0; open < count; open++) {
      // Each card's left and right edge on screen, measured from the middle of the fan.
      const edges = Array.from({ length: count }, (_, i) => {
        const pose = poseFor(i, open, count, card, spacing);
        const middle = start + i * spacing + card / 2 + pose.x;
        const half = i === open ? (card * SCALE) / 2 : card * TILTED_HALF;
        return [middle - half, middle + half];
      });
      for (const [left, right] of edges) {
        expect(left).toBeGreaterThanOrEqual(-width / 2 - 0.01);
        expect(right).toBeLessThanOrEqual(width / 2 + 0.01);
      }
      if (open > 0) expect(edges[open][0] - edges[open - 1][1]).toBeGreaterThanOrEqual(card * GAP - 0.01);
      if (open < count - 1) expect(edges[open + 1][0] - edges[open][1]).toBeGreaterThanOrEqual(card * GAP - 0.01);
    }
  });
});

describe("hitFor", () => {
  it("at rest is each card's visible part: up to the next one, and all of the last", () => {
    expect([0, 1, 2].map((i) => hitFor(i, -1, 3, 200, 144))).toEqual([
      { left: 0, width: 144 },
      { left: 144, width: 144 },
      { left: 288, width: 200 },
    ]);
  });

  // If opening a card moved its area from under a still pointer, another would open, and so on.
  it.each(layouts.filter((l) => l.count > 1))("$count cards at $width px: what opens under a still pointer stays open", ({ width, count }) => {
    const card = cardWidthFor(width, count);
    const spacing = spacingFor(width, card, count);
    const span = (i: number, open: number) => {
      const hit = hitFor(i, open, count, card, spacing);
      return [hit.left, hit.left + hit.width];
    };
    for (let open = -1; open < count; open++) {
      // The areas that can be under the pointer while `open` is: all of them at rest, else the three on top.
      const reachable = Array.from({ length: count }, (_, i) => i).filter((i) => open < 0 || Math.abs(i - open) <= 1);
      for (const next of reachable) {
        const [from, to] = span(next, open);
        const [heldFrom, heldTo] = span(next, next);
        expect(from).toBeGreaterThanOrEqual(heldFrom - 0.01);
        expect(to).toBeLessThanOrEqual(heldTo + 0.01);
      }
    }
  });
});
