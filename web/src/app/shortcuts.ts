import { useEffect, useRef } from "react";

import { NAV_ITEMS } from "./nav";

/**
 * Keyboard jumps (dev-plans/2026-11-22-sidebar, S5): G, then a key, opens a page. One key per
 * page, chosen to be easy to remember; only built pages get one. The launcher Home will use the
 * same keys.
 */
export const GO_KEYS: Record<string, string> = {
  "/": "h",
  "/workspaces": "w",
  "/repos": "r",
  "/features": "f",
  "/stacks": "s",
  "/logs": "l",
  "/images": "i",
  "/hosts": "o",
  "/doctor": "d",
  "/connections": "c",
  "/plugins": "p",
  "/docs": "?",
  "/settings": ",",
};

/** How long after G the second key still counts. */
export const GO_WINDOW_MS = 1500;

/** The page a key opens after G, if it is a built page. */
export function pathForKey(key: string): string | undefined {
  const k = key.toLowerCase();
  const entry = Object.entries(GO_KEYS).find(([, v]) => v === k);
  if (!entry) return undefined;
  const item = NAV_ITEMS.find((i) => i.path === entry[0]);
  return item?.built ? item.path : undefined;
}

/** The shortcut of a page as keys to show ("G", "S"), or undefined. */
export function shortcutKeys(path: string): string[] | undefined {
  const k = GO_KEYS[path];
  return k ? ["G", k.toUpperCase()] : undefined;
}

/** True when the key press belongs to something being typed in, so shortcuts stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(type);
  }
  return Boolean(target.closest('[role="textbox"], [contenteditable="true"], .cm-editor'));
}

type Handlers = { go: (path: string) => void; toggleSidebar: () => void; now?: () => number };

/**
 * Listens for G then a page's key, and `[` to fold or unfold the sidebar. Ignored while typing,
 * with Ctrl, Alt or Meta held, and for a key another part of the page already handled.
 */
export function useGoShortcuts({ go, toggleSidebar, now = () => Date.now() }: Handlers): void {
  const pending = useRef(0); // when G was pressed, 0 for not waiting
  const handlers = useRef({ go, toggleSidebar, now });
  // The listener is added once; it reads the latest handlers from here.
  useEffect(() => {
    handlers.current = { go, toggleSidebar, now };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat || isTyping(e.target)) return;
      const h = handlers.current;
      const t = h.now();
      if (pending.current && t - pending.current <= GO_WINDOW_MS) {
        pending.current = 0;
        const path = pathForKey(e.key);
        if (path) {
          e.preventDefault();
          h.go(path);
        }
        return;
      }
      pending.current = 0;
      if (e.key === "g" || e.key === "G") {
        pending.current = t;
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        h.toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
