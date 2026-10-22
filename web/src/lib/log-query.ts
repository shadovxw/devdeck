import type { LogEntry, LogLevel } from "./types";

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

/** `path=value` or `path!=value`, or undefined when it isn't one. */
export function parseFieldFilter(raw: string): { path: string; value: string; not: boolean } | undefined {
  const i = raw.indexOf("=");
  if (i <= 0) return undefined;
  const not = raw[i - 1] === "!";
  const path = raw.slice(0, not ? i - 1 : i).trim();
  return path ? { path, value: raw.slice(i + 1), not } : undefined;
}

function lookup(fields: Record<string, unknown>, path: string): { found: boolean; value?: unknown } {
  if (path in fields) return { found: true, value: fields[path] };
  const dot = path.indexOf(".");
  if (dot < 0) return { found: false };
  const next = fields[path.slice(0, dot)];
  if (next && typeof next === "object" && !Array.isArray(next)) return lookup(next as Record<string, unknown>, path.slice(dot + 1));
  return { found: false };
}

function fieldText(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/**
 * The pattern as the browser reads it, or undefined when it doesn't compile. The server
 * reads Go (RE2) patterns, whose flags come first as (?i), (?s) or (?m); those are turned
 * into the browser's flags. Syntax only Go has isn't understood here.
 */
export function compilePattern(pattern: string | undefined): RegExp | undefined {
  if (!pattern) return undefined;
  const lead = /^\(\?([ims]+)\)/.exec(pattern);
  try {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the pattern is what the person typed in their own filter box, run in their own browser; a slow one only slows their own tab
    return lead ? new RegExp(pattern.slice(lead[0].length), lead[1]) : new RegExp(pattern);
  } catch {
    return undefined;
  }
}

/**
 * Whether a line that arrived live belongs in a view with these filters: the same
 * rules the server applies to stored lines (except time, which a live line is always
 * inside). The pattern is read by the browser's engine, which differs from the
 * server's in a few corners, so a stored line the server keeps is what counts after a reload.
 */
export function entryMatches(e: LogEntry, q: LogQuery, re: RegExp | undefined = compilePattern(q.regex)): boolean {
  if (q.services?.length && !q.services.includes(e.service)) return false;
  if (q.levels?.length && !q.levels.includes(e.level ?? "info")) return false;
  if (q.group && e.fingerprint !== q.group) return false;
  if (re && !re.test(e.text)) return false;
  for (const raw of q.fields ?? []) {
    const f = parseFieldFilter(raw);
    if (!f) continue;
    const hit = lookup(e.fields ?? {}, f.path);
    if ((hit.found && fieldText(hit.value) === f.value) === f.not) return false;
  }
  return true;
}

/** The part of a line to show as its message. */
export function messageOf(e: LogEntry): string {
  const text = e.message || e.text;
  const nl = text.indexOf("\n");
  return nl < 0 ? text : text.slice(0, nl);
}

/** A link that opens a place in VS Code (the file is the absolute path the server resolved). */
export function vscodeLink(file: string, line: number): string {
  const path = file.replace(/\\/g, "/");
  return `vscode://file${path.startsWith("/") ? "" : "/"}${encodeURI(path)}:${line}`;
}
