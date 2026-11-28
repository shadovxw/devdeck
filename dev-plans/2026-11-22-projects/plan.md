# Projects: one place for everything about a piece of work

> 2026-11-22 · status: **proposed, for a mockup first.** Replaces "workspace, repo, stack" as three ideas with one: the **project**. Nothing is built yet.

## 1. The problem

Today devdeck has three ideas a person has to keep in mind:

- **Workspace**: a folder of repositories, plus the accounts they use.
- **Repo**: one git repository in it.
- **Stack**: a recipe for running some of those repos together (services, order, ports).

They exist for good reasons (one set of repos can run in more than one way), but as three top-level things they are easy to forget, and they spread one piece of work across many pages: Workspaces, Repositories, Stacks, Logs, Images. Small projects feel heavy: a project with one repo still needs a workspace and a stack file.

## 2. The idea: a project

A **project** is one piece of work, whatever its shape. Opening it shows everything about it in one place: its code, how it runs, its databases, logs, images, scripts, and a way into the editor.

The same idea covers every shape:

| Shape | Example | What the project holds |
|---|---|---|
| One repo | a CLI tool | 1 repo; maybe 1 way to run it; scripts |
| One repo + tools | an API with a Postgres and a Redis in Docker | 1 repo; Docker services; 1 database; a run mode |
| Many repos | a shop: API, web app, worker, infra | 4 repos; Docker services; 2 databases; run modes "full" and "api only"; images; shared scripts |

Nothing is required except a name and at least one folder. Sections a project doesn't use don't show.

**Words on screen** (the old words stay in the files and the docs, for now):

| Old | New, on screen |
|---|---|
| Workspace | **Project** |
| Repo | **Code** (each one a repo) |
| Stack | **Run mode** ("Run: full", "Run: api only"). A project with one way to run just has **Run** |
| Flow | **Script** (a named list of steps) |
| Compose service | **Service** (Docker), next to the project's own services |

## 3. What a project holds

