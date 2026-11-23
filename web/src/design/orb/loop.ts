/**
 * The orb's frame loop, kept apart from three.js so it can be tested: it draws at most `fps`
 * frames a second (the first one at once), draws that one frame and stops when `still` (reduce motion, reduced effects), and
 * stops while the page is hidden, starting again when it is shown.
 */
export type LoopOptions = {
  /** Draws one frame; dt is the seconds since the last one (capped at 0.05). */
  frame: (dt: number) => void;
  still: boolean;
  fps?: number;
  /** For tests. */
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  now?: () => number;
  doc?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
};

/** Starts the loop and returns the function that stops it for good. */
export function startLoop({ frame, still, fps = 60, raf = requestAnimationFrame, caf = cancelAnimationFrame, now = () => performance.now(), doc = document }: LoopOptions): () => void {
  const minGap = 1000 / fps;
  let id = 0;
  let last = now();
  let drawn = last - minGap;
  let stopped = false;

  const tick = (t: number) => {
    id = 0;
    if (stopped || doc.hidden) return;
    if (t - drawn >= minGap - 1) {
      frame(Math.min((t - last) / 1000, 0.05));
      last = t;
      drawn = t;
    }
    if (!still) id = raf(tick);
  };

  const onVisibility = () => {
    if (stopped || doc.hidden || id || still) return;
    last = now();
    id = raf(tick);
  };

  doc.addEventListener("visibilitychange", onVisibility);
  // One frame at once, so the orb is there even before (or without) the first animation frame.
  frame(0);
  if (!still && !doc.hidden) id = raf(tick);

  return () => {
    stopped = true;
    if (id) caf(id);
    id = 0;
    doc.removeEventListener("visibilitychange", onVisibility);
  };
}
