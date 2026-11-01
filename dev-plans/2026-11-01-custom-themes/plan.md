# Custom themes: let the user change the colours

> 2026-11-01 · owner: Vrishank Warrier · extends [`02-frontend-design-system.md`](../02-frontend-design-system.md) §2 (colour) and §12 (dark theme) · status: **built (2026-11-01): T1 to T6 and S1 to S4. Density, the font size and the code font are not planned yet.**

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
| Background | `--bg` | `--sidebar`, `--inset`, `--scrim`, the status strip tones, `color-scheme` (light or dark), and (in T2) the browser frame colour (`<meta theme-color>`) |
| Menus and panels | `--surface-float`, `--surface-1` | |
| Buttons and fields | `--fill` | `--fill-hover`, `--fill-press` (a step darker or lighter, depending on the background) |
| Text | `--ink` | `--ink-2`, `--ink-3` (the text blended toward the background, kept above 4.5:1) |
| Primary button | `--primary` | `--primary-hover`, `--on-primary` (black or white, whichever reads better), `--link`, `--focus` |
| Selected | `--selected` | the sidebar's active marker, the tab underline |
| Success | `--good` | |
| Warning | `--warning` | `--serious` (the orange between warning and error) |
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
| T1 (built) | `web/src/theme/`: the role-to-token map, derivation with `colord`, the hex validator, `applyTheme()`; the two built-in themes; table tests for derivation and contrast | 6 | `applyTheme(paper)` gives exactly today's `tokens.css` values; derived colours pass the contrast rules for both built-ins |
| T2 (built) | Theme store (Zustand) and boot: replace the unused system/dark/light switch in `store/ui.ts`, the `localStorage` cache, the inline script in `index.html`, `theme-color` and `color-scheme` follow the background | 5 | Reload with Paper Dark shows no flash; the old switch code is gone |
| T3 (built) | Settings → Appearance: theme list, role rows with `react-colorful`, live preview, Save and Discard, contrast marks | 7 | A colour change shows in the whole app at once; Discard restores it |
| T4 (built) | Server: `GET/PUT/DELETE /api/v1/themes` and the active id on `internal/store` (SQLite migration), the web hook with the cache as fallback; Go table tests | 8 (Go and web as two PRs if it passes 10) | The browser and the desktop window show the same saved theme |
| T5 (built) | Duplicate, rename, import and export (JSON, validated), the Advanced token list | 5 | A theme exported on one machine imports on another; a bad file is refused with a reason |
| T6 (built) | Docs: design doc §2.1 and §12 (themes are data, dark is a preset), the user guide page | 3 | |

T1 and T2 change no screen by themselves. Each PR builds and passes tests alone.

## 8. Open questions

1. **One colour set or a light and a dark pair per custom theme?** Plan: one set, with a "start from Paper or Paper Dark" choice. A pair doubles the pickers.
2. **Can the user change the status colours?** Plan: yes, but with the ≥ 3:1 guard, because their meaning (green is healthy) must stay readable.
3. **Should the logo follow the theme?** Plan: no, brand colours stay fixed; only the sidebar wordmark's neutral part uses the text colour.
4. **Palette command and OS dark mode**: follow the OS automatically (Paper by day, Paper Dark by night) as an opt-in? Plan: later, after T3.

## 9. T1 as built (2026-11-01)

`web/src/theme/`, with `colord` 2.10.0 pinned (its a11y plugin only; the picker `react-colorful` waits for T3):

- `types.ts`: the ten roles (`ROLES`), `ThemeData`, `TokenMap`.
- `derive.ts`: `tokensWith(base, colors)` sets the picked colours and works out the rest (soft text kept at 4.5:1 or better, fill hover and press, primary hover and on-primary, sidebar, strip tones, scrim, `color-scheme`); `blend`, `contrast`, `readableOn`.
- `builtins.ts`: **Paper** (the values of `tokens.css`, checked by a test against the file) and **Paper Dark** (worked out from its own ten colours, plus light logo marks and a heavier shadow); `tokensOf(theme)`, `roleColor`.
- `checks.ts`: `contrastChecks(tokens)`, ten pairs for the Appearance page's marks (text 4.5:1, dots and focus ring 3:1).
- `validate.ts`: `isHexColor` (`#rgb` or `#rrggbb` only), `parseTheme` for imported files, `slugOf`.
- `apply.ts`: `applyTokens` and `clearTokens` (`style.setProperty`, nothing built from text).

Both built-in themes pass every contrast check. Nothing calls the theme code yet, so no screen changes.

## 10. T2 and T3 as built (2026-11-01)

