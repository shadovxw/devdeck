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
