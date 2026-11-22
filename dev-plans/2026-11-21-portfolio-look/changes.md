# Neon, refined: changes

## 2026-11-21: P0

Plan written from the owner's brief and mockups (kept private in `tmp/`). Flagged for the owner: replace or add (Q1), nav group names (Q2), the greeting's name (Q3), the Effects default (Q4), the primary button colour (Q5); the orb as the one WebGL exception (decision 9).

## 2026-11-22: P1, the shell

Owner's answers recorded in the plan (§8): refine Neon, match the mockup (nav regrouped, white primary button, Effects follow the style), no built-in Neon theme; Neon options (size, fonts, gradient colours) added as P8.

- **Nav regrouped** (`web/src/app/nav.ts`) into the mockup's five sections, for both styles: Overview (Home, Workspaces, Repositories, Features), Run locally (Stacks, Logs, Resources, Remote hosts), Data (Databases and its pages, Storage), Automate (Flows and Runs, Findings, Images and tags, Flow trace), System (Secrets, Plugins, Connections and its pages, Claude access, Notifications, Doctor, Docs, Settings). Only whole page entries moved (checked line by line); two tests updated for the new group names. This is the one change Flat also shows.
- **`web/src/design/looks.css`, Neon:**
  - Tokens: quiet-control fills from 7% ink, `--serious` = warning (no orange), sidebar on the page with a 6% ink active row, floating layers glow instead of a shadow, `--neon-panel` (the theme's card colour), `--neon-glass`, `--neon-live`, `--neon-line`. The theme writes its colours inline on `<html>`, so the few tokens Neon overrides use `!important`.
  - Top bar: 72px, on the page colour (the theme's card colour painted it before), quiet controls 44px, mono upper case.
  - Sidebar: `// GROUP` labels, 36px rows at 14px, a hollow diamond per row instead of the icon (icons stay when folded), the active row's diamond filled in the accent with glow, the `dd.` wordmark (logo only when folded).
  - Buttons: the main one solid ink (white on dark) with page-coloured text, 48px; secondary and outline transparent with a 1px line; all mono upper case; glow on hover.
  - `.look-neon` / `.look-flat`: parts that exist in one style only; a Neon-only part is not drawn in Flat at all.
- Hooks: `data-ui="topbar"`, `data-ui="quiet"` (workspace switcher), `data-ui="logo"`, the Neon wordmark span; `btn-primary` / `btn-quiet` marker classes on the shared button strings (`design/buttons.ts`), so the empty-state buttons follow too.
- **Moved to P2:** `Tag`, with the other shared pieces.

Checked: typecheck, lint, all 575 web tests (the Docs page test once took 8 s under load and timed out; it passes alone and in a second full run). In the browser: Neon Home and Settings match the mockups' shell; Flat compared by eye with its earlier screenshot: unchanged except the group names.

## 2026-11-22: P2, the shared pieces

- New in `web/src/design/`, each tested in `pieces.test.tsx` (14 tests):
  - **`SectionHeader`**: `[01] $ UP  STACKS ─── TOTAL_STACKS: 04` and an optional display heading whose last word gets the accent gradient. Neon only (`look-neon`): Flat has no such header, so Flat pages don't change.
  - **`Panel`**: a named section with its heading, an optional Neon-only kicker (`02 $`) and an action. Flat draws exactly what pages drew before (a small heading over the content, no box); Neon draws the theme's card colour with a mono label row.
  - **`StatusStrip`**: `KEY:: VALUE` pairs in a `<dl>`; Neon colours the value by its meaning (ok, live, warn, bad), Flat shows plain text. The word always carries the meaning.
  - **`StageRail`**: marks joined by a line, labels under them, and a screen-reader summary ("3 of 5 stages done, next: Migrate"; "stuck at" when warning). Flat: small squares, filled in ink; Neon: diamonds, filled in the accent (the warning colour when stuck).
  - **`Tag`**: a status word; Flat adds a status dot, Neon draws a thin box in the status colour.
- **`web/src/design/pieces.css`** (imported after `looks.css`): the base marks for `StageRail` and every piece's Neon look, from theme tokens only.
- **Home** uses `SectionHeader` (Neon) above the running stacks and `Panel` for the "Now" column. The rest of Home's layout is P3.

Checked: typecheck, lint, all 589 web tests. In the browser, with a throwaway demo workspace running two small Node services (in the git-ignored dev data folder, `.devdeck/data`): Neon Home shows the section header and the panel; Flat Home compared with the committed `HomePage.tsx` swapped back in for a moment: identical apart from the uptime counter.

## 2026-11-22: P3, Home

- **`web/src/pages/home/NeonHome.tsx`** (new): Home in the Neon style, rendered instead of the Flat layout when Neon is on (`HomePage.tsx` chooses; the Flat code path is unchanged). It shows only what devdeck knows:
  - A compact header: mono kicker (`WORKSPACE · <name or "N workspaces"> · SUN 22 NOV`), "Good evening." (morning / afternoon / evening by the hour; no name until Q3 is answered) with the dot in the accent, a summary ("4 stacks up, 1 needs a look."), and a `StatusStrip`: Live (on / reconnecting), Stacks, Services ready, Problems. The mockup's Docker, Claude, branch and mode fields are left out until devdeck reports them; nothing is filled in for show.
  - Stop all and Restart failed, as before.
  - `SectionHeader` `01 $ UP STACKS` + "RUNNING **STACKS**", and one **card per stack**, four across at 1440 px: `[n] // <workspace>`, the stack's state (Running, Starting, Degraded, Stopping, Stopped), its name (links to Stacks), services / ports (three, then `+n`) / uptime, and a `StageRail` of its **services in start order**, done up to the first that isn't ready, yellow when one has failed. (The mockup's Boot · Build · Install · Migrate · Ready aren't stages devdeck tracks; the services are.)
  - A **Needs a look** panel with each failed service and its Restart, only when something failed. The mockup's "recent runs" and "Doctor findings" panels wait for the data (runs and findings aren't built yet).
- `web/src/pages/home/parts.tsx` (new): `ProblemRow` and `StopAll`, moved out of `HomePage.tsx` so both layouts use them.
- `web/src/design/pieces.css`: the Home styles (kicker, greeting, status box, card grid, cards).
- Tests: `pages/home/neon-home.test.tsx` (12: the greeting by hour, header, strip, cards, rail, a failed service and its restart, several workspaces, `+n` ports).
- **Resources (P3b) waits for its data:** the page is still a placeholder; it is built with main plan Phase 5.

Checked: typecheck, lint, all 601 web tests. In the browser with four demo stacks (one failing on purpose, all in the git-ignored dev data folder): Neon Home matches the mockup's layout, four cards in one row at 1440×900 with nothing below the fold; Flat Home compared with the committed `HomePage.tsx`: identical apart from the uptime counter.

## 2026-11-22: P4, Effects, the orb, empty Home

- **Effects setting** (`web/src/store/ui.ts`, Settings → Appearance → Effects: Off / Reduced / Full). Until chosen it follows the style (`effectiveEffects`: Flat Off, Neon Full); choosing keeps the choice in `devdeck.effects`. It sets `data-effects` on `<html>` (Off is no attribute, so Flat's page is unchanged), also before first paint (`index.html`). Tests in `store/ui.test.ts`.
- **The orb**, ported from the mockup:
  - `design/orb/scene.ts`: the three.js scene (2,600 points on a Fibonacci sphere displaced in the shader, coloured by height from the theme's primary through a mix to its critical colour, additive blending; a fresnel core; two rings in ink and a satellite in the "live" colour; tilts toward the pointer). State `idle` / `thinking` / `ok` (all in the success colour). Pixel ratio at most 2, at most 60 fps, everything disposed.
  - `design/orb/loop.ts`: the frame loop, without three.js so it is tested (`loop.test.ts`, 6 tests): the first frame at once, a frame-rate cap, one still frame and no loop when still, stopped while the page is hidden and started again when shown, stopped for good on unmount.
  - `design/orb/OrbCanvas.tsx`: reads the colours from the theme on `<html>` and again when the theme or style changes (a `MutationObserver`).
  - `design/EmptyOrb.tsx`: the orb only in Neon with Effects above Off where WebGL works; otherwise the page's usual art. Reduce motion (devdeck's or the system's) or Reduced effects give a still frame. `OrbCanvas` is `React.lazy`, so **three.js is its own chunk** (`OrbCanvas-*.js`, 537 KB, 134 KB gzipped; the main bundle has none of it, checked in the build). Tests in `design/empty-orb.test.tsx`.
- **Empty Home in Neon** (`pages/home/NeonEmptyHome.tsx`): without a workspace, the hero (the orb at about 440px with its state under it, `00 $ BOOT · NO STACKS RUNNING`, "Your workspace is ready **to connect**.", Configure workspace and Setup guide); with a workspace but nothing running, the quiet kind (one mono line and *Open stacks*, no orb). The mockup's `devdeck init` and `Ctrl K` chips are replaced by `devdeck help`: there is no `init` command and no command palette yet. Tests in `pages/home/neon-empty-home.test.tsx`.
- `three` 0.187.0 and `@types/three` 0.187.0, exact versions; `npm audit` clean.
- **Plans updated** in the same PR, as decision 9 asks: the neon-look plan (Effects default; the WebGL exception) and the main plan (3D: the orb as the one exception).

Checked: typecheck, lint, all web tests; the build splits three.js out. In the browser: the orb draws in the theme's colours on Neon's empty Home (the first screenshot was taken before its chunk loaded; it then drew, which led to drawing the first frame at once); the Effects row shows Full under Neon.
