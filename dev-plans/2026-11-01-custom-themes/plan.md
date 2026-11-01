# Custom themes: let the user change the colours

> 2026-11-01 · owner: Vrishank Warrier · extends [`02-frontend-design-system.md`](../02-frontend-design-system.md) §2 (colour) and §12 (dark theme) · status: **plan, nothing built**

## 1. Goal

Settings gets an **Appearance** page where the user picks a theme or makes their own: background, cards, buttons, text and so on, each with a colour picker, with the result shown live. Themes are saved, can be copied, exported and imported, and the app can always go back to the default (Paper).

Not a goal: changing layout, radius, type or motion. Those stay fixed so every theme still looks like devdeck.

## 2. Libraries (so we write little code)

| Need | Library | Why | Notes |
|---|---|---|---|
| Colour picker | [`react-colorful`](https://github.com/omgovich/react-colorful) 5.8.1, MIT | Tiny (about 3 KB gzipped per its README), no dependencies, React 16.8+ (we are on 19), accessible (keyboard, ARIA), gives `HexColorPicker` and `HexColorInput` | We style the wrapper with our tokens; the picker itself is not themed by us |
| Colour maths | [`colord`](https://github.com/omgovich/colord) 2.10.0, MIT | About 1.7 KB gzipped per its README, same author, immutable. Plugins: **a11y** (WCAG contrast, "readable" check), **mix** (blend two colours), **harmonies** (optional) | Used to derive hover, press, muted text and "text on button" from the colours the user picked |
| Validation | none (a 3-line hex check) | A theme value is only ever `#rgb`, `#rrggbb` or `#rrggbbaa` | Keeps user text out of CSS (see §6) |

Looked at and left out: `culori` (about 1.1 MB unpacked, only needed if we want OKLCH palettes later), `chroma-js` (dual licence, larger), `@radix-ui/colors` (a fixed palette, not a picker). Pin both new packages to exact versions, as CI scans every dependency.

## 3. What the user can edit

Ten **roles**, each mapped to the existing tokens in `web/src/design/tokens.css`. The user picks the role colour; the rest is derived with `colord`.

| Role (label in the UI) | The user picks | Derived from it |
|---|---|---|
| Background | `--bg` | `--sidebar`, `--scrim`, the browser frame colour (`<meta theme-color>`), `color-scheme` (light or dark by luminance) |
| Cards and panels | `--surface-1`, `--surface-float` | `--inset` (a step toward the text colour) |
| Buttons and fields | `--fill` | `--fill-hover`, `--fill-press` (a step darker or lighter, depending on the background) |
| Text | `--ink` | `--ink-2`, `--ink-3` (the text blended toward the background, kept above 4.5:1) |
| Primary button | `--primary` | `--primary-hover`, `--on-primary` (black or white, whichever reads better), `--link`, `--focus` |
| Selected | `--selected` | the sidebar's active marker, the tab underline |
| Success | `--good` | |
| Warning | `--warning`, `--serious` | |
| Error | `--critical` | |
| Neutral | `--neutral` | the stopped ring, the strip colours (`--strip-*`) |

An **Advanced** section lists every remaining token with its own picker, for the few people who want that.

Fixed for every theme: the brand logo colours, radius 0, the shadow recipe, motion and type.

## 4. How it works

1. **A theme is data**: `{ schema: 1, id, name, base: "paper" | "paper-dark", colors: { role: "#rrggbb" } }`. Only the roles the user changed are stored; the rest come from the base theme.
2. **Applying a theme** = computing the full token list from the base plus the overrides, then setting each as a CSS variable on `document.documentElement.style` (`setProperty`). No `<style>` text is built from user input. Tailwind (`@theme inline`) and the charts already read the variables at run time, so nothing else changes.
3. **Built-in themes** ship in code: **Paper** (today's default) and **Paper Dark** (the dark theme §12 of the design doc says is still to design: it becomes a preset, which is cheaper than a second stylesheet). A third, **High contrast**, is optional.
4. **No flash on start**: the chosen theme's computed variables are cached in `localStorage`, and the inline script in `index.html` (which sets the theme before first paint today) applies them. The saved copy on the server is the truth; the cache is only for speed.
5. **Persistence**: themes live on the server in the data folder through `internal/store` (SQLite, table `themes`, plus the active theme id), so the desktop window and the browser show the same thing. If the server is unreachable the cached copy is used.
6. **Contrast guard**: each role row shows its contrast ratio ("7.2:1") with a plain pass or warn mark. Rules: text on background, text on cards, text on buttons, primary-button text on primary, and `--ink-3` on background all ≥ 4.5:1; status dots and the focus ring ≥ 3:1. A theme that fails still saves (it is the user's choice) but the row says so, and **Reset** puts the role back.

## 5. The Appearance page (Settings)

- Left: the theme list (built-ins, then custom), with New, Duplicate, Rename, Delete (delete asks first), Import, Export.
- Right: the ten roles, each a swatch + hex box that opens the picker; contrast mark; per-role Reset; Advanced folded away.
- Live preview: changes apply to the whole app at once (the page itself is the preview). **Save** keeps it; **Discard** goes back to the saved theme. Leaving the page with unsaved changes asks.
- Flat Paper look, minimal text, tooltips for explanations. Keyboard first: every picker works from the keyboard, and "Switch theme" is a command in the Ctrl+K palette once that exists.

## 6. Safety

- Only validated hex values are stored or applied; an imported file is checked against `schema: 1`, unknown keys are dropped, and anything that is not a hex colour is refused with the reason. Names are plain text, at most 40 characters.
- Nothing from a theme file is ever run, evaluated or put into a stylesheet as text.
- Themes hold colours only: no secrets, paths or names of the user's systems. Exported files are safe to share.
- The public repo ships only the built-in themes. A user's own themes live in their data folder.

## 7. Work in small PRs

| PR | What | Files (about) | Done when |
|---|---|---|---|
| T1 | `web/src/theme/`: the role-to-token map, derivation with `colord`, the hex validator, `applyTheme()`; the two built-in themes; table tests for derivation and contrast | 6 | `applyTheme(paper)` gives exactly today's `tokens.css` values; derived colours pass the contrast rules for both built-ins |
| T2 | Theme store (Zustand) and boot: replace the unused system/dark/light switch in `store/ui.ts`, the `localStorage` cache, the inline script in `index.html`, `theme-color` and `color-scheme` follow the background | 5 | Reload with Paper Dark shows no flash; the old switch code is gone |
| T3 | Settings → Appearance: theme list, role rows with `react-colorful`, live preview, Save and Discard, contrast marks | 7 | A colour change shows in the whole app at once; Discard restores it |
| T4 | Server: `GET/PUT/DELETE /api/v1/themes` and the active id on `internal/store` (SQLite migration), the web hook with the cache as fallback; Go table tests | 8 (Go and web as two PRs if it passes 10) | The browser and the desktop window show the same saved theme |
| T5 | Duplicate, rename, import and export (JSON, validated), the Advanced token list | 5 | A theme exported on one machine imports on another; a bad file is refused with a reason |
| T6 | Docs: design doc §2.1 and §12 (themes are data, dark is a preset), the user guide page | 3 | |

T1 and T2 change no screen by themselves. Each PR builds and passes tests alone.

## 8. Open questions

1. **One colour set or a light and a dark pair per custom theme?** Plan: one set, with a "start from Paper or Paper Dark" choice. A pair doubles the pickers.
2. **Can the user change the status colours?** Plan: yes, but with the ≥ 3:1 guard, because their meaning (green is healthy) must stay readable.
3. **Should the logo follow the theme?** Plan: no, brand colours stay fixed; only the sidebar wordmark's neutral part uses the text colour.
4. **Palette command and OS dark mode**: follow the OS automatically (Paper by day, Paper Dark by night) as an opt-in? Plan: later, after T3.
