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
