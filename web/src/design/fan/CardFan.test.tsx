import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CardFan, cardWidthFor, FAN_SIZE, HOVER_MS, spacingFor } from "./CardFan";

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
const poseOf = (name: string) => (cardOf(name).querySelector("[data-ui=fan-pose]") as HTMLElement).style.transform;
const growOf = (name: string) => (cardOf(name).querySelector("[data-ui=fan-grow]") as HTMLElement).style.inset;
const expanded = () => [...document.querySelectorAll("[data-ui=fan-card][data-expanded]")].map((li) => li.textContent);
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const mouse = { pointerType: "mouse", buttons: 0 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.input;
});

describe("CardFan", () => {
  it("lays the cards in order, tilted, and a click on any of them opens it", () => {
    const { onOpen } = fan();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(five);
    expect(poseOf("alpha")).toContain("rotate(-8deg)");
    fireEvent.click(screen.getByRole("button", { name: "Card delta" }));
    expect(onOpen).toHaveBeenCalledWith("delta");
    // The card's own place opens it too: its tilted corners leave parts the button doesn't cover.
    fireEvent.click(cardOf("beta"));
    expect(onOpen).toHaveBeenLastCalledWith("beta");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("opens up the card a mouse rests on: straight, larger, on top, the others aside", () => {
    fan();
    const resting = five.map(poseOf);
    const places = five.map((n) => cardOf(n).style.left);
    fireEvent.pointerEnter(cardOf("gamma"), mouse);
    wait(HOVER_MS - 1);
    expect(expanded()).toEqual([]); // a passing pointer does nothing
    wait(1);
    expect(expanded()).toEqual(["gamma"]);
    expect(poseOf("gamma")).toBe("none");
    expect(growOf("gamma")).toMatch(/^-\d/);
    expect(Number(cardOf("gamma").style.zIndex)).toBeGreaterThan(Number(cardOf("epsilon").style.zIndex));
    expect(poseOf("beta")).toMatch(/translate\(-\d/); // to the left
    expect(poseOf("delta")).toMatch(/translate\(\d/); // to the right
    // The places themselves never move, so a card can't slip out from under the pointer.
    expect(five.map((n) => cardOf(n).style.left)).toEqual(places);

    fireEvent.pointerLeave(cardOf("gamma"), mouse);
    expect(expanded()).toEqual([]);
    expect(five.map(poseOf)).toEqual(resting);
    expect(growOf("gamma")).toBe("0px");
    // Coming back waits again.
    fireEvent.pointerEnter(cardOf("gamma"), mouse);
    expect(expanded()).toEqual([]);
  });

  it.each([
    { name: "a finger", pointer: { pointerType: "touch", buttons: 0 } },
    { name: "a held button", pointer: { pointerType: "mouse", buttons: 1 } },
  ])("doesn't open up for $name", ({ pointer }) => {
    fan();
    fireEvent.pointerEnter(cardOf("alpha"), pointer);
    fireEvent.pointerMove(cardOf("alpha"), pointer);
    wait(HOVER_MS * 3);
    expect(expanded()).toEqual([]);
  });

  it("opens up at once for the keyboard's focus, and not for the focus a click leaves", () => {
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

  it("starts another fan after six, and moves only its own fan's cards", () => {
    const many = [...five, "zeta", "eta", "theta"];
    const { region } = fan(many);
    const fans = [...region.querySelectorAll("ul")];
    expect(fans.map((ul) => ul.children.length)).toEqual([FAN_SIZE, 2]);
    const other = poseOf("alpha");
    fireEvent.pointerEnter(cardOf("eta"), mouse);
    wait(HOVER_MS);
    expect(expanded()).toEqual(["eta"]);
    expect(poseOf("alpha")).toBe(other);
    expect(poseOf("theta")).toMatch(/translate\(\d/);
  });

  it("shows one card straight", () => {
    fan(["solo"]);
    expect(poseOf("solo")).toContain("rotate(0deg)");
  });

  it("stands the cards straight in one scrolling row when narrow, where a tap opens", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(351);
    const { region, onOpen } = fan([...five, "zeta", "eta"]);
    expect(region.dataset.layout).toBe("strip");
    expect(region.querySelectorAll("ul")).toHaveLength(1);
    expect(region.querySelector("[data-ui=fan-pose]")).toBeNull();
    fireEvent.pointerEnter(cardOf("alpha"), mouse);
    wait(HOVER_MS * 3);
    expect(expanded()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Card eta" }));
    expect(onOpen).toHaveBeenCalledWith("eta");
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
