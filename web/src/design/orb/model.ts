import { colord, extend } from "colord";
import mixPlugin from "colord/plugins/mix";

extend([mixPlugin]);

/**
 * The orb's plain parts, without three.js, so they are tested: where its points sit and which
 * colours it draws with. scene.ts turns them into the WebGL scene.
 */

/** warn: the server is gone and devdeck reconnects; drawn in the warning colour, and it thinks. */
export type OrbState = "idle" | "thinking" | "ok" | "warn";

/** Whether the orb "thinks" (moves faster, ripples more) in this state. */
export const thinks = (state: OrbState) => state === "thinking" || state === "warn";

/** The theme colours the orb uses, as CSS colour strings. */
export type OrbColors = { primary: string; critical: string; good: string; warning: string; ink: string; live: string };

/** What each part is drawn in. */
export type OrbPalette = {
  /** The top of the shell and the core. */
  top: string;
  /** The middle of the shell: the accent gradient's middle. */
  mid: string;
  /** The bottom of the shell. */
  low: string;
  rings: string;
  satellite: string;
};

/**
 * The colours for a state: the accent at the top through the gradient's middle (60% of the way
 * to the error colour, as --neon-gradient) to the error colour at the bottom; "ok" is the success
 * colour all through, since a good-news empty page is never purple; "warn" is the warning colour
 * all through.
 */
export function orbPalette(c: OrbColors, state: OrbState): OrbPalette {
  const whole = { ok: c.good, warn: c.warning }[state as "ok" | "warn"] as string | undefined;
  const top = whole ?? c.primary;
  const low = whole ?? c.critical;
  const a = colord(top);
  const b = colord(low);
  const mid = a.isValid() && b.isValid() ? a.mix(b, 0.6).toHex() : top;
  return { top, mid, low, rings: c.ink, satellite: c.live };
}

/**
 * n points spread evenly on a unit sphere (a Fibonacci sphere), as x, y, z triples, and a seed
 * in [0, 1) per point that varies its size and motion. The same n always gives the same points.
 */
export function spherePoints(n: number): { positions: Float32Array; seeds: Float32Array } {
  const positions = new Float32Array(n * 3);
  const seeds = new Float32Array(n);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    positions[i * 3] = Math.cos(th) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(th) * r;
    const s = Math.sin(i * 12.9898) * 43758.5453;
    seeds[i] = s - Math.floor(s);
  }
  return { positions, seeds };
}
