# Release tests on Windows: changes

## 2026-11-23

**Problem.** The release workflow for 0.2.0 failed at "Go tests" on its Windows runner, so no tag or release was made. CI runs the same tests on Linux, where both passed.

**`TestLoadPlans` (`internal/feature`).** It compared the worktree path git printed with the folder from `t.TempDir()` as text. On the Windows runner git prints the long path (`C:/Users/runneradmin/...`) and `t.TempDir()` can hold the short 8.3 form (`RUNNER~1`), so the two differ as text but are the same folder. The test now compares them with `os.SameFile` (`sameFolder`). The code under test was right.

**`TestLogSinkGetsDefaultsEnvAndLines` (`internal/supervisor`).** It set the fake Compose with `s.o.Compose = ...` after `New`. `New` has already filled in the real Docker lookups (`ComposeNames`, `ComposePorts`, `ComposeFollow`) when `Compose` is empty, so the test asked the machine's Docker (`docker compose config --services`). Where Docker is missing or slow that wait ran past the test's 15 s limit and the stack stayed "starting"; it also took about 11 s on a PC. It now passes the fake through `newSup`'s options, like every other compose test, and runs in about 0.1 s.

Checked here (Windows): both tests and the two packages pass; `go vet`. Not reproduced here: the short-path case (needs the runner's temp folder); the release job itself needs a push to `main`.
