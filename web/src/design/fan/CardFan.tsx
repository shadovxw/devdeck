import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent, type ReactNode } from "react";

/**
 * How much the cards may move: full bounces (and bounces in on arrival), reduced eases, still changes at
 * once (Effects off, or the OS asks for reduced motion).
 */
export type CardMotion = "full" | "reduced" | "still";

/** Tall cards: height over width. */
export const ASPECT = 1.45;
/** The most cards in one fan; more start another fan below. */
export const FAN_SIZE = 6;
/** Narrower than this, a fan doesn't fit: the cards stand straight in a row that scrolls sideways. */
export const STRIP_BELOW = 600;
/** How long the pointer rests on a card before it opens up, so a passing pointer doesn't flicker it. */
export const HOVER_MS = 120;

const MAX_CARD = 260;
const MIN_CARD = 180;
/** How far apart neighbours stand, in card widths: each covers the right of the one before. */
const OVERLAP = 0.72;
/** How far the others move aside for an expanded card, in card widths. */
const PUSH = 0.28;
/** Room kept at each end, in card widths, for a card that has moved aside and is tilted. */
const SIDE = 0.4;
/** How far an expanded card reaches past its resting size on each side: 1.2 times as wide, 1.18 as tall. */
const GROW_X = 0.1;
const GROW_Y = 0.09;
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

const chunk = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

/**
 * Which card is expanded (null for none): the one a mouse or pen has rested on, else the one with the
 * keyboard's focus. A finger has no hover, so a tap just opens. The handlers go on each card's place in
 * the fan, which doesn't move: the card inside it does, so a card never slips out from under the pointer.
 */
function useExpanded() {
  const [over, setOver] = useState<number | null>(null);
  const [rested, setRested] = useState<number | null>(null);
  const [keyed, setKeyed] = useState<number | null>(null);
  useEffect(() => {
    if (over === null) return;
    const timer = setTimeout(() => setRested(over), HOVER_MS);
    return () => clearTimeout(timer);
  }, [over]);

  const point = (card: number) => (e: PointerEvent) => {
    // A held button is a press or a drag, not a hover.
    if (e.pointerType !== "touch" && e.buttons === 0) setOver(card);
  };
  return {
    expanded: rested !== null && rested === over ? rested : keyed,
    handlers: (card: number) => ({
      onPointerEnter: point(card),
      onPointerMove: point(card),
      onPointerLeave: () => {
        setOver(null);
        setRested(null);
      },
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
 * Bits' "Bounce Cards"; our own code). The card the pointer rests on straightens, comes to the front and
 * grows, and the others in its fan move aside. A click on any card opens it. On a narrow screen the cards
 * stand straight in a row that scrolls.
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
        chunk(items, FAN_SIZE).map((fan, row) => {
          const spacing = spacingFor(width, card, fan.length);
          const left = -(spacing * (fan.length - 1) + card) / 2;
          const first = row * FAN_SIZE;
          // The expanded card's place in this fan, or -1 when it is in another or there is none.
          const open = hover.expanded === null ? -1 : fan.findIndex((_, i) => first + i === hover.expanded);
          return (
            <ul key={keyOf(fan[0])} className="relative m-0 list-none overflow-hidden p-0" style={{ height: height * (1 + 2 * GROW_Y) + 48 }}>
              {fan.map((item, i) => {
                const expanded = i === open;
                const aside = open < 0 || expanded ? 0 : Math.sign(i - open) * card * PUSH;
                const tilt = fan.length > 1 ? TILT[i] : 0;
                return (
                  <li
                    key={keyOf(item)}
                    data-ui="fan-card"
                    data-expanded={expanded || undefined}
                    // The last card has nothing over it; the others show this much of themselves.
                    data-covered={i < fan.length - 1 || undefined}
                    className="absolute"
                    style={{ left: `calc(50% + ${left + i * spacing}px)`, top: `calc(50% - ${height / 2}px)`, width: card, height, zIndex: expanded ? FAN_SIZE + 1 : i + 1, "--i": i, "--strip": `${spacing}px` } as CSSProperties}
                    onClick={() => onOpen(item)}
                    {...hover.handlers(first + i)}
                  >
                    <div data-ui="fan-pose" className="h-full w-full" style={{ transform: expanded ? "none" : `translate(${aside}px, ${DROP[i]}px) rotate(${tilt}deg)` }}>
                      {/* Grows by its real size, not by scale: scaled text blurs. */}
                      <div data-ui="fan-grow" className="absolute" style={{ inset: expanded ? `${-height * GROW_Y}px ${-card * GROW_X}px` : "0px" }}>
                        {renderItem(item)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          );
        })
      )}
    </section>
  );
}
