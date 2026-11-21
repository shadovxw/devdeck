# Flaky supervisor port test: changes

## 2026-11-21

**Problem.** `TestEveryKindOfReadinessCheck` (`internal/supervisor`) failed at random in CI, on PRs that don't touch the supervisor (seen on PR #53, run 44957760883: the `http` fake service `failed`, "crashed 3 times", and the test timed out waiting for "all ready").

**Cause.** `freePort` asked the system for a free port (`127.0.0.1:0`), closed it, and the fake service (`testdata/fakesvc`) listened on it a moment later. A `:0` port comes from the system's ephemeral range, which every other test package's `httptest` server and outgoing connection also draws from, and `go test ./...` runs packages in parallel. In that moment another package could be handed the same port; the fake service then couldn't listen, exited with code 2, and was restarted until it gave up.

**Fix.** `freePort` now picks from 20000–29999, below every system's ephemeral range (Linux 32768+, Windows and macOS 49152+), so the system never gives those ports to anyone else. Each call moves to the next port (a port still closing from an earlier test isn't reused), checks it is free, and skips ones in use. The start depends on the process id, so two runs at once rarely meet. The tests in this package don't run in parallel with each other, so they can't take each other's ports. The readiness checks still need the address up front (it is part of the stack spec), which is why the port is chosen by the test and not reported back by the fake service.

Only `internal/supervisor/supervisor_test.go` changed (also used by `order_test.go`). Checked here: `go vet` on Windows and Linux. The tests themselves run in CI (`go test -race`); Smart App Control blocks the Go linker on the owner's PC.
