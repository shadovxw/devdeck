# Updates: changes

## 2026-11-21: U1, release on every push to main

- `.github/workflows/release.yml` (new). On push to `main` (and by hand, with an optional version):
  - **Plan** (Ubuntu): runs the version script's test, skips when the commit is already tagged or only `docs/`, `dev-plans/` or `*.md` changed since the last `v*` tag, reads the merged PR's labels through the API, works out the version, and refuses a tag that already exists.
  - **Build and publish** (Windows Server 2025, which ships Inno Setup 6): `npm ci`, web tests, web build, Go tests, `package.ps1 -Version`, the Linux agent (`devdeck-linux-amd64`, the same name the agent pre-releases use), `SHA256SUMS`, build provenance (`actions/attest-build-provenance` v4.2.2), then `gh release create vX.Y.Z --target <sha>` with notes from the merged PRs. The tag is made by the release itself, in the same job, because a tag pushed with the workflow token would not start another workflow.
  - Only this workflow has `contents: write`. One release at a time (`concurrency: release`, not cancelled half way). Actions pinned to SHAs. Workflow inputs reach the shell through `env`, never `${{ }}` inside a script.
- `scripts/next-version.sh` (new) and its table test `scripts/next-version_test.sh` (12 cases: patch by default, `release:minor`, `release:major`, `release:skip` winning, unrelated labels, first release, a non-version tag refused).
- `scripts/package.ps1`: takes `-Version 1.2.3` (checked); without it, `git describe` as before. Checksums are written by the workflow, not the script, because they also cover the agent (the plan said the script; changed).
- `installer/devdeck.iss`: a `[Run]` entry that starts devdeck after a **silent** install, for the updater in U3.

Checked here: the workflow parses; a dry run of the plan step against the real tags gives `0.1.1` after `v0.1.0`; the PR-labels API call returns the merged PR; `package.ps1` refuses a bad `-Version`. Not checked here: the Windows job itself (needs a push to `main`).

Needs the labels on GitHub: `release:minor`, `release:major`, `release:skip`.

## 2026-11-21: U2, check for a newer release

- `internal/update` (new): `Checker` asks `GET api.github.com/repos/shadovxw/devdeck/releases/latest` (anonymous, `User-Agent: devdeck-update-check`, 15 s timeout, 1 MiB answer limit), compares `MAJOR.MINOR.PATCH` as numbers, and keeps the last answer. A build whose version isn't a plain release (`dev`, `0.0.0-…`) is a development build and never asks. A second check within a minute returns the last answer (GitHub allows 60 anonymous calls an hour). A failed check keeps the last good answer and says why in words (offline, rate limited, no release yet, a tag that isn't a version, a draft or pre-release). The release link must be this repository's releases page, because the page links to it. Table tests against a fake GitHub (`update_test.go`).
- `internal/api/update.go` (new): `GET /api/v1/update` (the last answer, no network) and `POST /api/v1/update/check` (ask now; a failure is still a 200 with `error`, for the page). Behind the Host/Origin guard like everything else; tests in `update_test.go`, including a refused cross-site check.
- `internal/server`: wires `update.NewChecker(version)`.
- Web: `lib/update.ts` (`useUpdate`, `useCheckUpdate`, `checkedAgo`), Settings → **About** (`pages/settings/About.tsx`): version, latest release, a one-line status, **Check now** (hidden on development builds), **Release notes** link, and until U3 a line saying to run the installer from the release page. The Settings section list now marks the open section and remembers it in the address (`#about`). Tests in `pages/settings/about.test.tsx`.

Checked here: `go vet ./...`, `gofmt`, web typecheck, lint and all 568 web tests. **Not run here:** the Go tests. On this PC Smart App Control blocks Go 1.27.4's `link.exe` (the Go tools aren't code-signed), so nothing that links (tests, `go build` of the program) runs; CI runs them.

## 2026-11-21: U3, download, verify, install, restart

- `internal/update`:
  - The check also reads the release's files (`assets`). `State` gains `installable` / `not_installable` (a release build, on Windows, installed by the installer: Inno's `unins000.exe` beside the exe) and `ready` (the version whose installer is downloaded and checked).
  - `Download` (`download.go`): needs a check that found a newer release; fetches `SHA256SUMS` and `devdeck-setup-<v>.exe`, both of which must be listed at exactly `https://github.com/shadovxw/devdeck/releases/download/v<v>/<name>`; follows redirects only to `github.com` and `*.githubusercontent.com`; size limits (64 KiB, 300 MiB), 10-minute limit; hashes while writing to `<name>.part`, renames only on a match, deletes the part file otherwise, then removes older installers. One download at a time.
  - `Install`: checks the saved file's SHA-256 again against `SHA256SUMS` (a changed or missing file is deleted and `ready` cleared), then starts it (`install_windows.go`): `/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /LOG=<updates>\install-<v>.log`, detached so it outlives devdeck. `install_other.go` refuses on other systems.
  - Downloads go to `<data folder>\updates` (`%AppData%\devdeck\updates`), not `%LocalAppData%` as the plan first said: devdeck already owns its data folder.
- `internal/api/update.go`: `POST /update/download`, `POST /update/install` (needs `{"confirm": true}`; 409 with the reason when not ready), and every answer carries `running_stacks`. After the installer starts, the API calls `Deps.Quit` half a second later.
- Quitting: `server.WithQuit`. The window passes Wails' `runtime.Quit` (its context held in an `atomic.Pointer`, set on start-up); `devdeck serve` passes the cancel of its signal context. Both stop the stacks and close everything as a normal quit does. The installer starts devdeck again (`[Run]` for silent installs, from U1).
- `devdeck update [--yes] [--check]` (`internal/cli/update.go`): the same steps through the running server; asks `[y/N]` on stdin, and with no stdin says to use `--yes`. The CLI client can now send a JSON body (`send`).
- Web: Settings → About gets **Download update**, then **Install and restart** with an inline confirmation ("This stops 2 running stacks", button "Stop 2 stacks and install"), a status line while installing, and the reason when this copy can't update itself.
- `docs/updates.md` (new, in the in-app Docs): how to update, when devdeck can't, what it sends, checking a download by hand, the Windows warnings.

Checked here: `go vet` (Windows, `-tags desktop`, and `GOOS=linux`), `gofmt`, web typecheck, lint, 571 web tests. **Not run here:** the Go tests (Smart App Control blocks the Go linker on this PC); CI runs them. **Not tried for real yet:** an actual update, which needs two releases (one with the updater, then a newer one).

Semgrep (`dangerous-exec-command`) flagged the `exec.Command` that starts the installer. Marked with `nosemgrep` and the reason, as `internal/mcp` and `internal/review` do: the path is only ever the file `Install` saved in the updates folder and just matched against `SHA256SUMS`, and the arguments are fixed.

SonarQube's three new issues on the PR, fixed: the `devdeck update` table test's checks moved into a helper (cognitive complexity 17 → under 15); the confirmation button's label worked out before the JSX instead of a nested ternary; the "Installing…" line is an `<output>` instead of `<p role="status">`.
