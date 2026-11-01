import { messageOf } from "./log-query";
import type { LogEntry } from "./types";

function sameLine(a: LogEntry, b: LogEntry): boolean {
  if (a.service !== b.service || (a.level ?? "info") !== (b.level ?? "info")) return false;
  if (a.fingerprint && b.fingerprint) return a.fingerprint === b.fingerprint;
  return messageOf(a) === messageOf(b);
}

/** A line as the list shows it: the first of a run of repeats, and how many there were in the run. */
export type LogRow = { entry: LogEntry; repeat: number };

/**
 * Folds runs of the same line into one row: neighbouring lines of one service and level with the same
 * message (the fields may differ), or with the same error fingerprint, which already ignores the numbers,
 * times and ids that change from one occurrence to the next. The row is the first line of the run, so it
 * stays put as the run grows.
 */
export function collapseRepeats(entries: LogEntry[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const entry of entries) {
    const last = rows[rows.length - 1];
    if (last && sameLine(last.entry, entry)) {
      last.repeat++;
    } else {
      rows.push({ entry, repeat: 1 });
    }
  }
  return rows;
}

/** Every line as a row of its own. */
export const plainRows = (entries: LogEntry[]): LogRow[] => entries.map((entry) => ({ entry, repeat: 1 }));
