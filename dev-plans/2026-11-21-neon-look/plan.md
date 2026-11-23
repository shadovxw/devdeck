# Neon look: an optional theme with glow, glass and motion effects

> 2026-11-21 · owner: Vrishank Warrier · milestone H7 of [`2026-11-21-desktop-hub/`](../2026-11-21-desktop-hub/plan.md) (moved first, by the owner's choice) · extends [`2026-11-01-custom-themes/`](../2026-11-01-custom-themes/plan.md) and [`02-frontend-design-system.md`](../02-frontend-design-system.md) · status: **first slice built (2026-11-21): a Style setting, Flat (default) or Neon, with the type, labels, marker, grid, glass and hover glow; see [`changes.md`](changes.md). The owner chose a style separate from the theme, so colours always come from the theme. Effects level, glitch and the rest are not started.**

> **2026-11-22: Neon is now the only style.** Flat and the Style setting were removed (portfolio-look plan §8d, P10). Where this plan says "optional" or compares with Flat, read it as history.

## 1. Goal

A dark, minimal, cyberpunk look you can turn on: one neon accent, glow on hover and focus, glass panels, springy motion, a glitch when you change page, optional scanlines and an animated background. Paper stays the default and stays flat and calm. Turning effects off brings back today's app exactly.

**The reference (owner, 2026-11-21):** the owner's own portfolio site: "minimal look + cyberpunk + more effects". What it uses, in general terms: a near-black background, a single cyan accent, a two-colour split (magenta / cyan) for glitch text, a cyan-to-purple gradient for small details, glass panels with backdrop blur, soft cyan glows, film grain, and Inter with JetBrains Mono. The owner's exact colours live in a private theme file (in the git-ignored `tmp/`), not in this repo; the built-in Neon is a neutral take on the same idea.

## 2. Decisions

1. **Two settings, not one.**
   - **Effects: Off / Reduced / Full** (Settings → Appearance). **Changed 2026-11-22** ([`2026-11-21-portfolio-look/`](../2026-11-21-portfolio-look/plan.md), decision 8): until chosen, it follows the style, Off for Flat and Full for Neon (was: Off by default).
   - **Reduce motion** (exists) stays and wins over everything: with it on, nothing moves, whatever Effects says. It also follows Windows' "Show animations" setting, as today.
2. **Effects work with any theme.** The glow colour comes from the theme's primary colour (and `--focus`), so a custom theme with your own accent gets a matching glow. No change to the theme file format in v1.
3. **A built-in Neon theme** joins Paper and Paper Dark: near-black background, one cyan accent, the status colours tuned for a dark screen. Your own colours (for example your portfolio's) go in a custom theme made from it, exported to your private config repo, not into this repo.
4. **All from tokens and CSS, plus Motion where CSS can't do it.** New tokens: `--glow`, `--glow-strong`, `--glass`, `--glass-blur`, `--scan-opacity`. Effects are CSS rules under `:root[data-effects="reduced"]` and `:root[data-effects="full"]`, so a component never checks the setting itself and never hard-codes a colour.
5. **What each level turns on:**

   | Effect | Reduced | Full |
   |---|---|---|
   | Glow on hover and focus (buttons, cards, inputs, the active nav item) | soft | strong |
   | Glass panels (menus, sheets, dialogs, toasts: translucent + backdrop blur) | yes | yes |
   | Open and close: scale + fade + slide | yes | yes |
   | Spring when dragging (Motion `drag` with a spring) | no | yes |
   | Glitch when changing page (about 150 ms, View Transitions) | no | yes |
   | Glitch on headings (two-colour split, plays once on hover or page entry, never loops) | no | yes |
   | Gradient accents (active nav marker, progress bars, the scrollbar thumb) | no | yes |
   | Film grain (a faint static noise layer) | no | if ticked |
   | Scanlines / CRT overlay | no | if ticked |
   | Animated background | no | if ticked |

   Grain, scanlines and the animated background are extra checkboxes under Full, off until ticked. The glitch split colours are two new tokens (`--glitch-a`, `--glitch-b`) set by the theme, with defaults worked out from the primary colour.
   "Minimal" still rules: one accent, few panels, no decoration that doesn't respond to something. The effects make what's there feel alive; they don't add things to the screen.
6. **The animated background is one small canvas** (a slow grid or particle drift drawn with 2D canvas, no WebGL, no new library) behind the page area. It pauses when the window is hidden or minimised, and draws at most 30 frames a second. **One exception (2026-11-22):** the orb on empty pages uses WebGL through three.js, lazy-loaded, only in Neon with Effects above Off; see the portfolio-look plan, decision 9.
7. **Performance budget** (main plan §7.5) holds at Full. Blur is the costly part on WebView2, so it is used only on floating layers (never on lists or the logs view), and anything that misses the budget is cut.
8. **The UI rules in `CLAUDE.md` change in the same PR** as the first effect: "flat, no shadows" stays the rule for Effects Off (the default); glow and glass are allowed only through the effect tokens, above Off.
9. **Fonts:** Geist and Geist Mono stay the default. The portfolio uses Inter and JetBrains Mono, so a **font choice** (Geist / Inter, Geist Mono / JetBrains Mono) is added as PR L5. The fonts are bundled through `@fontsource` like Geist, never loaded from a CDN.

## 3. Pieces

| Where | What |
|---|---|
| `web/src/design/tokens.css` | Effect tokens, worked out from `--primary` and `--focus` with `color-mix()` |
| `web/src/design/effects.css` (new) | Every effect rule, gated by `data-effects` and reduced motion |
| `web/src/store` (UI store) | `effects: "off" \| "reduced" \| "full"`, `scanlines`, `liveBackground`; saved like the other settings |
| `web/src/theme/builtins.ts` | The Neon theme |
| `index.html` inline script | Sets `data-effects` before first paint, from the cached setting (no flash) |
| `web/src/pages/appearance/Appearance.tsx` | The Effects row (segmented Off / Reduced / Full) and the two checkboxes, with tooltips |
| `web/src/design/LiveBackground.tsx` (new) | The canvas, lazy-loaded only when ticked |
| `docs/appearance.md` | An "Effects" section |

## 4. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| L1 | Effects setting (store, `data-effects`, no-flash script, Appearance row), effect tokens, the Neon theme, `CLAUDE.md` rule change | Choosing Neon + Full changes the attribute and tokens; Off looks exactly like today (screenshot compare on Home and Stacks) |
| L2 | Glow on hover and focus; glass on floating layers; open/close motion | Menus, dialogs and toasts are glass at Reduced and Full; Tab focus shows the glow |
| L3 | Glitch page change; spring drag (where panels already drag) | Page changes glitch at Full only; never with Reduce motion or keyboard navigation |
| L4 | Heading glitch, gradient accents, film grain, scanlines, live background canvas | Grain, scanlines and canvas are off by default; the canvas stops drawing when the window is hidden (checked in a test) |
| L5 | Font choice (Inter, JetBrains Mono as options) | Switching fonts changes the whole app with no layout jump |
| later | Terminal colours from the theme | Comes with the terminal (hub milestone H3) |

Tests (Vitest): the store saves and restores the level; the inline script sets the attribute; reduced motion overrides Full; the Neon theme passes the contrast checks; the background pauses on `visibilitychange`.

## 5. Risks

- **Blur cost** on big screens: limited to floating layers, and Reduced keeps it but drops the heavy parts.
- **Glow hurting readability**: glow sits outside the element (box-shadow), never on text; text contrast is still checked by the theme checks.
- **Glitch feeling cheap or causing discomfort**: short, Full only, and off with Reduce motion.

## 6. Open questions

1. Should Neon (with Effects Full) become the **default** look instead of Paper? This plan says no: opt-in.
2. ~~A **font per theme**?~~ Answered 2026-11-21: the owner wants the portfolio's fonts; planned as a font choice in L5 (a setting, not part of the theme file).
3. Should a theme file be able to **carry its effect level** (so importing your theme also turns on Full)? Not in v1.
