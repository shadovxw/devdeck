# The workspace.yaml editor

> 2026-11-03 · owner: Vrishank Warrier · builds on [`06-workspace-config.md`](../06-workspace-config.md) (the file and its schema) and [`02-frontend-design-system.md`](../02-frontend-design-system.md) (Paper) · status: **built (2026-11-03). One PR: the editor and the Workspaces page that leads to it.**

## 1. Goal

Replace the plain textarea in the Workspaces edit panel with a proper editor for `workspace.yaml`: the file stays the source of truth, but the user gets colours, suggestions from the schema, problems marked on the line they belong to (with a one-click fix where there is one), and a review of exactly what will change before it is written.

Not goals: a visual builder that hides the file; editing stacks and flows with it (the same component can take them later); a file watcher (see §4).

## 2. What it does

- **Form and YAML are the same file.** The Form view edits name, root, description and the repos as fields; every change goes through the `yaml` library's Document, so comments, blank lines and key order are kept. The Form never shows what it doesn't know (connections, hosts, rules): they stay as written.
- **YAML view** (CodeMirror 6): highlighting, line numbers, folding, suggestions while typing (from the server's own JSON Schema), a blue mark beside every line changed since the last save, and the server's problems underlined on their line. Hover a problem to see the message and its fixes.
- **Outline** (left): the sections, the repos (a mark on the ones with a problem) and the stack files; click to jump.
- **Inspector** (right): the repo under the cursor checked against this machine (folder, branch, remote, profile, stacks using it, from `GET /git/repos` and the workspace detail), the problems, and three overall checks.
- **Fixes.** "Mark `local_only: true`" is an edit to the text, saved like any other. "Run git init" is an action outside the file: it asks first and runs `git init` only in a folder that exists inside the root and has no `.git`.
- **Review and save** (Ctrl or ⌘ + S): a side-by-side diff of saved against edited; Save is only possible when the text is valid. The old file is kept as `workspace.yaml.prev` (already how `Update` works).
- **Never overwrites newer work.** The editor reads the file with a hash. A save sends that hash back; if the file changed since, the server answers 409 with the file as it is now and writes nothing. The editor also asks for the hash every 4 seconds, and when it differs it shows "changed on disk" with Compare and Reload (and, in Compare, "Keep mine", which makes the next save replace the other version on purpose).
- Leaving with unsaved edits asks first. Samples open read-only.

## 3. Server changes

| Change | Where |
|---|---|
| `local_only` on a repo (no warning about a missing `.git`) | `schemas/workspace.schema.json`, `types.go`, `load.go` |
| Issues carry a `code` and `fixes` (`repo-not-git`, `repo-folder-missing`) | `issues.go`, `semantic.go`, `load.go` |
| `GET /workspaces/:id/file` returns `{yaml, hash, path}` | `editor.go`, `api/workspaces.go` |
| `PUT /workspaces/:id` takes `base_hash`; 409 with the current file; 200 returns the new hash | `editor.go` (`UpdateIf`), `api/workspaces.go` |
| `POST /workspaces/validate` with `workspace_id` also checks the folders on disk for a workspace's own text, so the editor shows the same warnings before saving | `service.go` |
| `GET /schema/:kind` serves the JSON Schemas (workspace, stack, flow, log-filters) | `api/workspaces.go` |
| `POST /workspaces/:id/repos/:repo/git-init` | `editor.go`, `api/workspaces.go` |
| `"type": "string"` next to the repo `type` and host `type` enums, so the suggestions see them | `schemas/workspace.schema.json` |

All additions are backward compatible: a client that sends no `base_hash` gets the old behaviour, and the old fields of every response are unchanged.

## 4. Libraries and decisions

| Need | Choice | Notes |
|---|---|---|
| Editor | CodeMirror 6 (`@uiw/react-codemirror`, `@codemirror/lang-yaml`, `@codemirror/lint`, `@codemirror/merge`) | Lazy-loaded: only the edit page pays for it |
| Suggestions and hover from the schema | `codemirror-json-schema` (YAML entry) | Its own linter is not used: the server's check is the one source of problems. It cannot suggest a property's values through a `$ref`, so the schema is flattened first (`web/src/lib/json-schema.ts`) |
| Reading and editing the text | `yaml` (eemeli) | Document API keeps comments |
| Validation, line numbers, `.prev`, atomic write | already on the server | Nothing new |
| "Changed on disk" | polling a hash, not `fsnotify` | One file, every 4 s, only while the tab is visible. A watcher can come with the Workspaces page if it needs more |

Paper is monochrome (the accent is near-black), so the syntax is told apart by weight and tone, not by hue; every colour is a token, so custom themes reach the editor.

Known: `npm audit --omit=dev` reports three low findings in `deepmerge`, pulled in by `json-schema-library` (a dependency of `codemirror-json-schema`). CI fails only on high.

## 5. The Workspaces page

The page around the editor changes in the same PR: cards in a grid (counts, problems, a bar of repos by type, an Add tile) with the details of the chosen workspace below, in tabs: Repositories (joined with `GET /git/repos`: branch, clean or changed or ahead and behind, remote; filters; a dimmed shared prefix; local-only last), Stacks, Problems (grouped by file; workspace.yaml problems link to the editor at their line with `?line=`) and Settings (root, file path, delete with confirmation). The list endpoint gains `repo_types`. The edit button moves from the card to the details.

Not built: the "no workspace is active" banner and "make active" (there is no active-workspace concept yet; the top bar's switcher is still a placeholder), Fetch all, Rescan folder, Import workspace.yaml, and the last-commit column. Each needs a decision or an endpoint of its own.

## 6. Later

- Use the same editor for `stacks/*.yaml` (the outline already links to them).
- Write a `# yaml-language-server: $schema=…` header into files devdeck creates, so VS Code gets the same suggestions from `GET /schema/workspace`.
- Replace the textarea in the Add-workspace panel with the editor.
