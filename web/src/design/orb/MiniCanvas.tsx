import { useEffect, useRef } from "react";

import { createMiniOrb, type MiniOrb } from "./mini";
import type { MiniVariant } from "./mini-model";
import { readOrbColors } from "./model";

/** The mini orb's canvas. Loaded lazily by MiniOrb, so three.js stays out of the main bundle. */
export default function MiniCanvas({ variant, still, className }: Readonly<{ variant: MiniVariant; still: boolean; className?: string }>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const orb = useRef<MiniOrb | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    orb.current = createMiniOrb(el, { variant, colors: readOrbColors(), still });
    // A theme change rewrites <html>'s style: take the new colours.
    const watch = new MutationObserver(() => orb.current?.setColors(readOrbColors()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      watch.disconnect();
      orb.current?.dispose();
      orb.current = null;
    };
  }, [variant, still]);

  return <canvas ref={canvas} className={className} />;
}
