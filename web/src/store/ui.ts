import { create } from "zustand";

export type Theme = "system" | "dark" | "light";

const THEME_KEY = "devdeck.theme";
const SIDEBAR_KEY = "devdeck.sidebar";
const GROUPS_KEY = "devdeck.sidebar.groups";

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

function readTheme(): Theme {
  const v = read(THEME_KEY);
  return v === "dark" || v === "light" ? v : "system";
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

/** Sets or clears data-theme; with no attribute the OS preference decides. */
function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

type UiState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Sidebar expanded (labels) or collapsed (icons). Remembered between visits. */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  /** Sidebar groups the user has folded shut. Remembered between visits. */
  closedGroups: string[];
  setGroupOpen: (name: string, open: boolean) => void;
};

export const useUi = create<UiState>((set, get) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    write(THEME_KEY, theme === "system" ? null : theme);
    applyTheme(theme);
    set({ theme });
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
