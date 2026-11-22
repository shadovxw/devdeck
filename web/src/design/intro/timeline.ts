/**
 * The launch intro's timeline (dev-plans/2026-11-21-portfolio-look §8b, P9b), from the owner's
 * design: the D assembles, the lockup forms, then it hands off to the app and its particles
 * stream into Home's orb. Plain numbers only, so it is tested; scene.ts draws them and Intro.tsx
 * moves the DOM parts.
 */

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const outCubic = (x: number) => 1 - (1 - x) ** 3;
export const inCubic = (x: number) => x ** 3;
export const inOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
/** Ends a little past 1 and settles back: the ribbon's small overshoot as it swings shut. */
export const outBack = (x: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

/** How far through a span [start, start + length] time t is, from 0 to 1. */
const span = (t: number, start: number, length: number) => clamp01((t - start) / length);

/** The moments that matter, in seconds. */
export const AT = {
  /** The app mounts under the stage (if the server answered), so Home's orb slot can be measured. */
  app: 2.6,
  /** The lockup is complete; without the server yet, time holds here. */
  hold: 2.95,
  /** The hand-off starts: the mark flies to the sidebar, the particles stream to the orb. */
  exit: 3.0,
  /** The intro is over and takes itself away. */
  end: 4.2,
} as const;

/** The letters of the wordmark. */
export const WORD = "devdeck";

/** One frame of the intro. Opacities and progress run from 0 to 1. */
export type IntroFrame = {
  /** Particles: scattered → ring around the lockup. */
  gather: number;
  /** Particles: ring → Home's orb. */
  stream: number;
  particles: number;
  /** The stem flying in from depth. */
  stem: number;
  /** The ribbon swinging shut (may pass 1 a little). */
  ribbon: number;
  ribbonOpacity: number;
  /** The `>` popping (may pass 1 a little). */
  prompt: number;
  /** Whether the `_` cursor shows (it blinks, then stays). */
  cursor: boolean;
  /** The mark turning to face you and moving left. */
  turn: number;
  /** The mark flying to the sidebar. */
  exit: number;
  /** The whole mark's opacity: 1, fading out as it lands in the sidebar. */
  mark: number;
  /** The light sweeping across, 0 when off. */
  sweep: number;
  /** Each letter of the wordmark rising in. */
  letters: number[];
  /** The whole wordmark (it goes with the hand-off). */
  word: number;
  tagline: number;
  glow: number;
  /** The stage's backdrop: it fades to show the app underneath. */
  backdrop: number;
  /** The intro canvas over the app: it fades as the real orb takes over. */
  canvas: number;
};

/** The intro at time t (seconds). */
export function introAt(t: number): IntroFrame {
  const turn = inOut(span(t, 1.35, 0.6));
  const exit = inCubic(span(t, AT.exit, 0.42));
  const wordOut = 1 - span(t, 3.05, 0.15);
  return {
    gather: outCubic(span(t, 0, 1.1)),
    stream: span(t, AT.exit, 1.0),
    particles: span(t, 0, 0.3),
    stem: outCubic(span(t, 0.35, 0.6)),
    ribbon: outBack(span(t, 0.55, 0.8)),
    ribbonOpacity: clamp01(span(t, 0.55, 0.8) * 2.5),
    prompt: Math.max(0.001, outBack(span(t, 1.15, 0.3))),
    cursor: t >= 1.4 && (t > 2.3 || Math.floor((t - 1.4) / 0.16) % 2 === 0),
    turn,
    exit,
    mark: 1 - span(t, 3.35, 0.12),
    sweep: t > 2.2 && t < 2.8 ? Math.sin(span(t, 2.2, 0.6) * Math.PI) : 0,
    letters: [...WORD].map((_, i) => outCubic(span(t, 1.85 + i * 0.05, 0.42))),
    word: (1 - exit) * wordOut,
    tagline: span(t, 2.3, 0.4) * (1 - span(t, 2.9, 0.2)),
    glow: span(t, 1.0, 0.8) * (1 - exit),
    backdrop: 1 - outCubic(span(t, 3.1, 0.4)),
    canvas: 1 - span(t, 3.9, 0.3),
  };
}

/**
 * The next time to show: time runs on, except at the hold point while the server has not
 * answered (the lockup waits there with a progress line).
 */
export function advance(t: number, dt: number, ready: boolean): number {
  const next = t + dt;
  if (!ready && next >= AT.hold) return Math.max(t, AT.hold);
  return next;
}

/** Where a skip (any key or click) jumps to: the end, or the lockup while still waiting. */
export const skipTo = (t: number, ready: boolean) => Math.max(t, ready ? AT.end - 0.3 : AT.hold);

/** How the intro plays here, or not at all. */
export type IntroMode = "none" | "3d" | "fade" | "svg";

/**
 * Cold start only, once per app session, and only with effects on. Reduce motion (the
 * app's or the system's) or Reduced effects: a short fade of the flat lockup. No WebGL: the
 * SVG lockup with the same letter reveal.
 */
export function introMode(o: { seen: boolean; effects: "off" | "reduced" | "full"; reduceMotion: boolean; webgl: boolean }): IntroMode {
  if (o.seen || o.effects === "off") return "none";
  if (o.reduceMotion || o.effects === "reduced") return "fade";
  return o.webgl ? "3d" : "svg";
}

/** The flat lockup's own timeline (modes fade and svg): when it is in, and when it may leave. */
export const FLAT = {
  fade: { in: 0.3, leave: 0.6, out: 0.3 },
  svg: { in: 0.4, leave: 1.9, out: 0.4 },
} as const;
