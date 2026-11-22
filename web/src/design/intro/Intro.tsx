import { colord } from "colord";
import { useEffect, useRef, useState } from "react";

import { Logo } from "../Logo";
import { orbRadiusPx, readOrbColors } from "../orb/model";
import type { IntroScene, IntroTargets } from "./scene";
import { advance, AT, clamp01, FLAT, introAt, outCubic, skipTo, WORD, type IntroMode } from "./timeline";

type Props = {
  mode: Exclude<IntroMode, "none">;
  /** The server has answered: the intro may hand off to the app. */
  ready: boolean;
  /** The server can't be reached: the intro ends on the lockup and the offline screen takes over. */
  offline: boolean;
  /** Time to mount the app under the stage (so Home's orb slot can be measured). */
  onApp: () => void;
  /** The intro is over. */
  onDone: () => void;
};

/** The design's sizes were drawn for a 900px-high window; the 3D lockup scales with the height. */
const DESIGN_HEIGHT = 900;

const rectOf = (el?: Element | null) => {
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? r : undefined;
};

/** Where the particles and the mark land, measured from the app under the stage. */
function measure(): IntroTargets {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const slot = rectOf(document.querySelector('[data-ui="launcher"] [data-ui="orb"]'));
  const orb = slot ? { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2, r: orbRadiusPx(slot.width) } : { x: W / 2, y: H / 2, r: 90 };
  const header = document.querySelector('[data-slot="sidebar-header"]');
  const markEl = [header?.querySelector('[data-ui="logo"]'), header?.querySelector('[data-ui="wordmark-neon"]')].map(rectOf).find(Boolean);
  const mark = markEl ? { x: markEl.left + markEl.height / 2, y: markEl.top + markEl.height / 2, size: markEl.height } : { x: 35, y: 35, size: 26 };
  return { orb, mark };
}

/** The mark's colours: the brand's, from the theme's tokens. */
function markColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const ribbon = get("--brand", "#0bbfa9");
  const lighter = colord(ribbon);
  return { stem: get("--brand-deck-from", "#0fb3b8"), ribbon, prompt: lighter.isValid() ? lighter.lighten(0.12).toHex() : ribbon };
}

/**
 * The launch intro (dev-plans/2026-11-21-portfolio-look §8b, P9b): plays once on a cold start
 * while the server connects, then hands off to the app. In 3D the D assembles, "devdeck" rises
 * beside it, the mark flies into the sidebar and the particles stream into Home's orb, which
 * takes over. "fade" (reduce motion, reduced effects) is a short fade of the flat lockup; "svg"
 * (no WebGL) is the flat lockup with the same letter reveal. Any key or click skips it.
 */
