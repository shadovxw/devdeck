import type { LogEntry } from "../../lib/types";

type StatusInput = {
  state: "loading" | "ready" | "error";
  error?: string;
  count: number;
  /** Lines the muted patterns hid, from the histogram. */
  muted?: number;
  paused: boolean;
  /** False when the view is a past stretch, not the live end. */
  live: boolean;
};

/** The line beside the toolbar: how many lines, how many were muted, and whether the view is paused or a past stretch. */
export function statusLine({ state, error, count, muted, paused, live }: Readonly<StatusInput>): string {
  if (state === "loading") return "Loading…";
  if (state === "error") return error || "Could not load the logs.";
  const parts = [`${count.toLocaleString()} line${count === 1 ? "" : "s"}`];
  if (muted) parts.push(`${muted.toLocaleString()} muted`);
  if (paused) parts.push("paused");
  if (!live) parts.push("a past stretch");
  return parts.join(" · ");
}

/** What the header says the view is doing. */
export function liveLabel(live: boolean, paused: boolean): string {
  if (!live) return "Past stretch";
  return paused ? "Paused" : "Live";
}

/** How many of the loaded lines came in the last minute. */
export function linesInLastMinute(entries: readonly LogEntry[], now: number): number {
  return entries.filter((e) => now - Date.parse(e.time) < 60_000).length;
}
