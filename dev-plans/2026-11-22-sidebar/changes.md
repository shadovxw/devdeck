# Sidebar: changes

## 2026-11-22: S1, families as tabs, new groups, footer, Coming soon

- **`web/src/app/nav.ts`:**
  - Pages regrouped (whole entries moved, checked line by line): `devdeck` (Home, no heading), Work, Run, Data, Automate, and System as the footer.
  - `FAMILIES` replaces `NESTED`: Stacks (Logs, Resources, Images and tags), Databases (Migrations, SQL console, Saved scripts), Flows (Runs, Flow trace), Health (Findings), Connections (GitHub, Docker Hub, Claude access). `familyOf(path)` and `sidebarPathOf(path)` are new.
  - Every page has `built` (no `phase`). Stale phase markers on built pages removed (Logs, Repositories, Connections, GitHub), so the flag is true.
  - The Doctor page is now **Health**, with `tab: "Doctor"` for its own tab.
  - `FOOTER_GROUP`, `HOME_GROUP` exported.
- **`web/src/app/AppSidebar.tsx`:** only built family heads in the groups; a row stays highlighted (and `aria-current`) while any page of its family is open, so the rows are plain `Link`s (React Router's `NavLink` would set `aria-current` from its own exact match). Unbuilt pages under **Coming soon**, folded by default, not remembered, left off the folded rail. The footer is pinned to the bottom: Connections, Plugins (Secrets when built) as rows, then an icon row for Docs and Settings (Notifications when built); the update dot moved with Settings.
- **`web/src/design/FamilyTabs.tsx`** (new), shown by `PageHeader`: the family's pages as tabs, the open one current; an unbuilt page is a dimmed tab with "Comes in Phase N". `PageHeader` also works out a family page's parent for the breadcrumb (`Run / Stacks / Logs`) when the page doesn't name one.
- **`web/src/design/looks.css`:** Neon family tabs (mono, upper case, accent underline); the diamond-instead-of-icon rule no longer touches the footer's icon row.
- **Tests:** page tests updated (group names, the breadcrumb of a family page, the tabs, the row of a tab's family, Coming soon, the footer); the GitHub and Docker Hub tests pick the cards, not the new tabs with the same names; nav tests for `built`, families, `sidebarPathOf`, Health and the footer.

Checked: typecheck, lint, all 631 web tests. In the browser: Neon expanded (9 rows and a pinned footer), folded (8 icons and a 4-icon footer, down from about 28), and Flat (the same structure, Paper tabs). The bug found there (diamonds instead of the footer icons) is fixed.

## 2026-11-22: S2, the folded rail, and the owner's second review

- **`nav.ts`:** Health (with Findings) moved to the Run group; Automate now holds only Flows, which isn't built, so its heading doesn't show (entries moved whole, checked).
- **`AppSidebar.tsx`:**
  - Groups are always open with a plain label; only **Coming soon** folds (the store's `closedGroups` is no longer used by the app; left in place, as many tests reset it, for a later tidy-up).
  - **The folded rail:** each group has a mono initial (`/W`, `/R`, and `/…` for Coming soon) and sits 16px from the next, against 4px between rows. The initial opens a **flyout** (Radix `Popover`, on hover, focus or click; it closes when the pointer leaves or a page is chosen) listing the group's pages with their tabs indented; unbuilt ones are dimmed and say their phase. Coming soon on the rail is its flyout alone, so every page is reachable without expanding the sidebar.
- **`looks.css` (Neon):** the flyout gets the glass look; **the logo takes the theme's accent** (its three gradients recoloured with `stop-color`, from deep to bright), so a screen has one accent; the rail initials get a `/` prefix.
- **Fix:** Neon-only parts (`look-neon`) were forced visible with `display: revert !important`, which also beat "hidden when folded" and leaked the `dd.` wordmark onto the rail. Now Flat hides them and Neon leaves their display to their own rules.
- **Tests:** "groups stay open, only Coming soon folds", "the rail's flyout reaches every page of a group, unbuilt ones without a link", Health's group.

Checked: typecheck, lint, all 632 web tests. In the browser (Neon, folded): the initials and the gaps between groups, the Run flyout with its tabs and Health, the logo in the accent; three bugs found there were fixed (the wordmark on the rail; the initial and its prefix wrapping onto two lines; Health showing as "Doctor" in the flyout).
