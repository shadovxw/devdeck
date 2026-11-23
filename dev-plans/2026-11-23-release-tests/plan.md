# Release tests on Windows

The 0.2.0 release (run 45112105002) stopped at "Go tests": the release job runs them on a Windows runner, while CI runs them on Linux only. Two tests failed there. Fix the tests so the release job passes; no product code changes.

Out of scope: running the Go tests on Windows in CI (would catch this on the PR; a separate change).
