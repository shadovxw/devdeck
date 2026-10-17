# Workspaces page: cards, a drawer for adding, and delete

## What changed on the page

- **Add workspace** is a button on the left, above the cards and before the count ("3 workspaces"). It opens a **drawer** from the right (the shadcn Sheet already in the app) that holds the whole add flow: folder box, Browse…, Scan folder, the drafted `workspace.yaml`, problems, Create workspace. It closes with the X, with Escape or by clicking outside, and its fields start empty each time it opens. After Create, the drawer closes and the new workspace's details open above the cards. With no workspace at all, the empty-state button opens the same drawer.
- **Each workspace is a card** (a grid: one column on a phone, two on a tablet, three on a wide screen): name, folder, "Yours" or "Example", description, Repos / Stacks / Flows counts and Problems. Clicking anywhere on a card opens its details (shown above the cards).
- **Delete** is a trash icon on the cards of your own workspaces, not on the sample. It asks first ("Its files move to a trash folder inside your workspaces folder. Your repositories aren't touched.") with Delete and Cancel.

## How delete works

- `DELETE /api/v1/workspaces/:id` → 204. 403 for the sample workspace, 404 for an unknown one, **409 while any stack of that workspace is running** ("stop its running stacks before deleting this workspace").
- **Nothing is erased.** The workspace's folder moves into `.trash` inside the workspaces folder as `<name>-<date>-<time>` (a number is added if two are deleted in the same second). `.trash` starts with a dot, so it is never listed as a workspace. To undo a delete, move the folder back out of `.trash` and take the date off its name. To empty the trash, delete `.trash` yourself.
- Only the workspace's own files move: `workspace.yaml`, `stacks/`, `flows/` and anything else in that folder. The repositories it points to are never touched. Deleting the open workspace closes its details.
- The folder to move is found by listing the workspaces folder, not taken from the request, so the request can't point it elsewhere.

## Code

- `internal/workspace/service.go`: `Manager.Delete`, `ErrReadOnly`.
- `internal/api/workspaces.go`: the route, with the running-stack check through the supervisor.
- `web/src/pages/WorkspacesPage.tsx`: `WorkspaceCard`, the drawer, `AddWorkspace` (now only the form). `lib/api.ts` has `api.delete`; `lib/queries.ts` has `useDeleteWorkspace`.

## Verified

Go and web tests (including delete into the trash, two deletes in one second, the sample refused, a running stack refused, the confirm step, Cancel, the error shown on the card, the button order and the drawer). By hand with a real server and a throwaway workspaces folder: the cards, the drawer, scan and create, delete with confirmation, the file in `.trash`, the repositories untouched. That check found one layout bug at phone width (long folder paths pushed the cards wider than the screen), now fixed.
