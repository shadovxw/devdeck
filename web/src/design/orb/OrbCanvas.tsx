import { useEffect, useRef } from "react";

import { readOrbColors, type OrbState } from "./model";
import { createOrb, type Orb } from "./scene";

// Read from the theme in model.ts (no three.js there), so the launch intro can use it too.
export { readOrbColors };

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

  useEffect(() => {
    orb.current?.setState(state);
  }, [state]);

  // Decorative: the box around it (EmptyOrb) is aria-hidden.
  return <canvas ref={canvas} className={className} />;
}
