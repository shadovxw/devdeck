# Custom themes: what changed

Built on 2026-11-01 in small steps (see [`plan.md`](plan.md) for the design and the reasons). Nothing here is specific to the owner's systems.

## New

- **`web/src/theme/`**: the ten colour roles and the Advanced tokens (`types.ts`), how the other tokens are worked out (`derive.ts`, on `colord` 2.10.0), Paper and Paper Dark (`builtins.ts`), contrast checks and grades (`checks.ts`), theme files (`validate.ts`, `file.ts`), applying tokens to the page (`apply.ts`), the store with mode, the theme for light and for dark, drafts and syncing (`store.ts`, `server.ts`).
- **Settings page** (`/settings`, `web/src/pages/SettingsPage.tsx` and `web/src/pages/appearance/`): a list of sections, and Appearance with Mode, Reduce motion, a gallery of themes in miniature, a grouped colour editor with grades, an Advanced list, Duplicate, Export, Import, rename, delete, and a live preview. Colour picker: `react-colorful` 5.8.1.
- **Server**: migration `0004_themes.sql` (`themes` table); `internal/api/themes.go` with `GET /api/v1/appearance`, `PUT` and `DELETE /appearance/themes/:id`, and `PUT /appearance/use` (mode, light, dark). Every colour is checked as `#rgb` or `#rrggbb`; unknown roles and tokens are dropped; at most 30 themes. Not on the Claude connector's allow-list.
- **Docs**: `docs/appearance.md`.

## Changed

- **`web/index.html`**: the script before first paint sets the colours of the saved theme for the mode (using `prefers-color-scheme` for System) and Reduce motion, from values the app kept, accepting only plain variable names and values.
- **`web/src/store/ui.ts`**: the old system, dark and light switch (unused since the top bar lost it) is gone; Reduce motion is in.
- **`web/src/app/AppSidebar.tsx`**: the Motion library follows Reduce motion.
- **`web/src/app/nav.ts`, `routes.tsx`**: Settings is a real page.
- **`dev-plans/02-frontend-design-system.md`** (section 12) and **`CLAUDE.md`** (UI rules): dark and custom themes are built; components must not hard-code colours.
- **`internal/store/store_test.go`**: four migrations.

## Not built

- Density (compact or comfortable), an interface font size and a code font choice: sizes and row heights are fixed pixels today, so they touch most pages and need their own plan.
- Settings sections other than Appearance, and a search over settings.
- Keeping Reduce motion on the server (it is kept in this browser).
