# The workspace.yaml editor: what changed

Built on 2026-11-03 as one PR: the editor and the Workspaces page that leads to it (see [`plan.md`](plan.md) for the design). Nothing here is specific to the owner's systems.

## New

- **Edit page** (`/workspaces/:id/edit`, `web/src/pages/workspace-edit/`): `WorkspaceEditPage` (header, Form/YAML switch, banners, dialogs, status bar), `YamlEditor` (CodeMirror, lazy), `cmTheme` (Paper look from tokens), `cmExtensions` (the server's problems as lint diagnostics with fix buttons; the changed-lines gutter), `Outline`, `Inspector`, `FormView`, `DiffView` (`@codemirror/merge`, lazy), `Modal`, and `useWorkspaceEditor` (text, base version, live check, disk polling, save).
- **`web/src/lib/yaml-doc.ts`**: outline, repo at a line, comment-preserving edits (set field, mark `local_only`, add and remove a repo). **`workspace-file.ts`**: file, save, git-init, schema and check hooks. **`json-schema.ts`**: flattens local `$ref`s for the suggestion library.
- **Server**: `local_only`; issue `code` and `fixes`; the file hash and the 409 on a stale save (`internal/workspace/editor.go`); `GET /schema/:kind`; `POST /workspaces/:id/repos/:repo/git-init`; `POST /workspaces/validate` checks folders for a workspace's own text.
- **Tests**: Go (`internal/workspace/editor_test.go`, `internal/api/workspace_editor_test.go`); web (`yaml-doc`, `json-schema`, `cm-schema` against the real schema, and the page: fix, review and save, refusal, conflict with Compare, Reload and Keep mine, polling, git init, Form, read-only, leaving).
- **Docs**: `docs/workspace-editor.md`.

- **Workspaces page** (`web/src/pages/workspaces/`): `WorkspaceCards` (grid of cards with counts, problems and a bar of repos by type, plus an Add tile), `WorkspaceDetail` (tabs: Repositories, Stacks, Problems, Settings), `RepoTable` and `repo-rows.ts` (repos joined with git, filters, shared prefix, git label). Tests: `workspaces.test.tsx` (rewritten for the new page) and `repo-rows.test.ts`.
- **Server**: the workspace list carries `repo_types` (repos counted by type).

## Changed

- **Workspaces page**: the accordion cards are gone. The first workspace is shown when none is chosen; `?open=<name>` still picks one. The editor opens from **Edit file** in the details, and the old textarea drawer and its tests are gone (the Add-workspace panel still uses a textarea). The editor opens at `?line=N` when linked from a problem.
- **Docs**: `docker-builds.md` and `teammate-setup.md` say **Edit file** instead of the pencil.
- **`schemas/workspace.schema.json`**: `local_only`; `"type": "string"` beside the repo and host `type` enums.
- **`web/src/design/theme.css`**: `--color-scrim` is registered, so `bg-scrim` (the Sheet's and the dialogs' backdrop) is no longer transparent.
- **`web/vite.config.ts`**: `codemirror-json-schema` is inlined for the tests (its ES modules have extensionless imports).
- **`web/package.json`**: `@uiw/react-codemirror`, `@codemirror/{lang-yaml,lint,merge,state,view,language}`, `@lezer/highlight`, `codemirror-json-schema`, `yaml`, all pinned.

## Known gaps

- The suggestion library offers values and keys once a character is typed, not on an empty spot.
- A repo that is new in the text can't be `git init`-ed until it is saved (the server looks the repo up in the saved file).
- Only `workspace.yaml` uses the editor; stacks and flows are later.