export function Intro({ mode, ready, offline, onApp, onDone }: Readonly<Props>) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const tagline = useRef<HTMLDivElement>(null);
  const flat = useRef<HTMLDivElement>(null);
  const [holding, setHolding] = useState(false);

  // The latest props, for the frame loop.
  const live = useRef({ ready, offline, onApp, onDone });
  useEffect(() => {
    live.current = { ready, offline, onApp, onDone };
  });

  useEffect(() => {
    let raf = 0;
    let gone = false;
    let t = 0;
    let last = performance.now();
    let appShown = false;
    let leaveAt: number | null = null;
    let scene: IntroScene | null = null;
    const root = document.documentElement;
    if (mode === "3d") root.dataset.intro = "";

    const skip = () => {
      t = skipTo(t, live.current.ready);
      if (mode !== "3d" && live.current.ready) leaveAt ??= t;
    };
    const finish = () => {
      if (gone) return;
      gone = true;
      delete root.dataset.intro;
      live.current.onDone();
    };

    const frame3d = () => {
      const f = introAt(t);
      const s = Math.max(0.55, window.innerHeight / DESIGN_HEIGHT);
      const targets = measure();
      scene?.draw(f, t, targets);
      if (canvas.current) canvas.current.style.opacity = String(f.canvas);
      if (backdrop.current) backdrop.current.style.opacity = String(f.backdrop);
      if (glow.current) glow.current.style.opacity = String(f.glow);
      if (stage.current) stage.current.style.pointerEvents = t >= AT.exit ? "none" : "auto";
      if (word.current) {
        const dx = (targets.mark.x + targets.mark.size - window.innerWidth / 2 + 150 * s) * f.exit;
        const dy = (targets.mark.y - window.innerHeight / 2) * f.exit;
        word.current.style.fontSize = `${128 * s}px`;
        word.current.style.opacity = String(f.word);
        word.current.style.transform = `translate(calc(${-150 * s + dx}px), calc(-50% + ${dy}px)) scale(${1 - 0.86 * f.exit})`;
        const letters = word.current.children;
        for (let i = 0; i < letters.length; i++) {
          const e = f.letters[i] ?? 0;
          const el = letters[i] as HTMLElement;
          el.style.opacity = String(e);
          el.style.transform = `translateY(${(1 - e) * 40}px) rotateX(${(1 - e) * 70}deg)`;
          el.style.filter = e < 1 ? `blur(${(1 - e) * 8}px)` : "";
        }
      }
      if (tagline.current) {
        tagline.current.style.opacity = String(f.tagline);
        tagline.current.style.transform = `translateX(${-150 * s}px)`;
        tagline.current.style.top = `calc(50% + ${92 * s}px)`;
      }
      if (t >= 3.9) delete root.dataset.intro; // the real orb fades in as the canvas fades out
      return t >= AT.end;
    };

    const frameFlat = () => {
      const plan = FLAT[mode as "fade" | "svg"];
      if (leaveAt === null && live.current.ready && t >= plan.leave) leaveAt = t;
      const away = leaveAt === null ? 0 : clamp01((t - leaveAt) / plan.out);
      const el = flat.current;
      if (el) {
        el.style.opacity = String((mode === "fade" ? clamp01(t / plan.in) : 1) * (1 - away));
        const logo = el.querySelector<HTMLElement>('[data-ui="intro-mark"]');
        if (logo && mode === "svg") logo.style.opacity = String(clamp01(t / plan.in));
        const letters = el.querySelector('[data-ui="intro-word"]')?.children ?? [];
        for (let i = 0; i < letters.length; i++) {
          const e = mode === "svg" ? outCubic(clamp01((t - 0.5 - i * 0.05) / 0.42)) : 1;
          const l = letters[i] as HTMLElement;
          l.style.opacity = String(e);
          l.style.transform = `translateY(${(1 - e) * 16}px)`;
          l.style.filter = e < 1 ? `blur(${(1 - e) * 6}px)` : "";
        }
        const tag = el.querySelector<HTMLElement>('[data-ui="intro-tagline"]');
        if (tag) tag.style.opacity = String(mode === "svg" ? clamp01((t - 1.0) / 0.4) : 1);
      }
      if (backdrop.current) backdrop.current.style.opacity = String(1 - away);
      return leaveAt !== null && away >= 1;
    };

    const tick = (now: number) => {
      raf = 0;
      if (gone) return;
      // The wall clock, so a slow frame (the app mounting underneath) drops frames rather than
      // stretching the film; a longer gap (the window hidden) counts as one second.
      const dt = Math.min((now - last) / 1000, 1);
      last = now;
      const { ready: isReady, offline: isOffline } = live.current;
      t = mode === "3d" ? advance(t, dt, isReady) : t + dt;
      if (!appShown && isReady && (mode !== "3d" || t >= AT.app)) {
        appShown = true;
        live.current.onApp();
      }
      const waiting = !isReady && (mode === "3d" ? t >= AT.hold : t >= FLAT[mode as "fade" | "svg"].leave);
      setHolding(waiting);
      // Offline: end on the lockup; the offline screen (the dimmed lockup) takes over.
      if (waiting && isOffline) return finish();
      const over = mode === "3d" ? frame3d() : frameFlat();
      if (over) return finish();
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (gone) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };

    if (mode === "3d") {
      import("./scene")
        .then(({ createIntroScene }) => {
          if (gone || !canvas.current) return;
          scene = createIntroScene(canvas.current, { ...markColors(), orb: readOrbColors() });
          start();
        })
        .catch(finish); // no 3D after all: just show the app
    } else start();

    window.addEventListener("keydown", skip);
    window.addEventListener("pointerdown", skip);
    return () => {
      gone = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
      delete root.dataset.intro;
      scene?.dispose();
    };
  }, [mode]);

  return (
    <div ref={stage} data-ui="intro" data-mode={mode} role="status" aria-live="polite" className="fixed inset-0 z-[60] overflow-hidden">
      <span className="sr-only">Starting devdeck…</span>
      <div ref={backdrop} data-ui="intro-backdrop" aria-hidden className="absolute inset-0" />
      {mode === "3d" ? (
        <>
          <div ref={glow} data-ui="intro-glow" aria-hidden className="absolute inset-0 opacity-0" />
          <canvas ref={canvas} aria-hidden className="absolute inset-0 block size-full" />
          <div ref={word} data-ui="intro-word" aria-hidden className="absolute left-1/2 top-1/2 flex origin-left whitespace-nowrap [perspective:600px]">
            {[...WORD].map((ch, i) => (
              <span key={i} data-deck={i >= 3 || undefined} className="inline-block opacity-0">
                {ch}
              </span>
            ))}
          </div>
          <div ref={tagline} data-ui="intro-tagline" aria-hidden className="absolute left-1/2 opacity-0">
            Your developer cockpit
          </div>
        </>
      ) : (
        <div ref={flat} data-ui="intro-flat" aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-5 opacity-0">
          <div className="flex items-center gap-5">
            <span data-ui="intro-mark">
              <Logo className="size-[clamp(64px,10vw,110px)]" />
            </span>
            <span data-ui="intro-word" className="flex whitespace-nowrap">
              {[...WORD].map((ch, i) => (
                <span key={i} data-deck={i >= 3 || undefined} className="inline-block">
                  {ch}
                </span>
              ))}
            </span>
          </div>
          <div data-ui="intro-tagline">Your developer cockpit</div>
        </div>
      )}
      {holding && <div data-ui="intro-wait" aria-hidden />}
      {!holding && (
        <p data-ui="intro-skip" aria-hidden className="absolute bottom-5 right-6 m-0">
          Any key to skip
        </p>
      )}
    </div>
  );
}
