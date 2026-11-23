import { lazy, Suspense, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { effectiveEffects, useUi } from "../store/ui";
import type { MiniVariant } from "./orb/mini-model";
import type { OrbState } from "./orb/model";

// three.js loads only here, and only when the orb is shown: it is its own chunk.
const OrbCanvas = lazy(() => import("./orb/OrbCanvas"));

let webglCache: boolean | undefined;

/** Whether this browser can draw WebGL (checked once). */
export function supportsWebGL(): boolean {
  if (webglCache !== undefined) return webglCache;
  try {
    const c = document.createElement("canvas");
    webglCache = Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    webglCache = false;
  }
  return webglCache;
}

export const prefersReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Props = {
  /** idle; thinking only while devdeck is really working; ok (in the success colour) for good-news empties. */
  state?: OrbState;
  /** hero: about 440px, Workspaces with none yet. launcher: about 368px, Home. mini: about 120px, other empty pages. */
  size?: "hero" | "launcher" | "mini";
  /** What shows instead of the orb: with Effects off, or without WebGL. */
  fallback: ReactNode;
  /** For tests: skip the WebGL check. */
  webgl?: boolean;
};

/**
 * The orb on empty pages (dev-plans/2026-11-21-portfolio-look §6.3), or the page's usual art.
 * The orb shows with Effects above off, where WebGL works. Reduce motion
 * or Reduced effects draw one still frame; a hidden window stops it. Decorative: the page's text
 * carries the message.
 */
export function EmptyOrb({ state = "idle", size = "hero", fallback, webgl }: Readonly<Props>) {
  const effects = useUi((s) => effectiveEffects(s.effects));
  const reduceMotion = useUi((s) => s.reduceMotion);

  if (effects === "off" || !(webgl ?? supportsWebGL())) return <>{fallback}</>;

  const still = reduceMotion || effects === "reduced" || prefersReducedMotion();
  const box = { hero: "size-[min(440px,80vw)]", launcher: "size-[var(--orb,368px)]", mini: "size-[120px]" }[size];
  return (
    <div data-ui="orb" data-size={size} data-state={state} aria-hidden className={cn("relative shrink-0", box)}>
      <Suspense fallback={null}>
        <OrbCanvas state={state} still={still} className="block size-full" />
      </Suspense>
    </div>
  );
}

const MiniCanvas = lazy(() => import("./orb/MiniCanvas"));

/**
 * The mini orb (about 120px) on empty pages other than Home (dev-plans/2026-11-21-portfolio-look
 * §8d): one small scene whose variant hints at what the page holds. Same rules as the big orb:
 * plain art with Effects off or without WebGL, a still frame with Reduce motion or Reduced effects.
 */
export function MiniOrb({ variant, fallback, webgl }: Readonly<{ variant: MiniVariant; fallback: ReactNode; webgl?: boolean }>) {
  const effects = useUi((s) => effectiveEffects(s.effects));
  const reduceMotion = useUi((s) => s.reduceMotion);
  if (effects === "off" || !(webgl ?? supportsWebGL())) return <>{fallback}</>;
  const still = reduceMotion || effects === "reduced" || prefersReducedMotion();
  return (
    <div data-ui="mini-orb" data-variant={variant} aria-hidden className="relative size-[120px] shrink-0">
      <Suspense fallback={null}>
        <MiniCanvas variant={variant} still={still} className="block size-full" />
      </Suspense>
    </div>
  );
}
