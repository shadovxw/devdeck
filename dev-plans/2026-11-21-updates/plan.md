# Updates: release from a tag, update from inside devdeck

> 2026-11-21 · owner: Vrishank Warrier · covers main plan Phase 12.4 (auto-update check) and next-steps §2 (release workflow) · status: **U1 to U3 built (2026-11-21), see [`changes.md`](changes.md); U4 (daily check, toast) not started.**

## 1. The problem

Today a release is built by hand on one PC (`scripts/package.ps1`, needs Inno Setup), uploaded to GitHub by hand, and every laptop that has devdeck must download and run the new installer by hand. Nothing tells a laptop that a new version exists. `v0.1.0` (2026-11-03) is the only release.

Goal: **merge into `main`, and every installed devdeck offers the update; one click installs it.** No tagging by hand (owner, 2026-11-21).

## 2. What already works

- The installer has a fixed `AppId`, so a newer installer upgrades in place; it installs per user (no admin), closes a running devdeck and starts it again (`CloseApplications`, `RestartApplications`), and leaves `%AppData%\devdeck` alone.
- The version is built in (`-X main.version=...` from `git describe`), and `/api/v1/health` reports it. Untagged builds are `0.0.0-...`.
- Release tags are `v1.2.3`; the agent's pre-releases are `agent-dev-N`.

## 3. Decisions

1. **GitHub Releases is the update server.** No server of our own. The repo is public, so reading releases needs no token.
2. **Every push to `main` is a release, and the workflow makes the tag.** A new `release.yml` runs on push to `main`:
   - **Next version:** the latest `v*` tag plus one **patch** (`0.1.0` → `0.1.1`). The PR merged into `main` can say otherwise with a label: `release:minor` (`0.2.0`), `release:major` (`1.0.0`) or `release:skip` (no release). The commit titles in this repo are plain sentences, not "feat:/fix:", so labels are simpler than conventional commits.
   - **Skipped by itself** when the push changes only docs and plans (`docs/**`, `dev-plans/**`, `*.md`), or when the commit is already tagged.
   - **Then, in the same job:** wait for nothing else (the CI checks already passed on the PR, a branch rule); `npm ci` + build, Go tests, `package.ps1` with that version (Inno Setup installed in the job), the Linux agent build, `SHA256SUMS`; create tag `vX.Y.Z` on that commit; create the **GitHub release** with everything attached and notes from the merged PR titles since the last tag.
   - The tag and the release are made in the same job because a tag pushed with the workflow's own token does not start other workflows.
   - Actions pinned to commit SHAs, like the other workflows. `contents: write` only in this workflow. One release at a time (`concurrency`), so two quick merges can't take the same number.
   - A manual `workflow_dispatch` with a version box stays, for a re-run or a fix.
3. **Build provenance.** The job also publishes a GitHub artifact attestation (`actions/attest-build-provenance`), so anyone can check with `gh attestation verify` that an installer was built by this repo's workflow from a given commit.
4. **devdeck checks once a day and at start** (`GET api.github.com/repos/shadovxw/devdeck/releases/latest`, which skips pre-releases and drafts, so the agent builds never show up). It compares versions as semver. Development builds (`0.0.0-...`) never check. 60 unauthenticated requests an hour is far more than needed. The check sends nothing about the user.
5. **It asks; it never installs on its own.** A quiet badge on Settings and a toast: "devdeck 0.2.0 is available" with **Release notes** and **Update**. Setting: Check for updates **Automatically / Never**, plus **Check now** on Settings → About.
6. **Update = download, verify, quit, install, restart.**
   - Download the installer and `SHA256SUMS` into `%LocalAppData%\devdeck\updates`, only from `github.com` / `objects.githubusercontent.com` URLs the release lists, with a size limit.
   - The SHA-256 must match the line in `SHA256SUMS`, or the file is deleted and the update stops with the reason.
   - If stacks are running: "Updating stops 2 running stacks. Update now?" (same confirmation as Quit).
   - devdeck starts the installer with `/SILENT /SUPPRESSMSGBOXES /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS /NORESTART`, then shuts down cleanly; the installer replaces the exe and starts devdeck again (a `[Run]` entry for silent installs). The installer keeps the user's earlier task choices (desktop icon, start at sign-in).
   - After the restart, a toast says "Updated to 0.2.0".
