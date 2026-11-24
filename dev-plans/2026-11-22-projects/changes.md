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

## 2026-11-24: PJ2, the project page

- **The header** (`pages/project/ProjectHeader.tsx`, styles in `design/pieces.css`): the design's frame, with:
  - **Name and state:** the name with an accent full stop, and the state chip ("Running 1/1" with a pulsing dot at Effects Full, "N problems", "Stopped"), then the description.
  - **Mode:** the run-mode picker, starting on the mode that runs, else the first.
  - **Start or Stop** for that mode. These are writes: paused while the server is gone, and an example project can't be started (its tooltip says so). A refused start shows its message.
  - **Open in VS Code** (`vscode://file/<folder>`), and **Edit file** for your own projects.
- **The server** (`internal/workspace/service.go`): a project's details carry `root_path`, the resolved repos folder (`~` and relative roots), so the page can open it in VS Code. Table-tested (`TestGetResolvesTheReposFolder`). The server still listens on 127.0.0.1 only, and the file editor already shows a path.
- **The tabs** (`pages/ProjectPage.tsx`), mono and upper case with a gradient line under the open one; the open tab is in the address (`?tab=run`):
  - **Code:** the repos with their git state (the existing table).
  - **Run:** each run mode as the Stacks page's card (services in start order, start, stop, restart, ports, logs). `StackCard` is exported from `StacksPage.tsx` for this.
  - **Logs:** a row per run mode ("Streaming" or "Stopped · its stored lines") that opens the Logs page scoped to it. Logs inside the page come with PJ3.
  - **Problems** and **Settings:** the existing panels (`pages/workspaces/WorkspaceDetail.tsx` now only holds those two; the old details component is gone).
  - Overview (the canvas), Databases, Images and Scripts come in later steps.
- The breadcrumb is Work / Projects / name, with Projects a link back.
- Tests: `workspaces.test.tsx`:
  - the header: name, state, mode, Start posting to the stack, VS Code link, Edit file, breadcrumb
  - running: Running 1/1 and Stop
  - the Run and Logs tabs, with the tab in the address
  - Edit file and Start for your own projects only
- **Not yet:** the running dev server is an older build, so it doesn't send `root_path`, and the VS Code button stays hidden until it restarts.

Checked: typecheck, lint, all 803 web tests, `go test ./internal/workspace ./internal/api`. In the browser at 1440×900 on the demo `acme` project: the header (4 problems, Mode api-only, Start, Edit file), the tabs, and Run listing api-only, docs and full with their services.

## 2026-11-24: PJ3, the open project is the current one

- **`lib/current-project.ts`**: the current project, kept in this browser (`devdeck.project`). `pickProject` decides which project a page shows: the one the address names (`?workspace=`), else the current one if it still exists, else the page's own default. Table-tested in `current-project.test.ts`.
- **Becoming current:** opening a project page makes it the current one, and so does choosing a project in the picker on Stacks or Logs.
- **Pages that follow it:** Stacks, Logs and Health (Doctor). A link that names a project still wins.
  - Images stays the view across every project.
  - The Health dot in the sidebar still checks its own default.
- **The sidebar's switcher** names the current project and opens its page. With none yet, it says how many there are and opens Projects. To switch, open another project.
- **Logs inside the project page** (`pages/project/ProjectLogs.tsx`): the Logs tab is the Logs page's own view (search, histogram, errors, the stream, saved filters), for the run mode that runs, or the first. A picker changes the mode, and **Full page** opens the Logs page on it. `LogsView` is exported from `LogsPage.tsx` with an `embedded` option (no second page title; the pickers and live status in a row). Filters stay in the tab rather than the address.
- Tests:
  - `current-project.test.ts`
  - `workspaces.test.tsx`: opening a project makes Stacks and the switcher follow it; the Logs tab shows the stream with its mode picker and Full page link, and no second page title.

Checked: typecheck, lint, all 810 web tests (the Docs page test once timed out under full-suite load and passes alone). In the browser:
- `acme`'s Logs tab showed the search, histogram, errors and "Stack stopped · start it to stream logs".
- Afterwards, Stacks showed `acme` and the switcher said "Project: acme".

