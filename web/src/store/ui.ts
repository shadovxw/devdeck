import { create } from "zustand";

export type Theme = "system" | "dark" | "light";

const KEY = "devdeck.theme";

function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    // storage blocked: fall back to the system theme
  }
  return "system";
}

/** Sets or clears data-theme; with no attribute the OS preference decides. */
function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

type UiState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

export const useUi = create<UiState>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // not persisted; still applies for this session
    }
    applyTheme(theme);
    set({ theme });
  },
}));
