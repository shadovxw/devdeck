import type { CSSProperties } from "react";

// The motion tokens as JavaScript numbers, for animations that CSS can't do
// (shared layout moves). They equal the --dur-* tokens in design/tokens.css;
// motion.test.ts checks that. Reduced motion is handled by <MotionConfig
// reducedMotion="user"> in the app, which turns these moves into cuts.

/** Seconds (what the motion library takes). */
export const duration = { instant: 0.1, quick: 0.18, move: 0.32, scene: 0.7 } as const;

/** The "move" spring: layout moves and list reorder (stiffness 300, damping 30, about 320 ms). */
export const springMove = { type: "spring", stiffness: 300, damping: 30 } as const;

/**
 * For things you trigger tens of times a day, like the sidebar highlight moving
 * when you change page: quick, no bounce.
 */
export const springSnappy = { type: "spring", duration: 0.2, bounce: 0 } as const;

/** Position in a reading-order stagger. Pair it with the .enter class (40 ms apart). */
export const stagger = (index: number): CSSProperties => ({ "--i": index }) as CSSProperties;
