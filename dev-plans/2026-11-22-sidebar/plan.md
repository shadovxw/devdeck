# Sidebar: fewer items, families as tabs, a readable rail

> 2026-11-22 · owner: Vrishank Warrier · from a review of the sidebar the owner brought in, asked for before the launcher work ([`2026-11-21-portfolio-look/`](../2026-11-21-portfolio-look/plan.md) §8a) · changes the nav grouping made there in P1 · status: **S1 and S2 built (2026-11-22), see [`changes.md`](changes.md); S3 to S5 not started.**

## 1. The problem

The sidebar lists 28 pages in 5 groups. Folded to icons it is a column of about 28 look-alike icons with a faint line between groups, which nobody can scan. Many pages are really tabs of another (Logs of Stacks, Migrations of Databases), and 12 of the 28 aren't built yet, so the list looks longer and emptier than the app is.

## 2. Decisions

1. **Families become tabs.** A page and the pages that belong to it are one sidebar item; the others show as a tab strip under the page title (in both styles). The routes stay as they are.

   | Sidebar item | Its tabs |
   |---|---|
   | Stacks | Logs, Resources, Images and tags |
   | Databases | Migrations, SQL console, Saved scripts |
   | Flows | Runs, Flow trace |
   | **Health** (the Doctor page, renamed) | Doctor, Findings |
   | Connections | GitHub, Docker Hub, Claude access |

2. **New groups:** Home on its own at the top; `// WORK` Workspaces, Repositories, Features; `// RUN` Stacks, Remote hosts, Health; `// DATA` Databases, Storage; `// AUTOMATE` Flows; and a **footer pinned to the bottom**: Connections, Secrets, Plugins, then a row of icons for Notifications, Docs and Settings. Breadcrumbs follow (Home's group is "devdeck").
3. **Pages that aren't built yet leave the sidebar.** A page with a `phase` in `nav.ts` is not built; stale markers on built pages are removed first. Unbuilt sidebar items are listed in one **Coming soon** group at the end, folded by default; an unbuilt tab shows dimmed and says which phase brings it. A group with nothing built doesn't show.
4. **Both styles.** This is structure, so Flat changes with it, as with the first regrouping.
6. **After the owner's second review (2026-11-22):** Health sits under `// RUN` (it is about the running stacks) and `// AUTOMATE` shows only once Flows is built; groups are always open with plain labels (one to three rows each, folding saves nothing), Coming soon is the only group that folds; Neon colours the logo with the theme's accent, so a screen has one accent. The review's other points are already planned: live status (S3), the workspace switcher in the sidebar header (S4), Home as a launcher (portfolio-look §8a).
5. **Later slices** keep the rail and keyboard work separate: group gaps and mono initials on the folded rail with a hover flyout per group (Radix HoverCard, already in `radix-ui`); live status on items (stacks running, Health findings); the sliding active diamond and the workspace switcher in the sidebar header (Neon); keyboard jumps (`G` then a letter, `[` to fold) with `react-hotkeys-hook`, the library the design system already names. The Ctrl K palette stays hub milestone H2.

## 3. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| S1 | Families as tabs, new groups and footer, Health, Coming soon, stale phase markers removed | The sidebar shows 13 items when expanded; every page is still reachable (sidebar, tabs or Coming soon); tests updated |
| S2 | The folded rail: gaps, group initials, hover flyouts, tooltips | Every page reachable from the folded rail without expanding it |
| S3 | Live status: running-stack count on Stacks, a dot on Health when Doctor finds problems | The counts follow the server's state |
| S4 | Neon: the active diamond slides between items; the workspace switcher moves into the sidebar header | Matches the launcher designs |
| S5 | Keyboard: `G` + letter jumps, `[` folds, shortcuts in tooltips | Each sidebar item has a working shortcut, listed in its tooltip |
