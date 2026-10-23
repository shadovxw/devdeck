import type { LogLevel } from "./types";

/** A log line made readable: its level, its message, and the other fields as key=value. */
export type ReadableLine = { level?: LogLevel; message: string; fields: [string, string][] };

const levels: Record<string, LogLevel> = {
  trace: "trace", debug: "debug", dbg: "debug", info: "info", information: "info", notice: "info",
  warn: "warn", warning: "warn", error: "error", err: "error", fatal: "fatal", panic: "fatal", critical: "fatal",
  // zerolog's console writer
  trc: "trace", inf: "info", wrn: "warn", ftl: "fatal", pnc: "fatal",
};

function levelOf(word: string): LogLevel | undefined {
  return Object.hasOwn(levels, word.toLowerCase()) ? levels[word.toLowerCase()] : undefined;
}

// Terminal colour codes, which some loggers write even when nobody is at a terminal.
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;]*[A-Za-z]/g;

/** A line without terminal colour codes. */
export function stripAnsi(s: string): string {
  return s.replace(ansi, "");
}

// A time at the start of a console line: 2026-10-23T08:41:37Z, with fractions or an offset, or 08:41:37.
const isoTime = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:?\d\d)?$/;
const clockTime = /^\d\d:\d\d:\d\d(?:\.\d{1,9})?$/;
// key=value
const pair = /^([A-Za-z_][\w.-]*)=(\S*)$/;
// a level a plain line starts with: "WARN ...", "[error] ...", "info: ..."
const leadingLevel = /^\[?([A-Za-z]{3,8})\]?:?$/;

// The keys loggers use for the level, the message and the time (the time is shown already).
const levelKeys = new Set(["level", "lvl", "severity", "levelname"]);
const messageKeys = new Set(["message", "msg", "event"]);
const timeKeys = new Set(["time", "ts", "timestamp", "@timestamp", "t"]);

/** Splits words into the message (up to the first key=value) and the pairs after it. */
function messageAndPairs(words: string[]): Pick<ReadableLine, "message" | "fields"> {
  const at = words.findIndex((w) => pair.test(w));
  if (at < 0) return { message: words.join(" "), fields: [] };
  const fields = words.slice(at).map((w): [string, string] => {
    const m = pair.exec(w);
    return m ? [m[1], m[2]] : ["", w];
  });
  return { message: words.slice(0, at).join(" "), fields };
}

/** "<time> <LEVEL> message key=value ...": zerolog's console format and many like it. */
function readConsole(line: string): ReadableLine | null {
  const words = line.trim().split(/\s+/);
  if (words.length < 3 || !(isoTime.test(words[0]) || clockTime.test(words[0]))) return null;
  const level = levelOf(words[1]);
  return level ? { level, ...messageAndPairs(words.slice(2)) } : null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** A JSON object per line (zerolog, pino, slog and the like). */
function readJSON(s: string): ReadableLine | null {
  if (!s.startsWith("{") || !s.endsWith("}")) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out: ReadableLine = { message: "", fields: [] };
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = k.toLowerCase();
    const level = levelKeys.has(key) && typeof v === "string" ? levelOf(v) : undefined;
    if (!out.level && level) out.level = level;
    else if (!out.message && messageKeys.has(key) && typeof v === "string") out.message = v;
    else if (!timeKeys.has(key)) out.fields.push([k, text(v)]);
  }
  return out;
}

/**
 * Reads a log line into its level, message and the remaining fields: JSON lines and
 * console lines ("<time> INF message key=value") are taken apart; a plain line is kept
 * as it is, with a level only when it starts with one ("WARN ...", "[error] ...").
 */
export function readLine(raw: string): ReadableLine {
  const line = stripAnsi(raw);
  const parsed = readConsole(line) ?? readJSON(line.trim());
  if (parsed) return parsed;
  const first = leadingLevel.exec(line.trim().split(/\s+/)[0] ?? "");
  return { level: first ? levelOf(first[1]) : undefined, message: line, fields: [] };
}
