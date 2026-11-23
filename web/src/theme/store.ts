import { create } from "zustand";

import { applyTokens, clearTokens } from "./apply";
import { BUILT_INS, tokensOf } from "./builtins";
import { deleteTheme, loadAppearance, saveTheme, setUse, themesOf, type Appearance } from "./server";
import { parseTheme, slugOf } from "./validate";
import type { BaseId, ColorKey, ThemeData, TokenMap } from "./types";

const THEMES_KEY = "devdeck.themes";
const MODE_KEY = "devdeck.theme.mode";
const LIGHT_KEY = "devdeck.theme.light";
const DARK_KEY = "devdeck.theme.dark";
/** The one theme that was kept before there were modes. It is read once, then dropped. */
const LEGACY_ACTIVE_KEY = "devdeck.theme.active";
/** The tokens of the theme for each scheme (this + ".light" or ".dark"), kept for the script in index.html, which sets them before the first paint. */
const TOKENS_KEY = "devdeck.theme.tokens";

const maxThemes = 30;

/** Light, dark, or whichever the operating system is using. */
export type Mode = "light" | "dark" | "system";
export type Scheme = "light" | "dark";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: the defaults show
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not kept; the choice still applies until the page is closed
  }
}

/** The custom themes that were kept, each checked again as an imported file would be. */
function readCustom(): ThemeData[] {
  try {
    const parsed: unknown = JSON.parse(read(THEMES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const themes = parsed.map((t) => parseTheme(JSON.stringify(t)).theme).filter((t): t is ThemeData => t !== undefined);
    return themes.filter((t, i) => !(t.id in BUILT_INS) && themes.findIndex((o) => o.id === t.id) === i).slice(0, maxThemes);
  } catch {
    return [];
  }
}

/** A built-in theme as a theme: its base, with no colour changed. */
export const builtInTheme = (id: BaseId): ThemeData => ({ schema: 1, id, name: BUILT_INS[id].name, base: id, colors: {} });

/** Whether a theme is a light page or a dark one, from its background. */
export const schemeOf = (theme: Pick<ThemeData, "base" | "colors">): Scheme => (tokensOf(theme)["color-scheme"] === "dark" ? "dark" : "light");

const isMode = (v: unknown): v is Mode => v === "light" || v === "dark" || v === "system";

/** The theme with this id, if it is a built-in one or one of the custom themes. */
function themeById(id: string, custom: ThemeData[]): ThemeData | undefined {
  if (id === "paper" || id === "paper-dark") return builtInTheme(id);
  return custom.find((t) => t.id === id);
}

const schemeOfId = (id: string, custom: ThemeData[]): Scheme => {
  const theme = themeById(id, custom);
  return theme ? schemeOf(theme) : "light";
};

/** Which scheme is showing: the mode's own, or the operating system's for System. */
const schemeFor = (mode: Mode, osDark: boolean): Scheme => {
  if (mode === "system") return osDark ? "dark" : "light";
  return mode;
};

export type ThemeState = {
  /** The themes the person made. */
  custom: ThemeData[];
  mode: Mode;
  /** The themes used when the page is light and when it is dark. */
  lightId: string;
  darkId: string;
  /** The operating system is using a dark scheme now. */
  osDark: boolean;
  /** The one showing now: the light or dark theme, by the mode. */
  activeId: string;
  /** Unsaved changes to the active custom theme; they show on the page as they are made. */
  draft: ThemeData | null;
  /** Shows a theme, and makes it the one for its scheme (light or dark). */
  select: (id: string) => void;
  setMode: (mode: Mode) => void;
  setOsDark: (dark: boolean) => void;
  /** Makes a custom theme from a theme (or from Paper) and switches to it. */
  create: (name: string, from?: ThemeData) => void;
  /** Sets or, with no colour, resets a role or an Advanced token in the draft. */
  edit: (key: ColorKey, color: string | undefined) => void;
  /** Adds a theme read from a file, under an id of its own, and switches to it. */
  importTheme: (theme: ThemeData) => void;
  rename: (name: string) => void;
  save: () => void;
  discard: () => void;
  remove: (id: string) => void;
};

/** The theme in use as a theme: the draft while there is one. */
export function activeTheme(s: Pick<ThemeState, "custom" | "activeId" | "draft">): ThemeData {
  if (s.draft?.id === s.activeId) return s.draft;
  return themeById(s.activeId, s.custom) ?? builtInTheme("paper");
}

/** Whether the draft differs from what was saved. */
export function isDirty(s: Pick<ThemeState, "custom" | "draft">): boolean {
  if (!s.draft) return false;
  const saved = s.custom.find((t) => t.id === s.draft?.id);
  return JSON.stringify(saved) !== JSON.stringify(s.draft);
}

/** The id of the theme showing for a mode. */
export function resolveId(s: Pick<ThemeState, "mode" | "lightId" | "darkId" | "osDark">): string {
  return schemeFor(s.mode, s.osDark) === "dark" ? s.darkId : s.lightId;
}

function uniqueId(name: string, taken: string[]): string {
  const slug = slugOf(name);
  let id = slug;
  let n = 2;
  while (taken.includes(id) || id in BUILT_INS) {
    id = `${slug.slice(0, 36)}-${n}`;
    n++;
  }
  return id;
}

type Slots = Pick<ThemeState, "mode" | "lightId" | "darkId">;

/** What choosing a theme changes: it becomes the one for its scheme, and the mode shows that scheme (System stays when it already does). */
function choose(id: string, custom: ThemeData[], s: Pick<ThemeState, "mode" | "osDark">): Partial<Slots> {
  const scheme = schemeOfId(id, custom);
  const mode: Mode = s.mode === "system" && scheme === schemeFor("system", s.osDark) ? "system" : scheme;
  return scheme === "dark" ? { darkId: id, mode } : { lightId: id, mode };
}

/** The slots the saved choice gives, or the defaults, and the one kept before modes existed. */
function initialSlots(custom: ThemeData[]): Slots {
  const known = (id: string | null) => (id !== null && themeById(id, custom) ? id : undefined);
  const storedMode = read(MODE_KEY);
  const slots: Slots = {
    mode: isMode(storedMode) ? storedMode : "light",
    lightId: known(read(LIGHT_KEY)) ?? "paper",
    darkId: known(read(DARK_KEY)) ?? "paper-dark",
  };
  const legacy = known(read(LEGACY_ACTIVE_KEY));
  if (legacy && storedMode === null) {
    const scheme = schemeOfId(legacy, custom);
    Object.assign(slots, scheme === "dark" ? { darkId: legacy, mode: "dark" } : { lightId: legacy, mode: "light" });
  }
  return slots;
}

const initialCustom = readCustom();
const initial = initialSlots(initialCustom);
const initialOsDark = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export const useTheme = create<ThemeState>((set, get) => {
  /** Sets some of the state, and works out which theme is showing; a draft only stays while its theme does. */
  const update = (patch: Partial<ThemeState>) => {
    const next = { ...get(), ...patch };
    const activeId = resolveId(next);
    set({ ...patch, activeId, draft: next.draft?.id === activeId ? next.draft : null });
  };
  const current = () => {
    const s = get();
    return s.custom.find((t) => t.id === s.activeId);
  };

  return {
    custom: initialCustom,
    ...initial,
    osDark: initialOsDark,
    activeId: resolveId({ ...initial, osDark: initialOsDark }),
    draft: null,

    select: (id) => update({ ...choose(id, get().custom, get()), draft: null }),

    setMode: (mode) => update({ mode, draft: null }),

    setOsDark: (osDark) => update({ osDark }),

    create: (name, from) => {
      const { custom } = get();
      if (custom.length >= maxThemes) return;
      const theme: ThemeData = {
        schema: 1,
        id: uniqueId(name, custom.map((t) => t.id)),
        name: name.trim().slice(0, 40) || "My theme",
        base: from?.base ?? "paper",
        colors: { ...from?.colors },
      };
      const all = [...custom, theme];
      update({ custom: all, ...choose(theme.id, all, get()), draft: null });
    },

    edit: (key, color) => {
      const s = get();
      const theme = current();
      if (!theme) return; // the built-in themes are not edited; a copy is
      const draft = s.draft ?? { ...theme, colors: { ...theme.colors } };
      const colors = { ...draft.colors };
      if (color === undefined) delete colors[key];
      else colors[key] = color;
      set({ draft: { ...draft, colors } });
    },

    importTheme: (theme) => {
      const { custom } = get();
      if (custom.length >= maxThemes) return;
      const imported: ThemeData = { ...theme, id: uniqueId(theme.name, custom.map((t) => t.id)), colors: { ...theme.colors } };
      const all = [...custom, imported];
      update({ custom: all, ...choose(imported.id, all, get()), draft: null });
    },

    rename: (name) => {
      const s = get();
      const theme = current();
      if (!theme) return;
      set({ draft: { ...(s.draft ?? theme), name: name.slice(0, 40) } });
    },

    save: () => {
      const { custom, draft } = get();
      if (!draft) return;
      const name = draft.name.trim() || "My theme";
      set({ custom: custom.map((t) => (t.id === draft.id ? { ...draft, name } : t)), draft: null });
    },

    discard: () => set({ draft: null }),

    remove: (id) => {
      const { custom, lightId, darkId } = get();
      update({
        custom: custom.filter((t) => t.id !== id),
        lightId: lightId === id ? "paper" : lightId,
        darkId: darkId === id ? "paper-dark" : darkId,
        draft: null,
      });
    },
  };
});

/** Every token name a theme can set, so switching back can take them all off. */
const allTokenNames = [...new Set([...Object.keys(BUILT_INS.paper.tokens), ...Object.keys(BUILT_INS["paper-dark"].tokens)])];
const clearAll: TokenMap = Object.fromEntries(allTokenNames.map((n) => [n, ""]));

/** Whether a theme is plain Paper, which is what tokens.css already shows. */
const isPlainPaper = (theme: ThemeData) => theme.id === "paper" && Object.keys(theme.colors).length === 0;

/** Puts the theme in use on the page: its tokens and the browser frame colour. */
export function applyTheme(s: Pick<ThemeState, "custom" | "activeId" | "draft">): void {
  const theme = activeTheme(s);
  clearTokens(clearAll);
  let frame = BUILT_INS.paper.tokens["--bg"];
  if (!isPlainPaper(theme)) {
    const tokens = tokensOf(theme);
    applyTokens(tokens);
    frame = tokens["--bg"];
  }
  if (typeof document === "undefined") return;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.append(meta);
  }
  meta.content = frame;
}

/**
 * Keeps a copy of the tokens of the saved theme for each scheme, for the boot script, which picks one by the
 * mode and the operating system before the first paint. It is of saved themes only, never of changes being tried.
 */
function cacheSlots(s: Pick<ThemeState, "custom" | "lightId" | "darkId">): void {
  for (const [scheme, id] of [["light", s.lightId], ["dark", s.darkId]] as const) {
    const theme = themeById(id, s.custom);
    write(`${TOKENS_KEY}.${scheme}`, theme && !isPlainPaper(theme) ? JSON.stringify(tokensOf(theme)) : null);
  }
}

// What changes goes to the server one request after another, so a theme is saved before it is chosen.
let queue: Promise<unknown> = Promise.resolve();
const enqueue = (job: () => Promise<unknown>) => {
  queue = queue.then(job).catch(() => undefined); // offline: this browser's copy still has it
};

/** True while the server's answer is being put in the store, so it is not sent straight back. */
let adopting = false;

const slotsOf = (s: Slots) => ({ mode: s.mode, light: s.lightId, dark: s.darkId });

/** Tells the server what changed between two states: themes saved or deleted, and the mode and themes in use. */
function push(s: ThemeState, prev: ThemeState): void {
  if (s.custom !== prev.custom) {
    for (const t of s.custom) {
      if (JSON.stringify(prev.custom.find((o) => o.id === t.id)) !== JSON.stringify(t)) enqueue(() => saveTheme(t));
    }
    for (const t of prev.custom) {
      if (!s.custom.some((o) => o.id === t.id)) enqueue(() => deleteTheme(t.id));
    }
  }
  if (s.mode !== prev.mode || s.lightId !== prev.lightId || s.darkId !== prev.darkId) enqueue(() => setUse(slotsOf(s)));
}

/** Keeps what is saved up to date, and the page showing the theme in use. */
useTheme.subscribe((s, prev) => {
  if (s.custom !== prev.custom) write(THEMES_KEY, JSON.stringify(s.custom));
  if (s.mode !== prev.mode) write(MODE_KEY, s.mode);
  if (s.lightId !== prev.lightId) write(LIGHT_KEY, s.lightId);
  if (s.darkId !== prev.darkId) write(DARK_KEY, s.darkId);
  if (s.custom !== prev.custom || s.lightId !== prev.lightId || s.darkId !== prev.darkId) cacheSlots(s);
  if (!adopting) push(s, prev);
  applyTheme(s);
});

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => useTheme.getState().setOsDark(e.matches));
}