1. **Code**: the repos. For each: type, branch, clean or dirty, ahead or behind, remote, the GitHub account it pushes as, "local only".
2. **Run**: one or more run modes. A run mode is what a stack is today: services from the code (a command, a Go package, `npm run dev`), Docker services from a compose file, the start order, ports and ready checks. One project, one or many modes; one of them is the default.
3. **Services and tools**: Docker containers and local tools the project needs (Postgres, Redis, a queue, a mail catcher). Found in compose files; checked by Doctor (installed, right version, running).
4. **Databases**: see section 6.
5. **Images and tags**: Docker images built from the code, their tags, build and push.
6. **Logs**: every service of the project in one stream, filtered per service, with errors grouped (today's Logs page, scoped to the project).
7. **Scripts**: the project's own commands, run from a button. See section 7.
8. **Editor**: open the project or one repo in VS Code, and what devdeck sets up there. See section 8.
9. **Accounts**: which GitHub and Docker Hub accounts the project uses (names only; secrets stay in the keychain).
10. **Health**: Doctor's checks for this project (tools, ports, env files, accounts).

## 4. Screens (for the mockup)

### 4.1 Projects (the list)

- A card per project:
  - name and description
  - shape at a glance: "3 repos · 2 services · 1 db"
  - state: running, stopped, or a problem count
  - the last time it was opened
- Running projects first.
- **+ New project** card.
- Home's orb launcher lists the projects instead of only pages (or next to them; open question).

### 4.2 New project

1. **Pick a folder** (browse, or paste a path). It can be one repo or a folder holding several.
2. **What devdeck found**, as a checklist, not a YAML file:
   - repos (tick to include; type, remote)
   - compose files and their services
   - databases (from compose and `.env` files)
   - package scripts (`package.json`, `Makefile`, `Taskfile`)
3. **Name it** and **Create**. A "Show the file" toggle shows the YAML for those who want it.

### 4.3 The project page

**Header:**
- the project's name and description
- a state chip (Running 3/3, Stopped, 1 problem)
- the run-mode picker with **Start / Stop**
- **Open in VS Code**
- a scripts menu (the 3 most used, then "All scripts")

**Sections** (tabs, or a left rail inside the page; mockup to decide):

| Section | Shows |
|---|---|
| **Overview** | The project as a canvas (see the canvas plan: repos, services, databases, images as nodes; start order and "uses" as edges), live state on it. Below: what needs a look |
| **Code** | The repos table: branch, changes, ahead/behind, account. Per repo: open in VS Code, open on GitHub, its scripts |
| **Run** | The run modes; each one's services in start order (BootSequence); start, stop, restart per service; ports as links |
| **Databases** | Each database: engine, where it runs, who uses it, status; open the explorer and SQL console (Phase 6) |
| **Logs** | All services, one stream |
| **Images** | Images from the code, tags, build and push |
| **Scripts** | All scripts, their last run and result, **Run**; a log per run |
| **Settings** | Name, folders, accounts, Form and YAML views of the file, delete |

Sections a project doesn't use are hidden (a one-repo CLI tool shows Overview, Code, Scripts, Settings).

### 4.4 Running a script

- A side sheet with the script's steps.
- For a script that runs per repo: a row per repo, each step's state, and output.
- Writes (checkout, pull, reset, push) ask first, as every write action does.
- A summary at the end: "4 repos · 3 pulled · 1 had uncommitted changes, skipped".

## 5. The file

- One file per project: `project.yaml`, in the project's own folder or devdeck's data folder.
- It holds what `workspace.yaml` holds today: repos, connections, account rules. Plus, inline:
  - run modes (today's `stacks/*.yaml`; separate files still allowed for big projects)
  - databases
  - scripts
- The Form, the YAML view and the canvas all edit this one file. Review & save stays.
- **Compatibility:** an existing `workspace.yaml` with its `stacks/` folder is read as a project as it is; nothing has to be converted. "Convert to project.yaml" is offered, never forced.

Sketch (the shape, not final names):

```yaml
version: 2
name: acme-shop
root: ~/code/acme-shop
repos:
  - { id: api, path: api, type: go }
  - { id: web, path: web, type: node }
run:
  default: full
  modes:
    full:      { services: [api, web], compose: { repo: infra, services: [db, cache] } }
    api-only:  { services: [api], compose: { repo: infra, services: [db] } }
databases:
  - id: shop
    engine: postgres
    from: { compose: db }        # or { local: true } or { url_env: DATABASE_URL }
    used_by: [api]
scripts:
  - id: update-all
    title: Update every repo
    for_each: repo
    steps:
      - git: fetch
      - git: { checkout: dev }
      - git: pull
```

## 6. Databases

A project can have none, one, or many. Each one says:

- **Engine**: Postgres first (Phase 6), then MySQL, SQLite, Redis, Mongo.
- **Where it runs**, one of:
  - a Docker service in the project's compose file (devdeck reads its port, user and database name)
  - **local**: installed on this machine (host, port; the password in the keychain)
  - **from an env var** in a repo's `.env` (`DATABASE_URL`): devdeck reads the name, never logs or shows the password
- **Who uses it**: `used_by` lists repos or services. One repo, one database is `used_by: [api]`. A shared database is `used_by: [api, worker]`. A repo with two databases appears in two lists. That covers all three cases without separate settings.
- **Shared across projects**: a local Postgres used by several projects is defined once as a connection (Connections page) and referenced by name from each project.

On the canvas a database is a node. Edges run from the services that use it. On the Databases section:

- each database's status: running, the port is open, the database exists, migrations up to date
- the explorer and SQL console (Phase 6, with its safety rules: local-only writes, confirm a DELETE with no WHERE)
- **Mismatch warnings**: a repo's `.env` points at a port no database in the project listens on

## 7. Scripts

The answer to "check, fetch, check out dev, pull, and many more custom ones".

- **A script** is a name and steps. A step is one of:
  - **git**: `fetch`, `pull`, `checkout <branch>`, `status`, `stash`. Built in, so devdeck shows results as data (ahead, behind, conflicts), not just text.
  - **run**: any command in a repo (`npm test`, `go vet ./...`, `make lint`)
  - **devdeck**: `start <run mode>`, `stop`, `doctor`, `build image`
  - **plugin action**: `gitleaks.scan`, `trivy.scan` (today's flows)
- **Where it runs:** once, once per repo (`for_each: repo`), or for chosen repos.
- **Safety:**
  - Steps that change things (checkout, pull, reset, push, a delete) ask before running.
  - A dirty repo is skipped with a reason, never force-reset.
  - Output never goes to Claude or MCP with secrets in it.
- **Starter scripts**, offered on a new project and editable:
  - "Update everything" (fetch, pull where clean)
  - "Switch every repo to dev"
  - "What changed?" (status of every repo)
  - "Run the tests"
- **Found scripts**: `package.json` scripts, `Makefile` targets and `Taskfile` tasks show as ready-made scripts, run without being copied into the file.
- **From the terminal:** `devdeck run <script>` (new CLI command).
- **Today's flows** become scripts: the same engine, a friendlier name. Triggers (on a schedule, before a PR) stay.

**Decided in PJ4 (2026-11-24):**
- Scripts live in `workspace.yaml` under `scripts:` until `project.yaml` (PJ9).
- Commands run **without a shell**, like stack services: `&&`, pipes and redirects are refused with a message. Put several steps in the script instead.
- Git steps are fetch, pull (fast-forward only), checkout and status. **No push**, so plan question 5 is answered with "not yet".
- Runs are kept in memory, the last 20, so history is lost on restart. Stored history comes later.
- `devdeck run <script>` in the terminal and flows becoming scripts are still to do.

## 8. VS Code

What devdeck can do, from simple to more work:

1. **Open**: open the project, or one repo, in VS Code (`code <folder>`, or a `.code-workspace` with every repo of the project as a root folder). Partly there today ("VS Code" on the editor page).
2. **Generate a VS Code workspace file**: `acme-shop.code-workspace` with the repos as folders, recommended extensions, and settings like the YAML schema for `project.yaml`. Written only after review, like every file devdeck writes.
3. **Tasks**: the project's scripts and run modes written as VS Code tasks (`.vscode/tasks.json`), so `Run Task → devdeck: Start full` works inside VS Code. Kept in sync, with a review.
4. **A devdeck extension for VS Code** (a later milestone):
   - a status-bar item with the project's state (Running 3/3)
   - commands to start or stop a run mode and run a script
   - logs in an output channel
   - Doctor's problems in the Problems panel

   It talks to the local devdeck server on `127.0.0.1` with the same Host/Origin checks.
5. **Jump into code from devdeck**: a log line or an error opens the file at the line (already a `vscode://` link in Logs); a database table opens the migration that creates it.

## 9. Navigation

- **The sidebar shows projects** (pinned and recent) above the pages.
- **Opening a project scopes the app:** Logs, Images, Databases and Health show that project's.
- **Workspaces, Repositories and Stacks** stop being separate places: they become the Code and Run sections of a project, and the Projects list.
- **Cross-project views stay** where they help: Overview (everything running), Health, Connections, Settings.
- This is also what S6 ("a real current workspace that every page follows") was going to be: the open project is the current one.

## 10. Migration

- **Nothing breaks.** Existing workspaces show as projects, with the same files read the same way.
- **Words change first** (Projects, Code, Run, Scripts) while the files stay.
- **Then the project page.** Workspaces, Repositories and Stacks redirect into it; old links keep working.
- **Then `project.yaml`** with inline run modes, databases and scripts, offered as a conversion.

## 11. Order of work (small PRs, after the mockup)

| PR | What | Done when |
|---|---|---|
| PJ1 | Words: "Project" for workspace on screen; Projects list (today's Workspaces cards, plus shape and state) | Every screen says project; nothing else changes |
| PJ2 | The project page: header (state, run-mode picker, Start/Stop, Open in VS Code) and Code and Run sections, from today's pages | A project's repos and run modes are all on one page |
| PJ3 | Scope: the open project is the current one; Logs, Images, Health follow it (S6) | Opening a project changes what those pages show |
| PJ4 | Scripts: built-in git steps, run steps, for each repo, confirmation on writes, run history; found `package.json`/`Makefile` scripts; `devdeck run` | "Switch every repo to dev and pull" runs from one button and skips dirty repos with a reason |
| PJ5 | New project from a folder: checklist of what was found, no YAML first | A single-repo project takes one folder pick and one click |
| PJ6 | Databases section: databases from compose, local or env; `used_by`; status and mismatch warnings (the explorer stays Phase 6) | Each case in §6 shows correctly |
| PJ7 | VS Code: open project or repo, generated `.code-workspace`, tasks from scripts and run modes | `Run Task` in VS Code lists the project's scripts |
| PJ8 | The canvas as the Overview section (separate canvas plan) | Repos, services and databases as nodes with live state |
| PJ9 | `project.yaml` v2 with inline run modes, databases and scripts; conversion offered | An existing workspace converts and still runs the same |

Decided in PJ7: VS Code tasks call `devdeck run <script>` (a `process` task, no shell). The `.code-workspace` goes to `<root>/<id>.code-workspace` and is written only after review and confirm. VS Code is opened with `vscode://file/` links, not the `code` CLI.

Decided in PJ8: the canvas is React Flow + dagre (left to right), read-only until PJ9. It shows one run mode at a time and is the default tab. Clicking a node opens its tab.

Decided in PJ9: `project.yaml` is `version: 2` with `run.modes` (stacks without `version`) and `databases`. It is read into the same shapes as `workspace.yaml` + `stacks/`, so nothing downstream changes. Its schema is generated from the workspace and stack schemas. Converting keeps comments and leaves the old files as `.v1`; it is offered in Settings and never forced. The file still lives in devdeck's data folder (§13 question 4 stays open).
| Later | The VS Code extension | Status bar and commands work against the local server |

## 12. Open questions (for the owner)

1. **Name**: "Project" on screen, with the files still saying `workspace.yaml` until PJ9? Or rename the files at once?
2. **Home**: should the orb launcher list projects (go straight into one), pages, or both?
3. **Run modes**: is "Run mode" the right word for a stack, or keep "Stack" since it's familiar to developers?
4. **Where `project.yaml` lives**: inside the project's folder (shareable with the team through git) or in devdeck's data folder (private)? Today it is devdeck's data folder; a team file would need the public-repo hygiene rules (no tokens, no hostnames).
5. **Scripts that push**: allowed at all, or only fetch, pull and checkout for now?
6. **Databases**: Postgres only first, or SQLite too (common for one-repo tools)?
7. **VS Code**: is opening, the workspace file and tasks enough at first, or is the extension a priority?