- **Store** (`web/src/theme/store.ts`, Zustand): `custom` themes, `activeId` (`paper`, `paper-dark` or a custom id), and an unsaved `draft` of the active custom theme. `applyTheme` clears every token a theme can set, then sets the active theme's (nothing at all for plain Paper, which is what `tokens.css` shows), updates `<meta name="theme-color">` to the page colour and keeps a copy of the tokens for the boot script. The copy is only ever of a saved theme, never of a draft. Themes and the active id are kept in this browser (`devdeck.themes`, `devdeck.theme.active`) until T4 moves them to the server; what is read back is checked again like an imported file.
- **Boot**: `index.html`'s inline script reads `devdeck.theme.tokens` and sets only plain `--name` and `color-scheme` values before first paint; `main.tsx` imports the store so the page is right at start. The old system, dark and light switch is gone from `store/ui.ts` (and its test).
- **Settings page** (`/settings`, `SettingsPage` → `pages/appearance/`): the theme list (Paper and Paper Dark built in, then the person's own; New theme, delete asks first), and for the theme in use the ten roles with a swatch that opens a `react-colorful` picker (square, flat), a hex box, a contrast mark ("7.1:1", or "too faint" with a red dot), and a reset to the base colour. Built-in themes are shown but not edited: **Make my own** copies one. Changes show on the whole app at once; **Save** keeps them, **Discard** goes back, and leaving the page with unsaved changes asks (Save and leave, Discard and leave, Stay).
- `react-colorful` 5.8.1 is pinned.

## 11. T4 as built (2026-11-01)

- **Database**: migration `0004_themes.sql` adds `themes (id, name, base, colors JSON, updated_at)`. The theme in use is the `theme.active` row of `settings`.
- **API** (`internal/api/themes.go`, Deps `Themes`, wired in `internal/server`): `GET /api/v1/appearance` (themes and the one in use), `PUT /appearance/themes/:id` (add or replace), `DELETE /appearance/themes/:id` (if it was in use, Paper is again), `PUT /appearance/active` (`{"id": ...}`). Everything is checked on the way in, as on the page: schema 1, an id of lower case letters, digits and dashes that is not `paper` or `paper-dark`, a name of 1 to 40 characters, a base of `paper` or `paper-dark`, and every colour `#rgb` or `#rrggbb` (saved as six digits, lower case); unknown roles are dropped; at most 30 themes. A refusal is a 422 with the reason. The routes are not on the Claude connector's allow-list, so Claude Code gets a 403.
- **Web** (`web/src/theme/server.ts`, `store.ts`): each change goes to the server one request after another (a theme is saved before it is chosen; a deletion goes before the new choice). Unsaved changes are never sent. `syncThemes()` runs at start: it takes the server's themes and the one in use (each checked again); the first time, when the server has none and this browser has some, this browser's themes go up instead. Offline, this browser's copy stays. The copy in `localStorage` is still what the boot script reads for the first paint.
- **Checked**: Go table tests (`themes_test.go`) for saving, replacing, deleting, the theme in use, refusals, the limit and the connector's 403; web tests (`sync.test.ts`) with a stubbed server; and by hand against the running app: a theme made in the browser was on the server after a reload with this browser's copy cleared.

## 12. T5 as built (2026-11-01)

- **Duplicate and rename**: a custom theme's header has the name box (rename, saved with Save), **Duplicate** (a copy with its colours, named "... copy") and **Export**.
- **Export and import** (`web/src/theme/file.ts`): Export downloads `<id>.devdeck-theme.json` with only `schema`, `id`, `name`, `base` and `colors`, so it is safe to share. **Import** (in the theme list) reads a file of up to 20 KB, checks it as the server does (schema 1, a name of 1 to 40 characters, a base of paper or paper-dark, every colour `#rgb` or `#rrggbb`), drops what it does not know, gives the theme an id of its own (so a file never overwrites a theme) and switches to it. A refused file says why, in an alert under the list.
- **Advanced**: a folded list under the ten roles with one colour for each worked-out token (`ADVANCED` in `types.ts`: soft and muted text, hover and pressed fills, inset, the primary's hover and text, link, focus ring, the orange, the four timeline tones, and the sidebar's seven). A value set there is kept in the theme's `colors` under the token's name (`--ink-2`) and wins over what the roles work out, including when a role changes later; reset puts back the worked-out value. The server accepts exactly those token names, as hex colours only (no migration: they sit in the same `colors` JSON).

## 13. The Settings mockup (2026-11-01): slices S1 to S4, and what waits

The owner's Settings mockup (a left list of sections; Appearance with Mode, Density, font size, code font and Reduce motion; a theme gallery with miniatures; an editor with graded colours and a live preview) is built in slices. Decided: keep Save and Discard (the mockup autosaves), and keep Paper's own colours (the mockup's navy `#0b2a6f` is not adopted).

- **S1 built, the layout**: `SettingsPage` has a list of sections at the left (Appearance is current; General, Terminal & editor, Logs, Notifications, Keyboard, Data & storage and About are listed but disabled, so the page does not move when they arrive) and the section at the right. The mockup's "Search settings" box is left out until there is more than one section to search.
- **S2 built, gallery, grouped editor and preview**: the theme list became a gallery of miniatures (`ThemeThumb`, drawn from each theme's own tokens) with "built in" and "in use" tags and a "New theme" tile; Import sits under it. The editor has a bar (a built-in theme: **Duplicate & edit**; your own: rename, **Save** and **Discard** when changed, Duplicate, Export, Delete asks first), the colours grouped as Surfaces, Text, Accent and Status, each with what it is for and its grade (**AAA** from 7:1, **AA** when it meets what it needs, **LOW** when it does not, with the ratio), the Advanced list, and a sticky **Preview** (a small stack page drawn in the theme's colours, with a line saying whether every text and status colour passes AA or which ones are hard to read).
- **S3 built (see section 14)**: Mode (Light, Dark, System) with one theme for light and one for dark; System follows the OS. Needs the store to keep two "in use" ids, the server's `theme.active` to become two settings rows, and the boot script to pick by `prefers-color-scheme`.
- **S4**: Reduce motion (the `data-motion="reduced"` setting that performance mode already uses).
- **Later, each with its own plan**: Density, the interface font size and the code font. Sizes and row heights are fixed pixels today, so these touch most pages.

## 14. S3 as built (2026-11-01): Light, Dark and System

- **Model** (`web/src/theme/store.ts`): the store keeps a `mode` (`light`, `dark` or `system`), the theme for light (`lightId`) and the theme for dark (`darkId`), whether the OS is dark now (`osDark`, kept current from `prefers-color-scheme`), and `activeId`, which is worked out from them (the light or dark theme by the mode; for System, by the OS). A theme's scheme is read from its background (`schemeOf`): a light theme made dark counts as dark. Defaults: mode light, Paper for light, Paper Dark for dark, so nothing changes for anyone who never opens Settings.
- **Choosing a theme** makes it the one for its scheme and shows that scheme (System stays when the theme is for the scheme the OS is using). A new or imported theme is for the scheme of the theme it came from. Deleting a theme gives its slot back to Paper or Paper Dark. Edits are to the theme showing; an unsaved change is dropped when another theme shows.
- **Settings page**: a **Mode** row (Light, Dark, System) above the gallery, and gallery tags that say **in use**, **for light** or **for dark**, or just the scheme.
- **Server**: `GET /api/v1/appearance` now returns `mode`, `light`, `dark` (empty until a choice has been saved) and `active` (the one theme kept before modes). `PUT /appearance/active` is replaced by `PUT /appearance/use` with `{"mode", "light", "dark"}`, checked (a known mode, and each theme built in or kept) and saved in one transaction, which also drops the old `theme.active` row. Deleting a theme clears any slot that used it. Still no migration: the rows live in `settings`.
- **Moving over**: a theme chosen under the old one-theme setting becomes the theme for its scheme, mode shows that scheme, and the server is told. This browser's old `devdeck.theme.active` is read once and dropped.
- **Start without a flash**: the browser keeps the tokens of each scheme's theme (`devdeck.theme.tokens.light` and `.dark`) and the mode; the script in `index.html` picks by the mode and, for System, by `prefers-color-scheme`. Plain Paper keeps none (the stylesheet is Paper). Only saved themes are kept there, never changes being tried.

## 15. S4 and T6 as built (2026-11-01)

- **Reduce motion** (S4): an Off/On row in Appearance, kept in this browser (`devdeck.reduce-motion`) by `store/ui.ts`, which sets `data-motion="reduced"` on the page (the CSS for it already existed for performance mode: loops stop, durations become cuts) and tells the Motion library to reduce too (`MotionConfig reducedMotion="always"`). The boot script in `index.html` sets it before the first paint. The OS setting still reduces motion by itself. The Mode and Reduce motion rows share one `SegmentedRow`.
- **Docs** (T6): the user guide [`docs/appearance.md`](../../docs/appearance.md); the design doc's section 12 now describes Paper Dark, custom themes and modes (and the rule that components never hard-code colours); `CLAUDE.md`'s UI rules say the same; and [`changes.md`](changes.md) lists what changed.
