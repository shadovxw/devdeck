import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CardFan, cardWidthFor, FAN_SIZE, poseFor, SCALE, spacingFor } from "./CardFan";

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
    fireEvent.pointerEnter(hitOf("gamma"), mouse);
    expect(expanded()).toEqual(["gamma"]);
    expect(Number(cardOf("gamma").style.zIndex)).toBeGreaterThan(FAN_SIZE * 2);
    // Neither the places nor the hit areas move, so a card can't slip out from under the pointer.
    expect(five.map((n) => cardOf(n).style.left)).toEqual(places);
    expect(hits()).toEqual(resting);
    fireEvent.pointerLeave(hitOf("gamma"), mouse);
    expect(expanded()).toEqual([]);
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
  it.each([
    { name: "at rest: tilted, in place, scaled down", i: 0, open: -1, want: { x: 0, y: 10, rotate: -8, scale: rest } },
    { name: "the expanded card: straight, full size and a little up", i: 2, open: 2, want: { x: 0, y: -8, rotate: 0, scale: 1 } },
    { name: "one to its left moves left", i: 0, open: 2, want: { x: -56, y: 10, rotate: -8, scale: rest } },
    { name: "one to its right moves right", i: 4, open: 2, want: { x: 56, y: -2, rotate: -5, scale: rest } },
  ])("$name", ({ i, open, want }) => {
    const got = poseFor(i, open, 5, 200);
    expect(got.x).toBeCloseTo(want.x);
    expect([got.y, got.rotate, got.scale]).toEqual([want.y, want.rotate, want.scale]);
  });

  it("stands one card straight", () => {
    expect(poseFor(0, -1, 1, 200).rotate).toBe(0);
  });
});

describe("the fan's sizes", () => {
  it.each([
    { width: 1400, count: 5 },
    { width: 1180, count: 6 },
    { width: 900, count: 6 },
    { width: 720, count: 6 },
    { width: 600, count: 6 },
    { width: 600, count: 2 },
    { width: 1400, count: 1 },
  ])("$count cards fit in $width px, with room at the ends for one that moved aside", ({ width, count }) => {
    const card = cardWidthFor(width, count);
    const spacing = spacingFor(width, card, count);
    const used = spacing * (count - 1) + card;
    expect(card).toBeGreaterThanOrEqual(180);
    expect(card).toBeLessThanOrEqual(260);
    expect((width - used) / 2).toBeGreaterThanOrEqual(card * 0.39);
    if (count > 1) expect(spacing).toBeGreaterThan(40); // each covered card still shows a part
  });
});
