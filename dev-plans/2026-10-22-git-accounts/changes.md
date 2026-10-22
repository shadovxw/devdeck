# Changes: Git accounts and the credential helper (Phase 4, PR A)

The plan is in [`plan.md`](plan.md). Everything here is new; the one existing file with behaviour change is `cmd/devdeck/main.go` (the `git-credential` command).

## Go: `internal/gitx`

- **`gh.go`:** the GitHub CLI as the only place tokens live. `Accounts` (from `gh auth status --json hosts`, which carries no tokens), `Token` (`gh auth token --hostname github.com --user <user>`, about 170 ms), `Check` (asks GitHub as that account: its login, the token's scopes from the `X-Oauth-Scopes` header, and its organisations; the token goes to `gh` in `GH_TOKEN`, never in the arguments). `gh` is found on the PATH or where its Windows installer puts it. A missing `gh` is `ErrNoGH`, with the install hint.
- **`remote.go`:** `ParseRemote` (https with or without a user, ssh and scp forms), `StripCredentials`, rules (`github.com/owner/repo`, `github.com/owner/*`, `github.com/*`; case blind; the most specific wins, the first of equals), `ValidMatch`.
- **`config.go`:** `git-accounts.yaml` in devdeck's data folder (outside any repo, so organisation names stay private): connections `{id, gh_user, name, email}` and rules. Read strictly, validated (ids, GitHub user names, emails, patterns, that a rule names an existing connection, limits), written aside and renamed over the old file, mode 0600. `ConnectionFor` picks the connection: a username written in the repository's address that names a connection first, then the best rule.
- **`credential.go`:** git's credential protocol. `get` answers `username=<gh user>` and `password=<token>` for a github.com repository a rule or a URL username ties to a connection; for anything else it says nothing, so git asks the next helper (Git Credential Manager) as before. `store` and `erase` do nothing. It never fails git (a problem is a note on stderr), never prints a token anywhere but to git, rejects a token with a line break, and reads a bounded amount of input. `Command` is the entry point of `devdeck git-credential`.
- **`setup.go`:** registers devdeck as git's helper for `https://github.com` in the **global** git config: `useHttpPath=true` and a helper list of an empty entry (which resets the list), devdeck, then the helpers that applied to every host (Git Credential Manager), so repositories with no rule behave as before. `Preview` lists the exact commands and what is configured now; `Apply` first saves what was there (never replacing the first backup) and is idempotent; `Undo` restores it. Tests use `GIT_CONFIG_GLOBAL`.
- **`repos.go`:** `Inspect` a repository folder against the configuration (its origin without credentials, the account a rule picks, the identity git would commit with now, and a state: right account, wrong identity, no rule, no remote, not found, not GitHub) and `ApplyIdentity` (writes `user.name` and `user.email` to the repository's own config, only what the connection sets).
- **`service.go`:** the pieces together, and the overview the page shows (which connections have a signed-in `gh` account).

## Command and API

- **`devdeck git-credential <get|store|erase>`**, run by git, never the server. `devdeck help` mentions it.
- **`/api/v1/git`:** `GET /git` (gh's accounts, connections, rules), `PUT /git/config` (checked, 422 with the reason), `POST /git/connections/:id/check` (404 unknown, 424 no `gh`, 502 GitHub refused), `GET /git/match?remote=`, `GET /git/setup`, `POST /git/setup/apply` and `/undo` (only with `{"confirm": true}`), `GET /git/repos` (the repositories of the user's own workspaces, a few inspected at a time; sample workspaces are left out), `POST /git/repos/identity` (404 unknown repository, 422 no account for it). No route ever carries a token.

## Web

- **Connections page** (`/connections`): the accounts `gh` is signed in to; the connections and rules as one editable draft saved together (Save, Discard, why the server refused); a **Check** button per saved connection (login, scopes, organisations); a box to try an address against the saved rules; and the git credential helper with its preview of the exact git commands, a confirmation before applying or undoing, and Undo. A connection whose account `gh` isn't signed in to is flagged. Without `gh`, the page asks to install it.
- **Repositories page** (`/repos`): each workspace repository with its remote, account chip and status (a shape and a word), "Set identity" for a wrong identity, "Add a rule" for a repository no rule matches, and a count of what needs attention.

## Tests

- Go: remote parsing and rule choice, configuration validation and the file (strict reading, private file, no leftovers), the helper (rule match, URL username precedence, silence when it doesn't know, store and erase ignored, never failing git, bounded input, the command with `gh` replaced), setup (preview, apply keeping the other helpers after devdeck, undo restoring what was there, the first backup kept, refusals) and repositories (every state, credentials never shown, identity written to the repository and not the global config), all against real git in temporary folders; the API against fake `gh` answers.
- Web: both pages against a mocked server (the editor, save and discard, adding and removing, checks, the address box, the setup with its confirmations, the repository states and the identity fix).

## Verified live (real git, real `gh`, the owner's real accounts; a scratch data folder with placeholder identities)

- `devdeck git-credential get` answered with the right account for a personal and an infrabot repository (login, and a 40-character token that was not printed), and with nothing for an unrelated one; `store` printed nothing.
- **git itself** (`git ls-remote`, in an isolated git config with the helper registered): the private infrabot repository could be read through the helper, and could not without it; the personal repository too.
- The pages were opened in the browser pane. Against the real workspaces the Repositories page found 20 repositories (4 not on disk) and flagged the infrabot ones whose email is not the connection's: the real names and emails are for the owner to enter.

## Found when setting it up for real

Two mistakes in the first version, found by running git against the owner's real settings, and fixed:

- **Git Credential Manager is in the system config, not the user's.** The setup read only the global config for the helpers that apply to every host, so it didn't see Git Credential Manager (Git for Windows puts it in the system config). The empty entry that puts devdeck first clears *every* earlier helper for github.com, so Git Credential Manager would have been dropped as the fallback. The setup now reads the system and the global config, and lists those helpers again after devdeck (empty entries are not copied). The tests give git their own system config (`GIT_CONFIG_SYSTEM`).
- **git runs the helper without the server's environment.** The server finds its data folder through `DEVDECK_DATA_DIR`, which the helper doesn't have, so it looked in the default folder, found no accounts and said nothing. The helper line now names the folder: `devdeck git-credential --data-dir "<folder>"` (made absolute), and `Command` takes that flag.
- Checked afterwards with the real settings and prompts switched off: the private infrabot repositories and the personal repository were read through the helper with no popup.

## Connections is now a parent, with GitHub under it

- **`/connections`** is a page of its own that lists the kinds of connection (GitHub, which is built, and Docker Hub, SonarQube and Postgres, which say which phase brings them). **`/connections/github`** is the page that was `/connections`. GitHub is nested under Connections in the sidebar (the nav's existing sub-page mechanism), the breadcrumb reads *Platform / Connections / GitHub* with Connections a link back, and the sidebar keeps the parent open on the child page. A later kind (Docker, say) is one more entry beside GitHub, with its own page. The Repositories page's links point at the GitHub page.
- **Layout, as in the owner's reference, in the app's own theme** (flat panels, no avatars, no coloured icons, a state is a small shape and a word): *GitHub CLI accounts* (each account with its scopes as small tags, "Current" for gh's own default, an **Add account** button that shows the `gh auth login` command with a Copy button); *Connection profiles* as a table (Profile, GitHub account, Commit name, Commit email, Status, Check and Remove; the fields look like text until pointed at); *Repository routing rules* as a table (pattern, what it covers in words, the profile it uses, Remove) and a **Test a repository URL** line; *Git credential helper* with a status word, **Set up helper**, **Undo** and **Learn what changes**; and a bar at the bottom, only while there is something unsaved, with Discard and Save changes. The reference's "Priority" column is not built: the most specific rule wins, so there is nothing to order.
- **The helper's status recognises any devdeck helper whose program is still there**, not only the exact command this running copy would register. `air` and a built `devdeck.exe` are different programs, so the page said "Not configured" while the helper was set up. Preview now also reports `registered`, `registered_program` and `registered_exists`: the page says "Set up" and which program git runs, or "Set up, program missing" with the way to set it up again. (A hand-written test config file once ate the quotes in the helper line; helpers are set through git in the tests.)

## Actions are pills, on the sidebar's background

- The shadcn **Badge** component was added with the shadcn CLI (`web/src/components/ui/badge.tsx`). The CLI also added an unrelated npm package named `cn` by mistake (it misread an import); that was removed again (`npm uninstall cn`) and the badge uses the project's own `cn` from `@/lib/utils`, so `package.json` and the lock file are unchanged.
- `design/pills.ts` builds the pill styles from the badge's variants: `pill` (an ordinary action), `pillDanger` (Remove, in the critical colour), `pillPrimary` (Save changes, Set up helper) and `pillSelect` (the dropdowns in the tables). All of them sit on the sidebar's background (`bg-sidebar`) with a thin outline, so they read as part of the same surface as the app's chrome. The GitHub page and the Repositories page ("Set identity", "Add a rule") use them for every action and dropdown.

## Not in this PR (PR B)

Fetch, pull, push, branches, commits, status with file watching, bulk "pull all", clone onto a new PC, the pull-request list and checks, repository detail pages.

## Known limits

- HTTPS only; SSH remotes are shown and not handled.
- The helper command is registered with the path of the running devdeck program and its data folder. In development `air` builds into `tmp/` and deletes the program when it stops, so setup is best done from a built program (`go build -o bin/devdeck.exe ./cmd/devdeck`, or `mise run build`), which the helper then keeps using whether or not `air` runs. Rebuild it when the helper's code changes; applying again later with a new path is safe.
- `gh auth status` takes about a second (it asks GitHub), so the Connections page takes about that long to load.
