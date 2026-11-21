import { create } from "zustand";

const SIDEBAR_KEY = "devdeck.sidebar";
const MOTION_KEY = "devdeck.reduce-motion";
const GROUPS_KEY = "devdeck.sidebar.groups";
const LOOK_KEY = "devdeck.look";

/** The style of the app: its type, shape and details. Colours always come from the theme. */
export type Look = "paper" | "neon";

function readLook(): Look {
  const v = read(LOOK_KEY);
  return v === "neon" ? "neon" : "paper";
}

/** Sets data-look on the page; the Neon rules in design/looks.css hang off it. Paper is no attribute at all. */
function applyLook(look: Look): void {
  if (typeof document === "undefined") return;
  if (look === "paper") delete document.documentElement.dataset.look;
  else document.documentElement.dataset.look = look;
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
  /** Paper (the default) or Neon. Remembered between visits, in this browser. */
  look: Look;
  setLook: (look: Look) => void;
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

  look: readLook(),
  setLook: (look) => {
    write(LOOK_KEY, look === "paper" ? null : look);
    applyLook(look);
    set({ look });
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
applyLook(useUi.getState().look);
