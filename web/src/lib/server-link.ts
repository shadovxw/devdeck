import { create } from "zustand";

/**
 * Whether devdeck's server answers (dev-plans/2026-11-21-portfolio-look §8b, P9a). The health
 * check is the one judge: each answer or failure is recorded here as it happens, so the next
 * check's delay (the back-off) and what the page shows follow at once. The live socket only
 * prompts an early check when it drops.
 */

/** Back-off after a failure: 1s, 2s, 4s, 8s, then every 15s. */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(1000 * 2 ** (failures - 1), 15_000);
}

/** How long the server may be gone before the page says so: shorter blips show nothing. */
export const QUIET_MS = 2_000;
/** How long "Connected" stays once the server is back. */
export const CONNECTED_MS = 2_000;

export type LinkState = {
  /** Failures in a row; 0 while the server answers. */
  failures: number;
  /** When the current outage began, or null while up. */
  downSince: number | null;
  /** When the last check failed: the next one is backoffMs(failures) after it. */
  lastFailAt: number | null;
  /** When the server came back after an outage the page showed, or null. */
  backAt: number | null;
  /** True once the server has answered at least once (so the app is on screen). */
  everUp: boolean;
};

/** What the page shows about the server now. */
export type LinkView = "up" | "reconnecting" | "connected";

/** up: nothing to show (also during a blip shorter than QUIET_MS). */
export function linkView(s: LinkState, now: number): LinkView {
  if (s.downSince !== null) return now - s.downSince >= QUIET_MS ? "reconnecting" : "up";
  if (s.backAt !== null && now - s.backAt < CONNECTED_MS) return "connected";
  return "up";
}

/** When the next check runs, for the countdown; null while up. */
export const nextCheckAt = (s: LinkState): number | null => (s.lastFailAt === null ? null : s.lastFailAt + backoffMs(s.failures));

const initial: LinkState = { failures: 0, downSince: null, lastFailAt: null, backAt: null, everUp: false };

type Store = LinkState & {
  /** The health check answered. */
  answered: (now?: number) => void;
  /** The health check failed. */
  failed: (now?: number) => void;
  /** "Connected" has been shown: forget when the server came back. */
  settled: () => void;
  reset: () => void;
};

export const useServerLink = create<Store>((set, get) => ({
  ...initial,
  answered: (now = Date.now()) => {
    const s = get();
    // "Connected" only after an outage the page showed; a blip stays silent.
    const shown = s.downSince !== null && now - s.downSince >= QUIET_MS;
    set({ failures: 0, downSince: null, lastFailAt: null, backAt: shown ? now : s.backAt, everUp: true });
  },
  failed: (now = Date.now()) => {
    const s = get();
    set({ failures: s.failures + 1, downSince: s.downSince ?? now, lastFailAt: now });
  },
  settled: () => set({ backAt: null }),
  reset: () => set(initial),
}));

/** True while the page says the server is gone: writes wait, reading still works. */
export const writesPaused = (s: LinkState, now = Date.now()) => s.everUp && linkView(s, now) === "reconnecting";

/** The words on a paused button's tooltip. */
export const PAUSED_TITLE = "Paused while devdeck reconnects to its server";
