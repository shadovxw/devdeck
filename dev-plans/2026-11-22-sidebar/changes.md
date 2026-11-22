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

## 2026-11-22: S3, live status

- **`web/src/app/nav-status.ts`** (new): `stacksStatus(runs)` (how many run; green when all are ready, yellow while something starts or waits, red when a service failed, blocked or is restarting; nothing when none runs) and `healthStatus(report)` (red for Doctor failures, yellow for warnings, nothing when all passed or not checked), each with the same in words. `useNavStatus()` puts them together for the sidebar. `defaultDoctorWorkspace` (the first workspace without errors, else the first) is now shared by the Health page and the sidebar, so both check the same workspace.
- **Doctor in the background:** it used to run only when Health was opened. The sidebar now runs it **once when devdeck opens and every 15 minutes** (`useDoctor`'s new `every`), never on window focus, for that default workspace. The Health page shares the same result.
- **`AppSidebar.tsx`:** the status is worked out once (a React context) and drawn at the row's end: the count (Stacks) and a 6px status dot; folded to icons, the dot sits on the icon's corner. Screen readers get the words as the row's description (`aria-describedby`), so the row's name stays the page's name; the tooltip shows them too ("Stacks: 2 running, 1 with a problem").
- **Tests:** `nav-status.test.ts` (the tones and words for each case, the default workspace) and `sidebar-status.test.tsx` (the rows' descriptions and count with a running stack and a Doctor failure; nothing when all is well; Doctor asked once for the default workspace).

Checked: typecheck, lint, all 646 web tests. In the browser with a demo workspace made for the check and removed afterwards (two stacks, one failing on purpose): expanded, Stacks shows 2 and a red dot and Health a yellow dot (Doctor's warnings); folded, the dots sit on the icons.

## 2026-11-22: S4, the sliding diamond and the switcher in the sidebar

- **The diamond slides (Neon).** The current page's filled diamond used to be drawn on each active row, so it jumped. It is now drawn on the active highlight (`ActivePill`, one shared Motion element with `layoutId` that already slides between rows), placed exactly over the row's hollow diamond (the row's 8px padding plus the hollow one's 2px margin), so it slides with it. Reduce motion still turns the slide into a cut (the sidebar's `MotionConfig`).
- **The workspace switcher moved into the sidebar header** (`app/WorkspaceSwitcher.tsx`, new), under the logo; the top bar keeps the sidebar toggle (and the window buttons in the desktop window). It was a placeholder that always said "No workspace"; now it says what is true: the workspace's name when there is one, "3 workspaces" when there are several, "No workspace" when none, and opens Workspaces. Folded, it is its icon with the name in the tooltip. A switcher that every page follows is S6 (proposed): devdeck has no current workspace yet, each page picks its own default.
- **`looks.css`:** the diamond rules skip the switcher, as they skip the footer's icon row (they had hidden its icon and arrow).
- **Tests:** `workspace-switcher.test.tsx` (the label for none, one and several; in the sidebar header, opens Workspaces, not in the top bar any more); the top bar test updated.

Checked: typecheck, lint, all 651 web tests. In the browser: the filled diamond lines up over the hollow one; the switcher in Neon (expanded and folded) and Flat; the bug found there (Neon's diamond rule hiding the switcher's icons) is fixed.
