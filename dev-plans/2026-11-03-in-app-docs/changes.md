# Guides inside the app: what changed

Built on 2026-11-03. A teammate (or the owner) reads the guides in devdeck itself and copies the prompts, without going to GitHub.

## New

- **`docs/embed.go`**: the Markdown files in `docs/` are embedded in the program (`//go:embed *.md`), so they ship in the installer and work offline. Adding or changing a guide needs a new build.
- **`internal/api/docs.go`**: `GET /api/v1/docs` (the guides, in a set order: Claude quick start, setup, editor, Docker, remote versions, the connector, appearance; the title is the first heading) and `GET /api/v1/docs/:id` (the Markdown). The id is checked (lowercase letters, digits, dashes) and must be a file in the embedded folder. Read-only, and not on the Claude connector's allow-list.
- **Docs page** (`web/src/pages/DocsPage.tsx`, `web/src/pages/docs/Markdown.tsx`, `web/src/lib/docs.ts`): **Docs** in the sidebar (Platform), a list of guides and the guide as text in the Paper look, with tables, and a **Copy** button on every code block. `react-markdown` 10.1.0 and `remark-gfm` 4.0.1, loaded only on this page. Raw HTML in a guide is not rendered. A link to another guide opens it in the app, a web address opens in a new tab, and a path into the repository (`../dev-plans/...`) is shown as plain text.
- **Tests**: Go (`internal/api/docs_test.go`: order, titles, the built-in guides, bad ids), web (`docs-page.test.tsx`, `docs.test.ts`).

- **Claude can read the guides**: `docs/guides.go` holds the list and read logic that the app's API and the connector share. The connector has a tool `get_guide` (no id: the list; an id: the guide) and the guides as resources `devdeck://docs/<name>` (`text/markdown`), beside the three schemas. Both are built into the program, work when devdeck isn't running, need no switch and make no request to the app. The connector's instructions tell Claude to read a guide before answering a "how do I" question. Tests: `internal/mcp/guides_test.go`, `docs/guides_test.go`.

## Changed

- `docs/claude-quickstart.md` says the guides are in the app under **Docs**.
