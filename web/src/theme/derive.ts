import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";

import { ADVANCED, type Colors, type RoleId, type TokenMap } from "./types";

extend([a11yPlugin]);

/** The colour part of `from`, moved `amount` (0 to 1) of the way to `to`, as `#rrggbb`. */
export function blend(from: string, to: string, amount: number): string {
  const a = colord(from).toRgb();
  const b = colord(to).toRgb();
  return colord({ r: a.r + (b.r - a.r) * amount, g: a.g + (b.g - a.g) * amount, b: a.b + (b.b - a.b) * amount }).toHex();
}

/** WCAG contrast ratio between two colours (1 to 21). */
export const contrast = (a: string, b: string): number => colord(a).contrast(b);

const WHITE = "#ffffff";
const BLACK_INK = "#0a0a0a";

/** The more readable of white and near-black on a colour. */
export const readableOn = (color: string): string => (contrast(color, WHITE) >= contrast(color, BLACK_INK) ? WHITE : BLACK_INK);

const isDark = (color: string) => colord(color).isDark();

/** Softer text: the text colour moved toward the background, but never below 4.5:1 on it. */
function soften(ink: string, bg: string, amount: number): string {
  for (let a = amount; a > 0; a -= 0.01) {
    const c = blend(ink, bg, a);
    if (contrast(c, bg) >= 4.5) return c;
  }
  return ink;
}

// Each deriver works out the tokens that follow from the ones a person chose, reading the
// current values in `t` (so the order they run in matters: see tokensWith).

function deriveSurface(t: TokenMap) {
  const bg = t["--bg"];
  const ink = t["--ink"];
  const dark = isDark(bg);
  t["color-scheme"] = dark ? "dark" : "light";
  t["--inset"] = blend(bg, ink, 0.02);
  t["--scrim"] = dark ? "rgba(0, 0, 0, 0.5)" : colord(ink).alpha(0.18).toRgbString();
  t["--strip-off"] = blend(bg, ink, 0.05);
  t["--strip-ok"] = blend(bg, ink, 0.12);
  t["--strip-idle"] = blend(bg, ink, 0.38);
  t["--strip-bad"] = ink;
  t["--sidebar"] = bg;
}

function deriveText(t: TokenMap) {
  const bg = t["--bg"];
  t["--ink-2"] = soften(t["--ink"], bg, 0.21);
  t["--ink-3"] = soften(t["--ink"], bg, 0.375);
  t["--sidebar-foreground"] = t["--ink-2"];
}

function deriveControls(t: TokenMap) {
  const fill = t["--fill"];
  t["--fill-hover"] = blend(fill, t["--ink"], 0.035);
  t["--fill-press"] = blend(fill, t["--ink"], 0.075);
  t["--sidebar-accent"] = fill;
}

function derivePrimary(t: TokenMap) {
  const primary = t["--primary"];
  // Hover goes toward black on a light page and toward white on a dark one.
  t["--primary-hover"] = blend(primary, isDark(t["--bg"]) ? WHITE : "#000000", isDark(t["--bg"]) ? 0.15 : 0.23);
  t["--on-primary"] = readableOn(primary);
  t["--link"] = primary;
  t["--focus"] = primary;
  t["--accent-soft"] = colord(primary).alpha(0.08).toRgbString();
  t["--sidebar-ring"] = primary;
}

function deriveSidebar(t: TokenMap) {
  t["--sidebar-primary"] = t["--selected"];
  t["--sidebar-primary-foreground"] = readableOn(t["--selected"]);
  t["--sidebar-accent-foreground"] = t["--ink"];
}

function deriveSerious(t: TokenMap) {
  t["--serious"] = blend(t["--warning"], t["--critical"], 0.5);
}

/** The tokens each role sets directly. */
const picks: Record<RoleId, (t: TokenMap, color: string) => void> = {
  background: (t, c) => {
    t["--bg"] = c;
  },
  cards: (t, c) => {
    t["--surface-float"] = c;
    t["--surface-1"] = c;
  },
  controls: (t, c) => {
    t["--fill"] = c;
  },
  text: (t, c) => {
    t["--ink"] = c;
  },
  primary: (t, c) => {
    t["--primary"] = c;
  },
  selected: (t, c) => {
    t["--selected"] = c;
  },
  success: (t, c) => {
    t["--good"] = c;
  },
  warning: (t, c) => {
    t["--warning"] = c;
  },
  error: (t, c) => {
    t["--critical"] = c;
  },
  neutral: (t, c) => {
    t["--neutral"] = c;
  },
};

/** Runs in this order, so a colour a later step reads (the background, the text) is already in place. */
const order: RoleId[] = ["background", "text", "controls", "primary", "selected", "success", "warning", "error", "neutral", "cards"];

/**
 * A copy of `base` with these role colours set and everything that follows from them worked
 * out again. Tokens that don't follow from a changed role keep the base's own values.
 */
export function tokensWith(base: TokenMap, colors: Colors): TokenMap {
  const t: TokenMap = { ...base };
  const has = (...ids: RoleId[]) => ids.some((id) => colors[id] !== undefined);
  for (const id of order) {
    const color = colors[id];
    if (color !== undefined) picks[id](t, color);
  }
  if (has("background", "text")) deriveSurface(t);
  if (has("background", "text")) deriveText(t);
  if (has("controls", "text", "background")) deriveControls(t);
  if (has("primary", "background")) derivePrimary(t);
  if (has("selected", "text", "background")) deriveSidebar(t);
  if (has("warning", "error")) deriveSerious(t);
  // With the background changed, a panel the person did not colour follows it (a little lifted on a dark page).
  if (has("background") && !has("cards")) {
    const lifted = isDark(t["--bg"]) ? blend(t["--bg"], t["--ink"], 0.06) : t["--bg"];
    t["--surface-float"] = lifted;
    t["--surface-1"] = t["--bg"];
  }
  // What a person set in Advanced wins over everything worked out.
  for (const { token } of ADVANCED) {
    if (colors[token] !== undefined) t[token] = colors[token];
  }
  return t;
}
