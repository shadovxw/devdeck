import type { LogEntry, LogSeries } from "./types";

export type ServiceStat = {
  name: string;
  /** Lines of this service among those loaded; undefined when other services are picked and this one is not, so there are none to count. */
  count: number | undefined;
  /** The worst level seen among its loaded lines: a failure, a warning, or fine; none when nothing is loaded. */
  tone: "critical" | "warning" | "good" | "neutral";
  /** Lines in each bucket of the range, when the server's counts are in. */
  counts?: number[];
};

/** A service's dot: failing when the server counted errors, a warning when a loaded line warns, otherwise fine. */
function toneOf(errors: number, worst: ServiceStat["tone"] | undefined): ServiceStat["tone"] {
  if (errors > 0) return "critical";
  return worst === "warning" ? "warning" : "good";
}

/**
 * What the service column shows: each service with its lines and the worst level among them.
 * With the server's counts (`series`) the numbers are over the whole range and every service has
 * a line of counts; without them they are the lines that are loaded. Busiest first; services
 * with no count go last, by name.
 */
export function serviceStats(entries: LogEntry[], names: string[], picked: string[], series?: LogSeries[]): ServiceStat[] {
  const seen = new Map<string, { count: number; worst: ServiceStat["tone"] }>();
  for (const e of entries) {
    const s = seen.get(e.service) ?? { count: 0, worst: "good" as const };
    s.count++;
    if (e.level === "error" || e.level === "fatal") s.worst = "critical";
    else if (e.level === "warn" && s.worst !== "critical") s.worst = "warning";
    seen.set(e.service, s);
  }
  const counted = new Map((series ?? []).map((sr) => [sr.key, sr]));
  const all = new Set([...names, ...seen.keys(), ...counted.keys()]);
  const stats: ServiceStat[] = [...all].map((name) => {
    const sr = counted.get(name);
    if (sr) {
      return { name, count: sr.total, tone: toneOf(sr.errors ?? 0, seen.get(name)?.worst), counts: sr.counts };
    }
    const s = seen.get(name);
    const outside = picked.length > 0 && !picked.includes(name);
    return { name, count: outside ? undefined : (s?.count ?? 0), tone: s ? s.worst : "neutral" };
  });
  return stats.sort((a, b) => (b.count ?? -1) - (a.count ?? -1) || a.name.localeCompare(b.name));
}

/** The services that have an error or a fatal line among those loaded. */
export function servicesWithErrors(entries: LogEntry[]): string[] {
  return [...new Set(entries.filter((e) => e.level === "error" || e.level === "fatal").map((e) => e.service))].sort((a, b) => a.localeCompare(b));
}