/** Puts what the server holds in the store without sending it straight back. */
function adopt(custom: ThemeData[], slots: Slots, draft: ThemeData | null): void {
  adopting = true;
  try {
    const osDark = useTheme.getState().osDark;
    const activeId = resolveId({ ...slots, osDark });
    useTheme.setState({ custom, ...slots, activeId, draft: draft?.id === activeId && custom.some((t) => t.id === draft.id) ? draft : null });
  } finally {
    adopting = false;
  }
}

/** The mode and the themes the server holds, each checked; a theme that is gone gives way to the built-in one. */
function slotsFromServer(remote: Appearance, themes: ThemeData[]): Slots {
  const known = (id: string) => (themeById(id, themes) ? id : undefined);
  const slots: Slots = {
    mode: isMode(remote.mode) ? remote.mode : "light",
    lightId: known(remote.light) ?? "paper",
    darkId: known(remote.dark) ?? "paper-dark",
  };
  // Before there were modes the server kept one theme: it becomes the one for its scheme, and shows.
  const fresh = remote.mode === "" && remote.light === "" && remote.dark === "";
  const legacy = fresh ? known(remote.active) : undefined;
  if (legacy) Object.assign(slots, schemeOfId(legacy, themes) === "dark" ? { darkId: legacy, mode: "dark" } : { lightId: legacy, mode: "light" });
  return slots;
}

