import { create } from "zustand";

const SIDEBAR_KEY = "devdeck.sidebar";
const MOTION_KEY = "devdeck.reduce-motion";
const GROUPS_KEY = "devdeck.sidebar.groups";
/** Where the Flat/Neon choice used to be kept; devdeck has one style now, so it is cleared. */
const OLD_LOOK_KEY = "devdeck.look";
const NAME_KEY = "devdeck.name";

/** The longest name the greeting takes. */
export const NAME_MAX = 40;

const EFFECTS_KEY = "devdeck.effects";

/** How much motion and decoration there is: the orb, the launch intro, glow and transitions. */
export type Effects = "off" | "reduced" | "full";

function readEffects(): Effects | null {
  const v = read(EFFECTS_KEY);
  return v === "off" || v === "reduced" || v === "full" ? v : null;
}

/** The effects in use: the person's choice, or full until they choose. */
export function effectiveEffects(chosen: Effects | null): Effects {
  return chosen ?? "full";
}

/** Sets data-effects on the page; off is no attribute at all. */
function applyEffects(effects: Effects): void {
  if (typeof document === "undefined") return;
  if (effects === "off") delete document.documentElement.dataset.effects;
  else document.documentElement.dataset.effects = effects;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage blocked: fall back to the defaults
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // not persisted; the choice still applies for this session
  }
}

/** The sidebar starts collapsed (icons only) until the user expands it. */
function readSidebarOpen(): boolean {
  return read(SIDEBAR_KEY) === "expanded";
}

function readClosedGroups(): string[] {
  try {
    const parsed: unknown = JSON.parse(read(GROUPS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}

/** Sets or clears data-motion on the page: with "reduced" every loop stops and every move is a cut (design/motion.css). */
function applyMotion(reduced: boolean): void {
  if (typeof document === "undefined") return;
  if (reduced) document.documentElement.dataset.motion = "reduced";
  else delete document.documentElement.dataset.motion;
}

type UiState = {
  /** Reduce motion: on stops loops and turns moves into cuts. Remembered between visits, in this browser. */
  reduceMotion: boolean;
  setReduceMotion: (on: boolean) => void;
  /** The effects chosen in Settings, or null for the default (full). Remembered in this browser. */
  effects: Effects | null;
  setEffects: (effects: Effects | null) => void;
  /** Your name, for Home's greeting ("Good evening, Sam."). Empty: no name. Remembered in this browser. */
  name: string;
  setName: (name: string) => void;
  /** Sidebar expanded (labels) or collapsed (icons). Remembered between visits. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Sidebar groups the user has folded shut. Remembered between visits. */
  closedGroups: string[];
  setGroupOpen: (name: string, open: boolean) => void;
};

export const useUi = create<UiState>((set, get) => ({
  reduceMotion: read(MOTION_KEY) === "1",
  setReduceMotion: (reduceMotion) => {
    write(MOTION_KEY, reduceMotion ? "1" : null);
    applyMotion(reduceMotion);
    set({ reduceMotion });
  },

  effects: readEffects(),
  setEffects: (effects) => {
    write(EFFECTS_KEY, effects);
    applyEffects(effectiveEffects(effects));
    set({ effects });
  },

  name: read(NAME_KEY) ?? "",
  setName: (name) => {
    const clean = name.slice(0, NAME_MAX);
    write(NAME_KEY, clean.trim() ? clean : null);
    set({ name: clean });
  },

  sidebarOpen: readSidebarOpen(),
  setSidebarOpen: (sidebarOpen) => {
    write(SIDEBAR_KEY, sidebarOpen ? "expanded" : "collapsed");
    set({ sidebarOpen });
  },

  closedGroups: readClosedGroups(),
  setGroupOpen: (name, open) => {
    const rest = get().closedGroups.filter((g) => g !== name);
    const closedGroups = open ? rest : [...rest, name];
    write(GROUPS_KEY, JSON.stringify(closedGroups));
    set({ closedGroups });
  },
}));

applyMotion(useUi.getState().reduceMotion);
applyEffects(effectiveEffects(useUi.getState().effects));
write(OLD_LOOK_KEY, null);