7. **Signing comes later but matters.** The checksum catches a broken or swapped download, not a compromised release. Code signing (Authenticode) does more, and it is also what stops **SmartScreen and Smart App Control** from warning about or blocking devdeck: a PC with Smart App Control on may refuse an unsigned devdeck entirely. Options to check: Azure Trusted Signing (about $10 a month) or SignPath's free plan for open-source projects. Once signed, devdeck also checks the installer's signature before running it.
8. **The CLI gets it too:** `devdeck update` (check, download, verify, install) for machines that run devdeck without the window.

## 4. Pieces

| Where | What |
|---|---|
| `.github/workflows/release.yml` (new) | On push to `main`: work out the next version (labels, docs-only skip), build, package, `SHA256SUMS`, attestation, tag, GitHub release with notes from the merged PRs |
| `scripts/next-version.sh` (new) | The next version from the latest `v*` tag and the PR's labels; tested with a few cases in CI |
| `scripts/package.ps1` | Takes the version as a parameter in CI (today it reads `git describe`). `SHA256SUMS` is written by the workflow, since it also covers the agent |
| GitHub labels | `release:minor`, `release:major`, `release:skip` |
| `installer/devdeck.iss` | A `[Run]` entry that starts devdeck after a silent install |
| `internal/update` (new) | Fetch the latest release, compare versions, download with limits, verify the checksum, start the installer. Table tests against a fake GitHub server |
| `internal/api` | `GET /api/v1/update` (state: current, latest, notes URL, downloaded?), `POST /api/v1/update/check`, `POST /api/v1/update/install` (with confirmation) |
| `cmd/devdeck` | `devdeck update` |
| `internal/desktop` | Shut down for the installer: the same clean stop as Quit |
| Web | Settings → About (version, Check now, the setting), the toast, the badge |
| Docs | `docs/updates.md`: how updates work, how to verify a download by hand |

## 5. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| U1 | `release.yml` with the version bump, checksums, attestation; installer `[Run]` for silent installs | Merging a PR into `main` makes tag `v0.1.1` and a release with the installer, the agent and `SHA256SUMS`; a docs-only merge makes none |
| U2 | `internal/update`: check and compare, API, Settings → About with Check now | A `v0.1.0` build says "0.2.0 is available"; a dev build says nothing |
| U3 | Download, verify, confirm, install, restart; `devdeck update` | Clicking Update on an installed 0.1.x ends with 0.2.0 running and the data intact |
| U4 | Daily check, toast, badge, the Automatically / Never setting | A laptop left open picks up a new release within a day |
| later | Code signing; check the signature before installing | SmartScreen and Smart App Control accept the installer |

**The first update still goes by hand:** laptops on `v0.1.0` have no updater, so they need one manual install of the first version that has U3. After that, updates come from inside devdeck.

## 6. How you release, once this exists

1. Merge the PRs into `dev` as now.
2. Open a PR from `dev` into `main`. Add `release:minor` or `release:major` if it's a bigger step; no label means a patch.
3. Merge it. The release workflow tags and publishes. Every devdeck offers the update within a day, or at once with Check now.

## 7. Risks

- **Unsigned builds on machines with Smart App Control on** may not run at all (decision 7). Signing is the real fix.
- **A bad release reaches everyone who clicks.** Mitigations: tests run in the release job; the previous installer stays on its release page for a manual roll back; later, a "skip this version" button.
- **The installer is running while devdeck is gone:** if it fails, devdeck isn't restarted. The installer's log goes to the updates folder, and the next start says that the last update failed.

## 8. Open questions

1. Release notes: from the merged PR titles since the last tag (proposed), or written by hand in the release?
4. ~~Tag by hand or on merge?~~ Answered 2026-11-21: every push to `main` releases, with a patch bump unless a label says otherwise (decision 2).
2. Signing: try SignPath (free for open source) or pay for Azure Trusted Signing?
3. Should `dev` builds have their own pre-release channel for your own laptops, or only `main` tags?
