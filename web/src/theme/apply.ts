import type { TokenMap } from "./types";

/** Sets a theme's tokens on the page as CSS variables (and `color-scheme`). Nothing is built from text: each value was made by the theme code. */
export function applyTokens(tokens: TokenMap, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(tokens)) el.style.setProperty(name, value);
}

/** Takes a theme's tokens off the page, so the default look in tokens.css shows again. */
export function clearTokens(tokens: TokenMap, el: HTMLElement = document.documentElement): void {
  for (const name of Object.keys(tokens)) el.style.removeProperty(name);
}
