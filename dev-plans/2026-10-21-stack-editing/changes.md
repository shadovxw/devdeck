# Changes: adding, editing and deleting stacks

- `internal/workspace/stackfiles.go` (new): `StackYAML`, `CreateStack`, `UpdateStack`, `DeleteStack` on `Manager`. A stack is found by its `name` (the loader allows any file name); the file name of a new stack comes from its checked name; create is exclusive (never overwrites), update writes a temp file and renames, delete moves to `<workspace>/.trash/stacks/` with a timestamp (two deletes in the same second both survive). Errors: `ErrStackNotFound`, `ErrStackExists`, `ErrRename`, plus the existing `ErrInvalid`, `ErrReadOnly`, `ErrNotFound`. `ErrReadOnly` now reads "sample workspaces can't be changed".
- `internal/api/stackfiles.go` (new): `GET .../stacks/:stack/file`, `POST .../stacks`, `PUT .../stacks/:stack`, `DELETE .../stacks/:stack`. Update and delete answer 409 while the stack runs. Bodies are limited to 512 KiB like the other workspace routes.
- `web/src/pages/StackEditor.tsx` (new): the drawer used to add and to edit a stack: upload a `.yaml`/`.yml` file (client-side 512 KB limit) or type, live checking against the workspace's repos through the existing `/workspaces/validate`, nothing saved while there are errors, the server's own issues shown if it still refuses.
- Stacks page: **Add stack** button (also the empty state's action), **Edit** and **Delete** on each card of your own workspaces (disabled with a reason while the stack runs; delete asks first). Samples show none of them.
- Shared: `IssueList`/`Mark` moved to `design/IssueList.tsx`, `useDebounced` to `lib/use-debounced.ts` (both were private to the Workspaces page); `api.put`; stack hooks in `lib/queries.ts`.
- Tests: manager (create, refusals, odd names that try to escape the folder, update in place under another file name, rename refused, trash twice), API (full round trip, every refusal, running stack, size limit, wrong body), web (12 tests: template, upload, check-as-you-type, too-large file, server refusal, name taken, sample, edit, rename refused, running stack, delete confirm and cancel).

## Verified live (real server)

Create 201, same name 409, rename 422, unknown repo 422 with the line, update 200 (file changed on disk), read back, missing stack 404, `../evil` as a name 422, delete 204 (file in `.trash/stacks/`), second delete 404, a request with a foreign `Host` header 403 and the stack file still there.

## Left

- Plan item 2.2.3 (suggest stacks from the repos, then Python and Java detection and a `java` kind) is deferred until the other features are in.
- A stack file that doesn't load (broken YAML) has no card, so it can't be edited from the page.
