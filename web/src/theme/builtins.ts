import { tokensWith } from "./derive";
import type { BaseId, RoleId, ThemeData, TokenMap } from "./types";

/**
 * Paper, the default look, as the tokens design/tokens.css sets. A test keeps the two equal: the CSS file
 * is what shows before any script runs, and this is what a custom theme starts from.
 */
const PAPER_TOKENS: TokenMap = {
  "color-scheme": "light",
  "--bg": "#ffffff",
  "--fill": "#f3f3f3",
  "--fill-hover": "#ebebeb",
  "--fill-press": "#e2e2e2",
  "--inset": "#fafafa",
  "--surface-float": "#ffffff",
  "--scrim": "rgba(10, 10, 10, 0.18)",
  "--surface-1": "var(--bg)",
  "--surface-2": "var(--surface-float)",
  "--surface-inset": "var(--inset)",
  "--ink": "#0a0a0a",
  "--ink-2": "#3d3d3d",
  "--ink-3": "#666666",
  "--primary": "#0b3d91",
  "--primary-hover": "#082f70",
  "--on-primary": "#ffffff",
  "--link": "#0b3d91",
  "--focus": "#0b3d91",
  "--selected": "#0a0a0a",
  "--accent-soft": "rgba(11, 61, 145, 0.08)",
  "--good": "#13892f",
  "--warning": "#b77f00",
  "--serious": "#c4562b",
  "--critical": "#c62f2f",
  "--neutral": "#8a8a8a",
  "--strip-ok": "#e2e2e2",
  "--strip-idle": "#a3a3a3",
  "--strip-off": "#f3f3f3",
  "--strip-bad": "#0a0a0a",
  "--shadow-float": "0 10px 30px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08)",
  "--sidebar": "var(--bg)",
  "--sidebar-foreground": "#3d3d3d",
  "--sidebar-primary": "#0a0a0a",
  "--sidebar-primary-foreground": "#ffffff",
  "--sidebar-accent": "#f3f3f3",
  "--sidebar-accent-foreground": "#0a0a0a",
  "--sidebar-ring": "#0b3d91",
};

/** The colours a person sees in each role's picker for Paper. */
const PAPER_ROLES: Record<RoleId, string> = {
  background: "#ffffff",
  cards: "#ffffff",
  controls: "#f3f3f3",
  text: "#0a0a0a",
  primary: "#0b3d91",
  selected: "#0a0a0a",
  success: "#13892f",
  warning: "#b77f00",
  error: "#c62f2f",
  neutral: "#8a8a8a",
};

/** The colours of Paper Dark: the same rules on a dark page, with the primary lightened to stay readable on it. */
const DARK_ROLES: Record<RoleId, string> = {
  background: "#0d0d0d",
  cards: "#171717",
  controls: "#1c1c1c",
  text: "#f2f2f2",
  primary: "#7aa7ff",
  selected: "#f2f2f2",
  success: "#3fb950",
  warning: "#d9a21b",
  error: "#f26b6b",
  neutral: "#8a8a8a",
};

/** What changes with a dark page besides the roles: the logo prompt and the brand colours need light versions, and a shadow needs more weight. */
const DARK_EXTRA: TokenMap = {
  "--mark-prompt": "#4ee8b5",
  "--mark-under": "#2aeab4",
  "--brand": "#1fe8bf",
  "--brand-dev": "#f4f8f9",
  "--brand-deck-from": "#13c8cc",
  "--brand-deck-to": "#1fe8bf",
  "--shadow-float": "0 10px 30px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4)",
};

const PAPER_DARK_TOKENS: TokenMap = { ...tokensWith(PAPER_TOKENS, DARK_ROLES), ...DARK_EXTRA };

export type BuiltIn = { id: BaseId; name: string; tokens: TokenMap; roles: Record<RoleId, string> };

export const BUILT_INS: Record<BaseId, BuiltIn> = {
  paper: { id: "paper", name: "Paper", tokens: PAPER_TOKENS, roles: PAPER_ROLES },
  "paper-dark": { id: "paper-dark", name: "Paper Dark", tokens: PAPER_DARK_TOKENS, roles: DARK_ROLES },
};

export const DEFAULT_BASE: BaseId = "paper";

/** The colour a role has in a theme: the one the person picked, or the base's own. */
export function roleColor(theme: Pick<ThemeData, "base" | "colors">, role: RoleId): string {
  return theme.colors[role] ?? BUILT_INS[theme.base].roles[role];
}

/** Every token of a theme: its base's, with the person's colours and what follows from them put in. */
export function tokensOf(theme: Pick<ThemeData, "base" | "colors">): TokenMap {
  return tokensWith(BUILT_INS[theme.base].tokens, theme.colors);
}
