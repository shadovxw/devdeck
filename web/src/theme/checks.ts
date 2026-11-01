import { contrast } from "./derive";
import type { RoleId, TokenMap } from "./types";

export type Check = {
  id: string;
  label: string;
  /** The contrast ratio, 1 to 21. */
  ratio: number;
  /** What it should be at least: 4.5 for text, 3 for a dot or a ring. */
  min: number;
  ok: boolean;
};

/** The pairs a theme is judged on, and the least contrast each needs (WCAG 2.2 AA). */
const PAIRS: { id: string; label: string; fg: string; bg: string; min: number }[] = [
  { id: "text", label: "Text on the page", fg: "--ink", bg: "--bg", min: 4.5 },
  { id: "soft-text", label: "Soft text on the page", fg: "--ink-3", bg: "--bg", min: 4.5 },
  { id: "panel-text", label: "Text on menus and panels", fg: "--ink", bg: "--surface-float", min: 4.5 },
  { id: "control-text", label: "Text on buttons and fields", fg: "--ink", bg: "--fill", min: 4.5 },
  { id: "primary-text", label: "Primary button text", fg: "--on-primary", bg: "--primary", min: 4.5 },
  { id: "link", label: "Links on the page", fg: "--link", bg: "--bg", min: 4.5 },
  { id: "focus", label: "Focus ring", fg: "--focus", bg: "--bg", min: 3 },
  { id: "good", label: "Success dot", fg: "--good", bg: "--bg", min: 3 },
  { id: "warning", label: "Warning dot", fg: "--warning", bg: "--bg", min: 3 },
  { id: "critical", label: "Error dot", fg: "--critical", bg: "--bg", min: 3 },
];

/** A token's colour, following a `var(--other)` once. */
export function colorOf(tokens: TokenMap, name: string): string {
  const value = tokens[name];
  const ref = /^var\((--[\w-]+)\)$/.exec(value ?? "");
  return ref ? tokens[ref[1]] : value;
}

/** The grade a check earns: AAA from 7:1, AA when it meets what it needs, LOW when it does not. */
export type Grade = "AAA" | "AA" | "LOW";
export const gradeOf = (c: Pick<Check, "ratio" | "ok">): Grade => (c.ratio >= 7 ? "AAA" : c.ok ? "AA" : "LOW");

/** How a theme does on each pair. A failing pair doesn't stop a theme being saved; the page says so. */
export function contrastChecks(tokens: TokenMap): Check[] {
  return PAIRS.map(({ id, label, fg, bg, min }) => {
    const ratio = contrast(colorOf(tokens, fg), colorOf(tokens, bg));
    return { id, label, ratio, min, ok: ratio >= min };
  });
}

/** Which checks a role's colour takes part in, for the mark beside its picker. Roles that no check reads have none. */
export const ROLE_CHECKS: Record<RoleId, string[]> = {
  background: ["text", "soft-text", "link", "focus", "good", "warning", "critical"],
  cards: ["panel-text"],
  controls: ["control-text"],
  text: ["text", "soft-text", "panel-text", "control-text"],
  primary: ["primary-text", "link", "focus"],
  selected: [],
  success: ["good"],
  warning: ["warning"],
  error: ["critical"],
  neutral: [],
};
