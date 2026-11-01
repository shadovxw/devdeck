import { api } from "../lib/api";
import { parseTheme } from "./validate";
import type { ThemeData } from "./types";

/** What the server keeps for the Appearance page. Mode, light and dark are empty until a choice has been saved; active is the single theme kept before there were modes. */
export type Appearance = { themes: unknown[]; mode: string; light: string; dark: string; active: string };

export const loadAppearance = () => api.get<Appearance>("/appearance");
export const saveTheme = (t: ThemeData) => api.put<ThemeData>(`/appearance/themes/${encodeURIComponent(t.id)}`, t);
export const deleteTheme = (id: string) => api.delete<void>(`/appearance/themes/${encodeURIComponent(id)}`);
/** Saves the mode and the theme for each of light and dark. */
export const setUse = (use: { mode: string; light: string; dark: string }) => api.put<void>("/appearance/use", use);

/** The themes a server answer holds, each checked again as an imported file is. */
export const themesOf = (a: Appearance): ThemeData[] => a.themes.map((t) => parseTheme(JSON.stringify(t)).theme).filter((t): t is ThemeData => t !== undefined);
