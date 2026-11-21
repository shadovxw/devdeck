# Neon look: changes

## 2026-11-21: Style setting (Flat / Neon), first slice

The owner asked for the look of their portfolio mockups (kept privately in `tmp/`) with colours still coming from the theme, and the current look kept as the default. So the look became a **Style** setting, separate from the theme, instead of a theme of its own.

- `web/src/store/ui.ts`: `look: "paper" | "neon"` (label **Flat** / **Neon**; "Paper" was already the theme's name), kept in `localStorage` under `devdeck.look`, applied as `data-look` on `<html>`. Unknown values fall back to Flat. Tests in `ui.test.ts`.
- `web/index.html`: sets `data-look` before first paint, like reduce motion.
- `web/src/design/looks.css` (new): every Neon rule, all from theme tokens (`color-mix()` for glow, grid, glass, gradient). Inter and JetBrains Mono, title weight 900 with an accent full stop, mono upper-case breadcrumb, `//` group labels, a glowing diamond on the active page, a dot grid behind the page, mono buttons with a hover glow, glowing focus, glass menus, sheets and tooltips, the empty-page tiles in theme colours, the wordmark in the accent gradient.
- Fonts are tokens now: `--font-ui` and `--font-code` in `tokens.css`; `theme.css` maps Tailwind's `--font-sans`/`--font-mono` to them. Paper's fonts are unchanged.
- `@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` 5.3.0 (exact), bundled, no CDN. Font files only download when Neon uses them.
- `data-ui` hooks added to the page title, breadcrumb, sidebar group labels, the active-page pill and the wordmark.
- Appearance page: a **Style** row under Mode.
- `CLAUDE.md` UI rules and `docs/appearance.md` say what Neon may do.

Not done yet (later slices of the plan): effects level (Off / Reduced / Full), glitch, spring, grain, scanlines, live background, the gradient word in section headings.
