import { create } from "zustand";

/**
 * The current project (dev-plans/2026-11-22-projects §9, PJ3; what the sidebar plan called S6):
 * the one you opened last. Stacks, Logs and Health show it unless the address names another
 * (?workspace=), and the sidebar's switcher says which it is. Kept in this browser.
 */
const KEY = "devdeck.project";

function read(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

type Store = {
  id: string | null;
  /** Makes a project the current one (opening it, or choosing it on a page). */
  set: (id: string) => void;
};

export const useCurrentProject = create<Store>((set) => ({
  id: read(),
  set: (id) => {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      // not kept; it still applies until the page reloads
    }
    set({ id });
  },
}));

/**
 * Which project a page shows: the one the address names, else the current one (if it still
 * exists), else the page's own default.
 */
export function pickProject(asked: string | null, current: string | null, ids: string[], fallback: string | undefined): string | undefined {
  if (asked) return asked;
  if (current && ids.includes(current)) return current;
  return fallback;
}
