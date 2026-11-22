import { describe, expect, it, vi } from "vitest";

import { startLoop } from "./loop";

/** A hand-driven clock, animation frames and page visibility. */
function harness(hidden = false) {
  let time = 0;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  } as unknown as Pick<Document, "hidden" | "addEventListener" | "removeEventListener"> & { hidden: boolean };
  return {
    doc,
    raf: (cb: FrameRequestCallback) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => queue.delete(id),
    now: () => time,
    /** Moves the clock and runs the frames that were asked for. */
    step(ms: number) {
      time += ms;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) cb(time);
    },
    pending: () => queue.size,
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const fn of listeners) fn();
    },
    listeners: () => listeners.size,
  };
}

describe("the orb's frame loop", () => {
  it("draws a first frame at once, then keeps drawing", () => {
    const h = harness();
    const frame = vi.fn();
    startLoop({ frame, still: false, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(frame).toHaveBeenLastCalledWith(0);
    h.step(16.7);
    h.step(16.7);
    expect(frame).toHaveBeenCalledTimes(3);
    expect(h.pending()).toBe(1);
  });

  it("draws one frame and stops when still (reduce motion)", () => {
    const h = harness();
    const frame = vi.fn();
    startLoop({ frame, still: true, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(0);
    h.setHidden(true);
    h.setHidden(false);
    expect(h.pending()).toBe(0);
  });

  it("stops while the page is hidden and starts again when shown", () => {
    const h = harness();
    const frame = vi.fn();
    startLoop({ frame, still: false, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    h.setHidden(true);
    h.step(16.7); // the frame already asked for sees the page hidden and doesn't ask again
    expect(frame).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(0);
    h.step(1000);
    expect(frame).toHaveBeenCalledTimes(1);
    h.setHidden(false);
    expect(h.pending()).toBe(1);
    h.step(16.7);
    expect(frame).toHaveBeenCalledTimes(2);
  });

  it("caps the frame rate", () => {
    const h = harness();
    const frame = vi.fn();
    startLoop({ frame, still: false, fps: 30, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    for (let i = 0; i < 6; i++) h.step(16.7); // 100 ms at 60 Hz
    expect(frame.mock.calls.length - 1).toBeLessThanOrEqual(3); // about 30 a second
  });

  it("stops for good, and lets go of the page", () => {
    const h = harness();
    const frame = vi.fn();
    const stop = startLoop({ frame, still: false, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    stop();
    expect(h.pending()).toBe(0);
    expect(h.listeners()).toBe(0);
    h.step(16.7);
    expect(frame).toHaveBeenCalledTimes(1);
  });

  it("starting hidden draws the first frame but waits to animate", () => {
    const h = harness(true);
    const frame = vi.fn();
    startLoop({ frame, still: false, raf: h.raf, caf: h.caf, now: h.now, doc: h.doc });
    expect(frame).toHaveBeenCalledTimes(1);
    expect(h.pending()).toBe(0);
    h.setHidden(false);
    expect(h.pending()).toBe(1);
  });
});