## 2026-11-24: PJ4, scripts

- **`internal/scripts`** (new):
  - **Steps:** a script is a name and steps. A step is a git step (fetch, pull, checkout `<branch>`, status) or a command run in the repo.
  - **Where it runs:** once, in one repo (`repo:`), or in every repo (`for_each: repo`). A script with only git steps runs in every repo.
  - **Starters, on every project:** "Update everything" (fetch, pull), "Switch every repo to dev" (fetch, checkout dev, pull) and "What changed?" (status).
  - **Found in the repos:** `package.json` scripts (`npm run <name>`) and `Makefile` targets (`make <name>`), offered without being copied into the file. Names that aren't one plain word are left out.
  - **Asking first:** `Writes()` is true for anything but fetch and status, so it asks first.
- **The runner** (`internal/scripts/run.go`):
  - Goes repo by repo in the background, recording each step's state and the end of its output.
  - A repo with uncommitted changes is skipped before a checkout or pull, with the reason, and is never reset. A failed step stops that repo.
  - Pull is fast-forward only (`gitx.Plan`), and checkout of the current branch says "already on dev".
  - Commands run without a shell (`proc.SplitCommand`), for up to ten minutes.
  - The last 20 runs are kept in memory.
- **The command-line parser moved to `sdk/proc/split.go`**: `supervisor.SplitCommand` now calls it, so `scripts` doesn't import `supervisor` (which imports `workspace`, which now holds scripts).
- **`workspace.yaml` takes `scripts:`**:
  - The type is `WorkspaceFile.Scripts`, and the JSON schema has `script` and `scriptStep`.
  - The schema refuses `git: push` and anything else not listed.
  - The semantic checks add: each id once, a repo that exists, and a checkout branch that is a safe branch name.
- **The API** (`internal/api/scripts.go`):
  - `GET /workspaces/:id/scripts` lists every script with `writes` and its last run.
  - `POST /workspaces/:id/scripts/:script/run` needs `{"confirm": true}` when the script writes, refuses example projects and unknown scripts, and returns the run at once (202).
  - `GET /script-runs/:run` returns the run as it stands. Local-only folders are not run in (they aren't git repositories).
- **The Scripts tab** (`pages/project/ProjectScripts.tsx`, `lib/scripts.ts`):
  - The starters and the file's own scripts as cards, then "// Found in the repos". Each card shows its steps (`fetch → checkout dev → pull`), its last run or where it runs, and **Run**.
  - **The run sheet** shows `$ devdeck run <id>`, the title and the step chips with where it runs. For a script that writes, it says what will happen ("…in every repo. A repo with uncommitted changes is skipped, never reset.") with **Run it / Cancel**. Then it shows a row per repo with each step's state and output, and the summary ("2 repos · 1 ok · 1 skipped"). It polls the run every half second while it goes.
  - Run is disabled on example projects and while the server is reconnecting.
- Tests:
  - Go: `internal/scripts/scripts_test.go` (validation, writes and labels, starters, found scripts, targets, the runner's dirty skip, failure stop, status line, no shell, keep the latest), `internal/workspace/check_test.go` `TestScripts`, `internal/api/scripts_test.go` (listing from every place, run refusals and runs, local-only left out).
  - Web: `lib/scripts.test.ts`, `workspaces.test.tsx` (the tab, the ask before a write, the confirmed post, each repo's result and the summary).
- **Not yet:** `devdeck run <script>` in the terminal; stored run history; flows as scripts.

Checked: `go vet ./...`, the Go tests for scripts, workspace, api, supervisor and proc, typecheck, lint, all 820 web tests. In the browser, against a throwaway server on 7071 built from this branch (the owner's own server on 7070 was left alone): acme's Scripts tab listed the three starters, and "What changed?" ran: "4 repos · 4 ok", each with its branch and changed count. With this build, the header also showed Open in VS Code.
