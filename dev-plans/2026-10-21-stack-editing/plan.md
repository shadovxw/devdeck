# Adding, editing and deleting stacks from the UI

## Goal

A stack is a YAML file in `<workspace>/stacks/`. Until now the only way to add or change one was a text editor. The Stacks page gets **Add stack** (upload a `.yaml` file, or write one), **Edit** and **Delete** on each stack.

## API (all under the Host/Origin guard, bodies limited to 512 KiB)

| Route | Does |
|---|---|
| `GET /api/v1/workspaces/:id/stacks/:stack/file` | The stack's file as text (also for sample workspaces: reading is harmless) |
| `POST /api/v1/workspaces/:id/stacks` `{yaml}` | Saves a new stack as `stacks/<name>.yaml`. 201; 409 the name is taken; 422 the YAML has errors (issues with line numbers; nothing is written) |
| `PUT /api/v1/workspaces/:id/stacks/:stack` `{yaml}` | Replaces the stack's file in place (same file name). 422 for errors, and when the name inside was changed |
| `DELETE /api/v1/workspaces/:id/stacks/:stack` | Moves the file to `<workspace>/.trash/stacks/` (nothing is erased). 204 |

Live checking while typing reuses `POST /workspaces/validate` with `kind: stack` and the workspace id (so repo ids are checked).

## Rules

- **Only your own workspaces change** (403 for samples). A stack's `cmd` is a program devdeck runs, so the same trust rule as starting one.
- **A running stack can't be edited or deleted** (409: stop it first). The run was planned from the old file.
- **The file name comes from the stack's `name`** (already limited to `[a-z][a-z0-9-]{0,39}`), never from the request, so a path can't be smuggled in. Create never overwrites (exclusive create); update writes a temp file and renames it.
- **No rename in the editor**: the name inside the file must stay the same. To rename, delete and add again.
- **A stack is found by its `name`**, not its file name, because the loader allows any `stacks/*.yaml`. Update and delete use the file the loader read it from.
- Nothing is saved when the YAML has errors. Warnings (for example a repo folder that is missing) don't block.
- Delete asks for confirmation in the UI, like deleting a workspace.

## Not in this change

A stack file that doesn't load (broken YAML) has no card, so it can't be edited from the page; fix it in an editor. Generating stacks from a scan is a separate item.

## Tests

Manager: create, duplicate name, invalid, update in place, rename refused, delete to trash, delete twice keeps both copies, sample refused, odd names. API: each route's status codes, running stack refused, size limit. Web: upload fills the editor, errors block saving, edit loads the file, delete confirms, a running stack has Edit and Delete disabled.
