import { parseTheme, type ParsedTheme } from "./validate";
import type { ThemeData } from "./types";

/** A theme file is a few hundred bytes; anything much bigger is not one. */
const maxFileBytes = 20_000;

/** A theme as the text of a file: the fields the server keeps, nothing else, so it is safe to share. */
export function themeFileText(t: ThemeData): string {
  return `${JSON.stringify({ schema: 1, id: t.id, name: t.name, base: t.base, colors: t.colors }, null, 2)}\n`;
}

export const themeFileName = (t: ThemeData) => `${t.id}.devdeck-theme.json`;

function readText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** A theme from a file a person picked: checked the way the server checks one. */
export async function readThemeFile(file: File): Promise<ParsedTheme> {
  if (file.size > maxFileBytes) return { error: "This file is too big to be a theme." };
  try {
    return parseTheme(await readText(file));
  } catch {
    return { error: "This file couldn’t be read." };
  }
}

/** Saves a theme as a file through the browser's download. */
export function downloadTheme(t: ThemeData): void {
  const url = URL.createObjectURL(new Blob([themeFileText(t)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = themeFileName(t);
  a.click();
  URL.revokeObjectURL(url);
}
