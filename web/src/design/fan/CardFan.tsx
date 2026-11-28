import { LazyMotion, m } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from "react";

import { cardPop, cardSpring } from "../../lib/motion";

/**
 * How much the cards may move: full springs a little past and back (and the cards bounce in on arrival),
 * reduced settles without passing, still changes at once (Effects off, or the OS asks for reduced motion).
 */
export type CardMotion = "full" | "reduced" | "still";

/** Tall cards: height over width. */
export const ASPECT = 1.45;
/** The most cards in one fan; more start another fan below. */
export const FAN_SIZE = 6;
/** Narrower than this, a fan doesn't fit: the cards stand straight in a row that scrolls sideways. */
export const STRIP_BELOW = 600;
/** How much larger an expanded card is than one at rest. */
export const SCALE = 1.18;

const MAX_CARD = 260;
const MIN_CARD = 180;
/** How far apart neighbours stand, in card widths: each covers the right of the one before. */
const OVERLAP = 0.72;
/** How far the others move aside for an expanded card, in card widths. */
const PUSH = 0.28;
/** Room kept at each end, in card widths, for a card that has moved aside and is tilted. */
const SIDE = 0.4;
/** How far an expanded card reaches past its place on each side, in its own size. */
const GROW = (SCALE - 1) / 2;
/** How far the expanded card rises, in card widths. */
const LIFT = 0.04;
// By place in the fan: degrees of tilt, and pixels down from the line.
const TILT = [-8, 4, -2, 6, -5, 3];
const DROP = [10, 2, -4, 6, -2, 8];

/** The card's width for the space there is, with this many cards in the fullest fan. */
export function cardWidthFor(width: number, count: number): number {
  return Math.min(MAX_CARD, Math.max(MIN_CARD, width / (OVERLAP * (count - 1) + 1 + 2 * SIDE)));
}

/** How far apart a fan's cards stand: the usual overlap, or closer when they wouldn't fit. */
export function spacingFor(width: number, card: number, count: number): number {
  if (count < 2) return 0;
  return Math.min(card * OVERLAP, (width - card * (1 + 2 * SIDE)) / (count - 1));
}

/**
 * Where the card at place i of a fan stands, with the card at `open` expanded (-1 for none). A card is
 * drawn at its expanded size, so that is scale 1 and sharp; at rest it is scaled down into its place.
 */
export function poseFor(i: number, open: number, count: number, card: number) {
  if (i === open) return { x: 0, y: -card * LIFT, rotate: 0, scale: 1 };
  return {
    x: open < 0 ? 0 : Math.sign(i - open) * card * PUSH,
    y: DROP[i],
    rotate: count > 1 ? TILT[i] : 0,
    scale: 1 / SCALE,
  };
}

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const loadFeatures = () => import("../../lib/motion-features").then((mod) => mod.default);

/**
 * The part of a card that moves. It has its own layer while it moves, and not once it rests, so the
 * browser then draws it sharp again.
 */
function Pose({ to, motion, children }: Readonly<{ to: ReturnType<typeof poseFor>; motion: CardMotion; children: ReactNode }>) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = (on: boolean) => {
    if (ref.current) ref.current.style.willChange = on ? "transform" : "";
  };
  return (
    <m.div
      ref={ref}
      data-ui="fan-pose"
      className="h-full w-full"
      initial={false}
      animate={to}
      transition={{ ...cardSpring[motion], scale: cardPop[motion] }}
      onAnimationStart={() => layer(true)}
      onAnimationComplete={() => layer(false)}
    >
      {children}
    </m.div>
  );
}

/**
 * Which card is expanded (null for none): the one under a mouse or pen, else the one with the keyboard's
 * focus. A finger has no hover, so a tap just opens. The pointer handlers go on the fan's hit areas, which
 * never move (below), and the focus handlers on the cards' places.
 */
function useExpanded() {
  const [over, setOver] = useState<number | null>(null);
  const [keyed, setKeyed] = useState<number | null>(null);
  const point = (card: number) => (e: PointerEvent) => {
    // A held button is a press or a drag, not a hover.
    if (e.pointerType !== "touch" && e.buttons === 0) setOver(card);
  };
  return {
    expanded: over ?? keyed,
    pointer: (card: number) => ({
      onPointerEnter: point(card),
      onPointerMove: point(card),
      onPointerLeave: () => setOver((now) => (now === card ? null : now)),
    }),
    focus: (card: number) => ({
      onFocus: () => {
        if (document.documentElement.dataset.input === "keyboard") setKeyed(card);
      },
      onBlur: (e: FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setKeyed(null);
      },
    }),
  };
}

