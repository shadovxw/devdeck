import { ADVANCED, ROLES, type BaseId, type ColorKey, type Colors, type ThemeData } from "./types";

const hex = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const colorKeys = new Set<string>([...ROLES.map((r) => r.id), ...ADVANCED.map((a) => a.token)]);
const bases = new Set<string>(["paper", "paper-dark"]);

/** A colour a theme may hold: `#rgb` or `#rrggbb`, nothing else, so nothing a person types can reach a stylesheet as text. */
export const isHexColor = (value: unknown): value is string => typeof value === "string" && hex.test(value);

/** `#abc` as `#aabbcc`, and lower case. */
export function normalizeHex(value: string): string {
  const v = value.toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

export type ParsedTheme = { theme: ThemeData; error?: undefined } | { theme?: undefined; error: string };

const maxName = 40;

/** A theme from text (a file a person imported), checked: the schema, the name, the base and each colour. Anything unknown is dropped. */
export function parseTheme(text: string): ParsedTheme {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { error: "This isn’t a theme file: it isn’t valid JSON." };
  }
  if (typeof data !== "object" || data === null) return { error: "This isn’t a theme file." };
  const d = data as Record<string, unknown>;
  if (d.schema !== 1) return { error: "This theme file is from a different version of devdeck." };
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (name === "" || name.length > maxName) return { error: `A theme needs a name of 1 to ${maxName} characters.` };
  const base = typeof d.base === "string" && bases.has(d.base) ? (d.base as BaseId) : undefined;
  if (!base) return { error: "The theme’s base must be paper or paper-dark." };

  const colors: Colors = {};
  for (const [role, value] of Object.entries(typeof d.colors === "object" && d.colors !== null ? d.colors : {})) {
    if (!colorKeys.has(role)) continue;
    if (!isHexColor(value)) return { error: `The colour for “${role}” must be a hex colour like #0b3d91.` };
    colors[role as ColorKey] = normalizeHex(value);
  }
  const id = typeof d.id === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(d.id) ? d.id : slugOf(name);
  return { theme: { schema: 1, id, name, base, colors } };
}

/** An id from a name: lower case letters, digits and dashes. */
export function slugOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.slice(0, 40).replace(/-+$/, "") || "theme";
}