/**
 * Takes the themes and the choice of mode from the server, which is what the desktop window and the browser share.
 * The first time (the server has nothing, this browser has something) it is the other way round: this browser's
 * themes go up. Offline, this browser's own copy stays.
 */
export async function syncThemes(): Promise<void> {
  let remote: Appearance;
  try {
    remote = await loadAppearance();
  } catch {
    return;
  }
  const here = useTheme.getState();
  const themes = themesOf(remote);
  const nothingThere = themes.length === 0 && remote.mode === "" && remote.light === "" && remote.dark === "" && remote.active === "paper";
  const somethingHere = here.custom.length > 0 || here.mode !== "light" || here.lightId !== "paper" || here.darkId !== "paper-dark";
  if (nothingThere && somethingHere) {
    for (const t of here.custom) enqueue(() => saveTheme(t));
    enqueue(() => setUse(slotsOf(here)));
    return;
  }
  const slots = slotsFromServer(remote, themes);
  adopt(themes, slots, here.draft);
  const oldChoice = remote.mode === "" && remote.light === "" && remote.dark === "" && remote.active !== "paper" && themeById(remote.active, themes);
  if (oldChoice) enqueue(() => setUse(slotsOf(slots))); // the old one-theme choice is now kept as a mode and two themes
}

cacheSlots(useTheme.getState());
write(LEGACY_ACTIVE_KEY, null);
applyTheme(useTheme.getState());
