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
