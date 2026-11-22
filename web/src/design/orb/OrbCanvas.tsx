import { useEffect, useRef } from "react";

import { createOrb, type Orb, type OrbColors, type OrbState } from "./scene";

/** The theme's colours for the orb, read from the page (the theme writes them on <html>). */
export function readOrbColors(root: HTMLElement = document.documentElement): OrbColors {
  const css = getComputedStyle(root);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    primary: get("--primary", "#8b5cf6"),
    critical: get("--critical", "#ef4444"),
    good: get("--good", "#22c55e"),
    ink: get("--ink", "#ffffff"),
    live: get("--link", "#22d3ee"),
  };
}

/** The orb's canvas. Loaded lazily by EmptyOrb, so three.js is its own chunk. */
export default function OrbCanvas({ state, still, className }: Readonly<{ state: OrbState; still: boolean; className?: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orb = useRef<Orb | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    orb.current = createOrb(el, { state, colors: readOrbColors(), still });
    // A theme or style change rewrites <html>'s style and data attributes: take the new colours.
    const watch = new MutationObserver(() => orb.current?.setColors(readOrbColors()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-look"] });
    return () => {
      watch.disconnect();
      orb.current?.dispose();
      orb.current = null;
    };
    // state is applied below without rebuilding the scene
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still]);

  useEffect(() => orb.current?.setState(state), [state]);

  return <canvas ref={canvas} aria-hidden className={className} />;
}
