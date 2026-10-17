import { useSyncExternalStore } from "react";

// Whether the last thing the user did was press a key or use the pointer.
// Keyboard-initiated actions should not animate (they repeat hundreds of times a
// day), so CSS and the motion components check this. It is also written to
// <html data-input="keyboard|pointer"> so plain CSS can react to it.

export type InputMode = "pointer" | "keyboard";

let mode: InputMode = "pointer";
let started = false;
const listeners = new Set<() => void>();

function set(next: InputMode) {
  if (next === mode) return;
  mode = next;
  document.documentElement.dataset.input = next;
  for (const l of listeners) l();
}

/** Starts listening. Safe to call more than once. */
export function startInputMode() {
  if (started) return;
  started = true;
  document.documentElement.dataset.input = mode;
  // Capture phase: runs before any handler that starts an animation (Ctrl+B).
  window.addEventListener("keydown", () => set("keyboard"), true);
  window.addEventListener("pointerdown", () => set("pointer"), true);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useInputMode(): InputMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "pointer",
  );
}
