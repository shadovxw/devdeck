/**
 * The geometry of the Projects ring (dev-plans/2026-11-28-projects-ring): a panorama, like React Bits'
 * "Circular Carousel" in its panorama preset. The viewer stands at the centre of a circle and the
 * cards stand on its inside wall, facing in: the card ahead is straight in front, the ones to the
 * sides swing in large at the edges. Angles are in degrees; 0 is straight ahead, positive is to the
 * right. Pure functions, so they test without a DOM.
 */

/** Wraps an angle into [-180, 180). */
export function wrap(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** Degrees between two neighbouring slots. */
export const stepOf = (count: number) => 360 / Math.max(count, 1);

/** From this many items the ring closes on its own; fewer show twice, half a turn apart. */
export const FULL_RING = 10;

/**
 * How many slots the ring has for n items. Under FULL_RING the items show twice, the second time
 * half a turn round, so the ring still closes and the two copies of an item are never in view
 * together (they are 180° apart; the view is 2 × SEEN_WITHIN = 156°). Two items get three rounds
 * (60° apart), or the one beside the card ahead would be edge-on and hidden: there, the other item
 * shows on both sides. One item stays one card.
 */
export function slotsFor(n: number): number {
  if (n < 2 || n >= FULL_RING) return n;
  return n === 2 ? 6 : n * 2;
}

/** The circle's radius: the slots side by side, each a card plus the gap, make its circumference. */
export function panoramaRadius(slots: number, card: number, gap: number): number {
  if (slots < 2) return card;
  // A small ring would put the viewer's nose on the cards: never closer than 1.6 cards.
  return Math.max((slots * (card + gap)) / (2 * Math.PI), card * 1.6);
}

/** Where slot i is when the ring is turned by rotation. */
export const angleOf = (i: number, count: number, rotation: number) => wrap(i * stepOf(count) + rotation);

/** The slot straight ahead. */
export function nearestIndex(rotation: number, count: number): number {
  if (count <= 1) return 0;
  const i = Math.round(-rotation / stepOf(count));
  return ((i % count) + count) % count;
}

/** The rotation a drag comes to rest at: where momentum would carry it, on a whole slot. */
export function snapTarget(rotation: number, velocity: number, count: number, momentum: number): number {
  const step = stepOf(count);
  return Math.round((rotation + velocity * momentum) / step) * step + 0; // + 0 turns -0 into 0
}

/** The rotation that brings slot i straight ahead by the short way round, starting from rotation. */
export function rotationFor(i: number, count: number, rotation: number): number {
  return rotation - angleOf(i, count, rotation);
}

/** Past this angle a card is beside or behind the viewer: not drawn, not focusable, not read out. */
export const SEEN_WITHIN = 78;

/** How a card at an angle looks: whether it is seen at all, and how strongly (1 ahead, fading toward the edge of the view). */
export function seen(angle: number): { visible: boolean; strength: number } {
  const a = Math.abs(angle);
  if (a >= SEEN_WITHIN) return { visible: false, strength: 0 };
  return { visible: true, strength: a <= 50 ? 1 : (SEEN_WITHIN - a) / (SEEN_WITHIN - 50) };
}

/** Which item a slot shows. */
export const itemOf = (slot: number, items: number) => (items > 0 ? slot % items : 0);