type Props<T> = {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  /** A click (or Enter) on a card. */
  onOpen: (item: T) => void;
  label: string;
  motion: CardMotion;
};

/**
 * Cards in a still, overlapping fan (dev-plans/2026-11-28-project-posters §4, after the look of React
 * Bits' "Bounce Cards"; our own code). The card under the pointer straightens, comes to the front and
 * grows, and the others in its fan move aside. Only transforms move, on springs, so nothing is laid out
 * again while it does. A click on any card opens it. On a narrow screen the cards stand straight in a row
 * that scrolls.
 */
export function CardFan<T>({ items, keyOf, renderItem, onOpen, label, motion }: Readonly<Props<T>>) {
  const rootRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(1024);
  const hover = useExpanded();

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 1024);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width || 1024));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const strip = width < STRIP_BELOW;
  const card = strip ? Math.min(MAX_CARD, width * 0.72) : cardWidthFor(width, Math.min(items.length, FAN_SIZE));
  const height = card * ASPECT;

  return (
    <section ref={rootRef} aria-label={label} data-ui="fan" data-layout={strip ? "strip" : "fan"} data-motion={motion} className="w-full min-w-0">
      {strip ? (
        <ul className="m-0 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-3">
          {items.map((item) => (
            <li key={keyOf(item)} data-ui="fan-card" className="flex-none snap-center" style={{ width: card, height }} onClick={() => onOpen(item)}>
              {renderItem(item)}
            </li>
          ))}
        </ul>
      ) : (
        <LazyMotion features={loadFeatures} strict>
          {chunk(items, FAN_SIZE).map((fan, row) => {
            const spacing = spacingFor(width, card, fan.length);
            const left = -(spacing * (fan.length - 1) + card) / 2;
            const first = row * FAN_SIZE;
            // The expanded card's place in this fan, or -1 when it is in another or there is none.
            const open = hover.expanded === null ? -1 : fan.findIndex((_, i) => first + i === hover.expanded);
            return (
              <div key={keyOf(fan[0])} className="relative">
                <ul className="relative m-0 list-none overflow-hidden p-0" style={{ height: height * SCALE + 48 }}>
                  {fan.map((item, i) => (
                    <li
                      key={keyOf(item)}
                      data-ui="fan-card"
                      data-expanded={i === open || undefined}
                      // The last card has nothing over it; the others show this much of themselves.
                      data-covered={i < fan.length - 1 || undefined}
                      className="absolute"
                      style={
                        {
                          left: `calc(50% + ${left + i * spacing}px)`,
                          top: `calc(50% - ${height / 2}px)`,
                          width: card,
                          height,
                          // The expanded card is far above the rest, so one that is on its way down stays over them (pieces.css).
                          zIndex: i === open ? FAN_SIZE * 3 : i + 1,
                          "--i": i,
                          // In the card's own size, which is SCALE times its place.
                          "--strip": `${spacing * SCALE}px`,
                        } as CSSProperties
                      }
                      // A mouse never reaches this (the hit areas lie over it): it is the keyboard's Enter.
                      onClick={() => onOpen(item)}
                      {...hover.focus(first + i)}
                    >
                      <Pose to={poseFor(i, open, fan.length, card)} motion={motion}>
                        {/* Always the expanded size: only the pose's scale changes, so nothing inside is laid out again. */}
                        <div data-ui="fan-grow" className="absolute" style={{ inset: `${-height * GROW}px ${-card * GROW}px` }}>
                          {renderItem(item)}
                        </div>
                      </Pose>
                    </li>
                  ))}
                </ul>
                {/* Where each card shows at rest. The pointer and clicks are read here, over everything and never
                    moving, so no card, open or moving, can cover its neighbour's place or slide from under the pointer. */}
                <div aria-hidden data-ui="fan-hits" className="pointer-events-none absolute inset-0">
                  {fan.map((item, i) => (
                    <span
                      key={keyOf(item)}
                      data-ui="fan-hit"
                      className="pointer-events-auto absolute cursor-pointer"
                      style={{ left: `calc(50% + ${left + i * spacing}px)`, top: `calc(50% - ${height / 2}px)`, width: i < fan.length - 1 ? spacing : card, height }}
                      onClick={() => onOpen(item)}
                      {...hover.pointer(first + i)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </LazyMotion>
      )}
    </section>
  );
}
