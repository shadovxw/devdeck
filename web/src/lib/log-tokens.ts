import { compilePattern, parseFieldFilter, type LogQuery } from "./log-query";

/** One removable piece of the query bar: a filter that is on. */
export type QueryToken = {
  kind: "service" | "field" | "text" | "group" | "until";
  /** The grey part before the value: `service:`, `-user.id:`, or empty. */
  key: string;
  value: string;
  /** A filter that leaves lines out (`-key:value`), drawn in the failure colour. */
  not?: boolean;
  /** What the remove button says, for screen readers. */
  remove: string;
  /** The raw filter string, for a field. */
  raw?: string;
};

const specials = /[.*+?^${}()|[\]\\]/g;
const escaped = /\\([.*+?^${}()|[\]\\])/g;

/** Plain text as a case-insensitive pattern that matches it literally. */
export const patternOfText = (text: string) => `(?i)${text.replace(specials, String.raw`\$&`)}`;

/** The text a pattern was made from by `patternOfText`, or undefined when it is a real pattern. */
function textOfPattern(pattern: string): string | undefined {
  if (!pattern.startsWith("(?i)")) return undefined;
  const body = pattern.slice(4);
  const text = body.replace(escaped, "$1");
  return patternOfText(text) === pattern ? text : undefined;
}

/** A pattern as the reader would type it: the plain text it was made from, or /pattern/. */
export function displayOfPattern(pattern: string): string {
  return textOfPattern(pattern) ?? `/${pattern}/`;
}

/** The filters of a query that live in the query bar, in the order the bar shows them. */
export function tokensOf(q: LogQuery): QueryToken[] {
  const tokens: QueryToken[] = [];
  for (const s of q.services ?? []) tokens.push({ kind: "service", key: "service:", value: s, remove: `Remove the filter service:${s}` });
  for (const raw of q.fields ?? []) {
    const f = parseFieldFilter(raw);
    if (f) tokens.push({ kind: "field", key: `${f.not ? "-" : ""}${f.path}:`, value: f.value, not: f.not, raw, remove: `Remove the filter ${raw}` });
  }
  if (q.regex) {
    const text = textOfPattern(q.regex);
    tokens.push({ kind: "text", key: "", value: text ?? `/${q.regex}/`, remove: "Remove the search text" });
  }
  if (q.group) tokens.push({ kind: "group", key: "", value: "One kind of error", remove: "Remove the error filter" });
  if (q.until) tokens.push({ kind: "until", key: "", value: `Until ${new Date(q.until).toLocaleTimeString()}`, remove: "Show up to now again" });
  return tokens;
}

/** The query without one of its tokens. */
export function withoutToken(q: LogQuery, t: QueryToken): LogQuery {
  switch (t.kind) {
    case "service":
      return { ...q, services: (q.services ?? []).filter((s) => s !== t.value) };
    case "field":
      return { ...q, fields: (q.fields ?? []).filter((f) => f !== t.raw) };
    case "text":
      return { ...q, regex: undefined };
    case "group":
      return { ...q, group: undefined };
    case "until":
      return { ...q, until: undefined };
  }
}

export type Applied = { query: LogQuery } | { error: string };

const tokenForm = /^(-?)([A-Za-z_][\w.-]*)(:|!=|=)(\S+)$/;

/**
 * What a line typed in the query bar means, added to the query:
 * `service:name`, `key:value` or `key=value` (a field), `-key:value` or `key!=value`
 * (a field the line must not have), `/pattern/` (a pattern), or any other text, which
 * is searched for as it is, ignoring case. Only one search text or pattern is kept.
 */
export function applyInput(q: LogQuery, input: string): Applied {
  const text = input.trim();
  if (!text) return { query: q };

  if (text.length > 2 && text.startsWith("/") && text.endsWith("/")) {
    const pattern = text.slice(1, -1);
    return compilePattern(pattern) ? { query: { ...q, regex: pattern } } : { error: "This isn’t a valid pattern." };
  }

  const m = tokenForm.exec(text);
  if (m) {
    const [, minus, key, op, value] = m;
    if (key === "service" && !minus && op === ":") {
      const services = q.services ?? [];
      return { query: { ...q, services: services.includes(value) ? services : [...services, value] } };
    }
    const not = minus === "-" || op === "!=";
    const raw = `${key}${not ? "!=" : "="}${value}`;
    return { query: { ...q, fields: [...(q.fields ?? []).filter((f) => f !== raw), raw] } };
  }

  return { query: { ...q, regex: patternOfText(text) } };
}
