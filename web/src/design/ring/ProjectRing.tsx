import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { RingController, type RingMotion } from "./ring-controller";
import { itemOf, panoramaRadius, slotsFor } from "./ring-math";

export type { RingMotion } from "./ring-controller";

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  /** The item's name, for the live region and each card's label ("acme, 2 of 5"). */
  nameOf: (item: T) => string;
  renderItem: (item: T, s: { active: boolean }) => ReactNode;
  /** A click (or Enter) on the card ahead. */
  onOpen: (item: T) => void;
  label: string;
  motion: RingMotion;
};

/** Tall cards: height over width. */
export const ASPECT = 1.45;

/** The ring's height before it has been measured (and in tests, where nothing has a size). */
const FALLBACK_HEIGHT = 600;

/**
 * Card size and the ring's radius for the space the ring has. The card ahead takes about three
 * quarters of the height (up to 680 px), keeps its tall shape, and is never wider than 30% of the
 * width (60% on a phone). The perspective equals the radius, so the card ahead shows at that size;
 * the cards at the sides swing in larger and the stage crops them, as a panorama does.
 */
export function ringSizes(width: number, height: number, slots: number) {
  const h = height > 0 ? height : FALLBACK_HEIGHT;
  let cardHeight = Math.min(h * 0.74, 680);
  let card = cardHeight / ASPECT;
  const widest = width * (width < 768 ? 0.6 : 0.3);
  if (card > widest) {
    card = widest;
    cardHeight = card * ASPECT;
  }
  return { card, height: cardHeight, radius: panoramaRadius(slots, card, card * 0.3) };
}

/**
 * The Projects ring (dev-plans/2026-11-28-projects-ring, after React Bits' "Circular Carousel",
 * panorama preset): the viewer stands inside a ring of tall cards. Drag it (with momentum), use the
 * arrows, or click a card to bring it ahead; the card ahead opens. A few items repeat round the
 * ring so it closes. It drifts slowly while nothing touches it, and stands still with Effects off
 * or reduced motion.
 */
export function ProjectRing<T>({ items, keyOf, nameOf, renderItem, onOpen, label, motion }: Readonly<Props<T>>) {
  const n = items.length;
  const slots = slotsFor(n);
  const rootRef = useRef<HTMLElement>(null);
  const [box, setBox] = useState({ width: 1024, height: 0 });
  const [active, setActive] = useState(0);
  const [ring] = useState(() => new RingController(setActive));
  const { card, height, radius } = ringSizes(box.width, box.height, slots);
  const front = Math.min(active, Math.max(slots - 1, 0));
  const frontItem = itemOf(front, n);

  // Size from the space the page gives the ring (it grows to fill what is left below the header).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setBox({ width: el.clientWidth || 1024, height: el.clientHeight });
    const ro = new ResizeObserver(([e]) => setBox({ width: e.contentRect.width || 1024, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Arriving on the page, the ring spins in to the first project (only with full motion).
  useEffect(() => {
    if (motion === "full") ring.spinIn(-60);
    // Once, on arrival: a later change of Effects doesn't replay it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ring]);
  // After each render: the controller gets the new numbers, and the cards their places before paint.
  useLayoutEffect(() => {
    ring.update(slots, radius, motion);
    ring.apply();
    ring.wake();
  });
  useEffect(() => {
    const onVisible = () => ring.wake();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      ring.stop();
    };
  }, [ring]);

  // Keyboard: the focus follows the card ahead.
  const followFocus = useRef(false);
  useEffect(() => {
    if (!followFocus.current) return;
    followFocus.current = false;
    ring.slots[front]?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
  }, [front, ring]);

  return (
    <section
      ref={rootRef}
      aria-roledescription="carousel"
      aria-label={label}
      data-ui="ring"
      data-motion={motion}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (!step || slots < 2) return;
        e.preventDefault();
        followFocus.current = true;
        ring.goTo(ring.front + step);
      }}
      onPointerDown={(e) => ring.pointerDown(e.clientX, e.button)}
      onPointerMove={(e) => {
        if (ring.pointerMove(e.clientX)) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={() => ring.pointerUp()}
      onPointerCancel={() => ring.pointerUp()}
      onPointerEnter={() => ring.setHover(true)}
      onPointerLeave={() => ring.setHover(false)}
      onFocus={() => ring.setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) ring.setFocus(false);
      }}
      onWheel={(e) => {
        // Only sideways scrolling turns the ring; up and down still scroll the page.
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) ring.wheel(e.deltaX);
      }}
      className="relative min-h-[22rem] w-full flex-1 touch-pan-y select-none overflow-hidden"
      style={{ perspective: `${radius}px` }}
    >
      {/* The stage sits at the camera, so the cards pushed out by the radius surround the viewer. */}
      <ul className="absolute left-1/2 top-1/2 m-0 list-none p-0" style={{ transformStyle: "preserve-3d", transform: `translateZ(${radius}px)` }}>
        {Array.from({ length: slots }, (_, slot) => {
          const i = itemOf(slot, n);
          const item = items[i];
          return (
            <li
              key={`${keyOf(item)}#${Math.floor(slot / Math.max(n, 1))}`}
              ref={(el) => ring.setSlot(slot, el)}
              data-ui="ring-slot"
              data-active={slot === front || undefined}
              aria-roledescription="slide"
              aria-label={`${nameOf(item)}, ${i + 1} of ${n}`}
              className="absolute left-0 top-0"
              style={{ width: card, height }}
              onClickCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (ring.click(slot)) onOpen(item);
              }}
            >
              {renderItem(item, { active: slot === front })}
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">
        {n > 0 ? `${nameOf(items[frontItem])}, ${frontItem + 1} of ${n}` : ""}
      </p>
    </section>
  );
}
