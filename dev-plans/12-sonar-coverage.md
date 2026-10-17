# SonarQube Cloud: sending test coverage

SonarQube Cloud's quality gate has a condition "coverage on new code is at least 80%". The first runs failed only on that condition (bugs, security, maintainability, duplication and security hotspots all passed), because the Sonar workflow never gave it any coverage, so it saw 0%.

## What the workflow does now (`.github/workflows/sonar.yml`)

Before the scan, the job runs the tests with coverage and writes one report per language:

1. `go test -coverprofile=coverage.out ./internal/... ./sdk/... ./plugins/...` (Go).
2. `npm ci` then `npm run test:coverage` in `web/` (Vitest with the v8 provider), which writes `web/coverage/lcov.info`.
3. `sed` puts `web/` in front of the file names in that report, because Sonar looks for them from the repo root and Vitest writes them relative to `web/`.
4. The Sonar scan, which reads `sonar-project.properties`.

`-Dsonar.qualitygate.wait=true` stays, so the job still fails when the gate fails. The Sonar check is not one of the required checks, so a failing gate does not block a merge.

## `sonar-project.properties`

- `sonar.sources` and `sonar.tests`: the same folders (`cmd`, `internal`, `sdk`, `plugins`, `web/src`), with `sonar.test.inclusions` saying which files are tests (`*_test.go`, `*.test.ts(x)`, `web/src/test/**`).
- `sonar.exclusions`: test fixtures (`testdata`) and the shadcn components in `web/src/components/ui`, which are copied code that is not edited here.
- `sonar.coverage.exclusions`: `cmd/**` (the program's wiring) and `web/src/main.tsx`. They are still analysed for bugs and smells, but are not counted in coverage.
- The two report paths.

## Web coverage setup

- Dev dependency `@vitest/coverage-v8@5.0.5`, the same version as Vitest (they must match).
- `vite.config.ts` has a `coverage` block (v8, `lcov` and a text summary; excludes tests, `src/test`, `src/components/ui`, `main.tsx`). `npm run test:coverage` runs it.
- `web/coverage/` is in `.gitignore` and in ESLint's ignore list.

## Numbers when this was set up

Go: 86.6% of statements. Web: 95.5% of lines. The code of the folder-picker and workspace-cards changes is covered by tests apart from the small function that calls the operating system's dialog.

## If the gate fails again

Open the PR on sonarcloud.io, or read `https://sonarcloud.io/api/qualitygates/project_status?projectKey=shadovxw_devdeck&pullRequest=<number>` to see which condition failed. A coverage failure on a small PR usually means new lines without a test. The plugins `docker`, `git` and `systemmetrics` have no tests today, so a change to them will fail the coverage condition until they get some.
