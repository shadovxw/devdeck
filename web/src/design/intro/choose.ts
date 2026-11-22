import { effectiveEffects, useUi } from "../../store/ui";
import { prefersReducedMotion, supportsWebGL } from "../EmptyOrb";
import { introMode, type IntroMode } from "./timeline";

const SEEN_KEY = "devdeck.intro";

/** Whether the intro already played in this app session (a reload or a new page does not replay it). */
function seen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked: don't risk replaying it on every load
  }
}

/** Remembers, for this app session, that the intro played. */
export function markIntroSeen(): void {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    // not kept; it may play again on the next load
  }
}

/** How the intro plays on this start, from the settings and what this machine can do. */
export function chooseIntro(): IntroMode {
  const ui = useUi.getState();
  const effects = effectiveEffects(ui.look, ui.effects);
  return introMode({
    seen: seen(),
    look: ui.look,
    effects,
    reduceMotion: ui.reduceMotion || prefersReducedMotion(),
    // Checked only when it matters: it creates a WebGL context.
    webgl: ui.look === "neon" && effects === "full" && supportsWebGL(),
  });
}
