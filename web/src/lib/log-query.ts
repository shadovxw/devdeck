import type { LogLevel } from "./types";

/** What the Logs page can ask the server to filter on. Every filter that is set must match. */
export type LogQuery = {
  services?: string[];
  levels?: LogLevel[];
  /** A Go (RE2) pattern, at most 500 characters. */
  regex?: string;
  /** `path=value` or `path!=value`; the path is dotted for nested fields. */
  fields?: string[];
  /** A time in RFC 3339, or how long ago: 90s, 15m, 2h, 7d. */
  since?: string;
  until?: string;
  /** An error group's fingerprint. */
  group?: string;
  before?: number;
  after?: number;
  limit?: number;
};

/** A filter saved with the workspace. */
export type SavedLogFilter = {
  id: string;
  name: string;
  /** Only offered for this stack; empty means any. */
  stack?: string;
  services?: string[];
  levels?: LogLevel[];
  regex?: string;
  fields?: string[];
  since?: string;
};

/** The query string of a log request (without the "?"), leaving out what isn't set. */
export function logQueryString(q: LogQuery): string {
  const p = new URLSearchParams();
  for (const s of q.services ?? []) p.append("service", s);
  for (const l of q.levels ?? []) p.append("level", l);
  for (const f of q.fields ?? []) p.append("field", f);
  if (q.regex) p.set("regex", q.regex);
  if (q.since) p.set("since", q.since);
  if (q.until) p.set("until", q.until);
  if (q.group) p.set("group", q.group);
  if (q.before) p.set("before", String(q.before));
  if (q.after) p.set("after", String(q.after));
  if (q.limit) p.set("limit", String(q.limit));
  return p.toString();
}

/** A saved filter as a query, ready to add paging to. */
export function queryOfFilter(f: SavedLogFilter): LogQuery {
  return { services: f.services, levels: f.levels, regex: f.regex, fields: f.fields, since: f.since };
}
