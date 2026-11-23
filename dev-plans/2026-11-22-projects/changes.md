# Projects: changes

## 2026-11-22: PJ1, the Projects list

From the owner's design board "Projects (plan §4)". Decisions taken to start: the board's look (cut corners, a gradient frame, mono labels) is built from theme tokens and used on the project pages only for now, with the glow and scanlines only at Effects Full. The address stays `/workspaces` until PJ2.

- **Words:**
  - Workspaces is **Projects** on screen: the sidebar, the page title, its empty state ("No projects yet", *New project*).
  - The add button and drawer say *New project*; its save button says *Create project*.
  - The sidebar switcher says "2 projects".
  - Home's kicker says "Project · …", and its orb line "Set up a project".
  - The files still say `workspace.yaml` (plan §5, PJ9).
- **The cards** (`pages/workspaces/WorkspaceCards.tsx`, styles in `design/pieces.css`):
  - `PRJ_01 // <folder>`, a state chip, the name with a diamond, the description.
  - The shape line ("4 repos · 3 run modes") and the type bar.
  - The New project tile dashed in the "live" colour.
- **The state chip** (`pages/workspaces/project-state.ts`, table-tested): "Running 2/3" (good), "1 failing" (critical), "N problems" in its files (warning, or critical for an error), or "Stopped". Each project counts only its own runs.
- **Only the cards** (owner's request): the Projects page lists the projects and New project, nothing under them.
  - A card opens the project on its own page, `/workspaces/<id>` (`pages/ProjectPage.tsx`), with today's details (repos, stacks, problems, settings, Edit file) until PJ2 gives it the design's header and sections.
  - Older `?open=<id>` links go to that page.
  - The sidebar keeps Projects marked there (`sidebarPathOf` maps a page under a listed one to it).
- Tests: `project-state.test.ts`, `workspaces.test.tsx` (the cards, cards only, a card opens its page, old links, details on the project's page), and the other tests updated for the new words.

Checked: typecheck, lint, all 801 web tests. In the browser at 1440×900: Projects shows the two cards (acme "4 problems", projects "Stopped") and the New project tile. Clicking acme opens its page, with the breadcrumb Work / Projects / acme and Projects marked in the sidebar.
