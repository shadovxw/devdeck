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

/**
 * Card width, the ring's radius and the stage height for a container width and a number of slots.
 * The perspective equals the radius, so the card ahead shows at its own size.
 */
export function ringSizes(width: number, slots: number) {
  const narrow = width < 768;
  const card = narrow ? Math.min(240, width * 0.6) : Math.min(300, Math.max(220, width * 0.24));
  const height = card * ASPECT;
  const radius = panoramaRadius(slots, card, card * 0.3);
  // The cards at the sides swing in larger than the one ahead; the stage crops them, as a panorama does.
  return { card, height, radius, stage: Math.round(height * 1.22 + 48) };
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
  const [width, setWidth] = useState(1024);
  const [active, setActive] = useState(0);
  const [ring] = useState(() => new RingController(setActive));
  const { card, height, radius, stage } = ringSizes(width, slots);
  const front = Math.min(active, Math.max(slots - 1, 0));
  const frontItem = itemOf(front, n);

  // Size from the container.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 1024);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 1024));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
      className="relative w-full touch-pan-y select-none overflow-hidden"
      style={{ height: stage, perspective: `${radius}px` }}
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
