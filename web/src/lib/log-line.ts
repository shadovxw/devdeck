import type { LogLevel } from "./types";

/** A log line made readable: its level, its message, and the other fields as key=value. */
export type ReadableLine = { level?: LogLevel; message: string; fields: [string, string][] };

const levels: Record<string, LogLevel> = {
  trace: "trace", debug: "debug", dbg: "debug", info: "info", information: "info", notice: "info",
  warn: "warn", warning: "warn", error: "error", err: "error", fatal: "fatal", panic: "fatal", critical: "fatal",
  // zerolog's console writer
  trc: "trace", inf: "info", wrn: "warn", ftl: "fatal", pnc: "fatal",
};

// Terminal colour codes, which some loggers write even when nobody is at a terminal.
// eslint-disable-next-line no-control-regex
const ansi = /\u001b\[[0-9;]*[A-Za-z]/g;

/** A line without terminal colour codes. */
export function stripAnsi(s: string): string {
  return s.replace(ansi, "");
}

// "<time> <LEVEL> rest": zerolog's console format, and many others like it.
const consoleLine = /^\s*(\d{4}-\d\d-\d\dT[\d:.]+(?:Z|[+-]\d\d:?\d\d)?|\d\d:\d\d:\d\d(?:\.\d+)?)\s+([A-Za-z]{3,8})\s+(.*)$/s;
// key=value pairs at the end of a line
const pair = /^([A-Za-z_][\w.-]*)=(\S*)$/;

// The keys loggers use for the level, the message and the time (the time is shown already).
const levelKeys = ["level", "lvl", "severity", "levelname"];
const messageKeys = ["message", "msg", "event"];
const timeKeys = ["time", "ts", "timestamp", "@timestamp", "t"];

function text(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Reads a line that is a JSON object (zerolog, pino, slog and the like) into its level,
 * message and the remaining fields; a plain line is kept as it is, with a level only
 * when it starts with one ("WARN ...", "[error] ...").
 */
export function readLine(raw: string): ReadableLine {
  const line = stripAnsi(raw);
  const s = line.trim();
  const c = consoleLine.exec(line);
  if (c && levels[c[2].toLowerCase()]) {
    // the message runs until the first word that is a key=value pair
    const words = c[3].split(/\s+/).filter(Boolean);
    const at = words.findIndex((w) => pair.test(w));
    const message = (at < 0 ? words : words.slice(0, at)).join(" ");
    const fields: [string, string][] = at < 0 ? [] : words.slice(at).map((w) => {
      const m = pair.exec(w);
      return m ? [m[1], m[2]] : ["", w];
    });
    return { level: levels[c[2].toLowerCase()], message, fields };
  }
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const obj = JSON.parse(s) as Record<string, unknown>;
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        let level: LogLevel | undefined;
        let message = "";
        const fields: [string, string][] = [];
        for (const [k, v] of Object.entries(obj)) {
          const key = k.toLowerCase();
          if (!level && levelKeys.includes(key) && typeof v === "string" && levels[v.toLowerCase()]) level = levels[v.toLowerCase()];
          else if (!message && messageKeys.includes(key) && typeof v === "string") message = v;
          else if (timeKeys.includes(key)) continue;
          else fields.push([k, text(v)]);
        }
        return { level, message, fields };
      }
    } catch {
      // not JSON after all
    }
  }
  const m = /^\s*\[?(trace|debug|dbg|info|warn|warning|error|err|fatal|panic)\]?[\s:]/i.exec(line);
  return { level: m ? levels[m[1].toLowerCase()] : undefined, message: line, fields: [] };
}
