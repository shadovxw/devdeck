# Phase 3: Logs, what was built

Goal of the phase: never hunt through terminals again. The plan is in [`2026-10-21-logs/plan.md`](2026-10-21-logs/plan.md) and what each of its five pull requests changed is in [`2026-10-21-logs/changes.md`](2026-10-21-logs/changes.md). This is the short version.

## What exists

1. **Ingest** (`internal/logs`). Every line a service prints, and every line its build and the compose commands print, goes through a non-blocking sink: colour codes and carriage-return progress are cleaned, secrets are masked (the exact values of the service's own secret-named variables first, then patterns), the capture rule is applied, and the line is stored. Memory keeps 50,000 lines per service; JSON lines files, one folder per service and one file per UTC day, keep the rest, for 7 days and 500 MB by default. A service's output pipe never waits for logging.
2. **Capture rules.** Each service and each compose container stores everything, only lines matching a pattern, or nothing, set in the stack file and switchable at run time. A container whose rule is off is not even followed.
3. **Containers.** Once a compose file is up, devdeck follows each container's Docker logs and stores them as `<compose id>/<container>`, restarting a follower that ends and never storing a line twice.
4. **Parsing.** Each line gets a level, and when the line says so a message, a caller and its fields (zerolog and the usual spellings of zap, slog and pino; TypeScript, esbuild and Vite messages; plain text by its words). A Go panic becomes one entry with the first frame of the program's own code as its caller. Error and fatal entries get a fingerprint, and entries with the same fingerprint form an error group with a count and first and last seen.
5. **Query.** The logs route filters by services, levels, a pattern, fields, a time range and an error group, and reads the day files when memory doesn't reach back far enough. A typical filter over 500,000 lines takes a few milliseconds (a test gates it at one second). Filters can be saved with the workspace (`log-filters.yaml`).
6. **The Logs page** (`/logs`).
   - **Filter bar:** services, levels (each with its own shape and word), a pattern (Go-style `(?i)` flags work), field filters, a time range. The filters live in the address, so a view can be bookmarked or shared.
   - **Stream:** a windowed list that follows the newest line while live; Pause and Resume (catching up from the server); lines that arrive live are tested against the same filters; older lines load on demand; arrow keys move the selection.
   - **Level histogram:** stacked bars in plain SVG; dragging across it narrows the view to that stretch (which stops following live; "Back to live" returns).
   - **Errors panel:** the error groups, one click to see only that group's lines.
   - **Selected line:** its full text, fields, a VS Code link when its caller is a file of the service's repo, "Show every line like this", and a disabled "Ask Claude" (comes with Phase 10).
   - **Saved filters:** save, apply, delete (with a confirmation).
   - **Clear:** deletes the stored lines of one service or of the whole stack, after a confirmation.
   - **Stacks page:** each service row links to its logs.

## Where the "done when" stands

- *Filtering 500k lines returns in under 1 s*: measured, and a test fails if it doesn't (see the PR 4 notes for the numbers).
- *An error in a service appears in the Errors panel with a working VS Code link within 1 s*: lines reach the browser in about 20 ms, and a live line that carries a fingerprint makes the page refresh the Errors panel at once (at most once a second); the poll every 5 s is the fallback. The line and its link are there as soon as the line is.

## Known gaps and later

- Retention (days and size) is set with environment variables; making it editable belongs with the Settings page (3.4.6).
- The histogram and the error groups are counted from what a service has in memory and in the files; groups reach back only as far as a service's 50,000 lines.
- "Ask Claude about this error" is a disabled button until Phase 10.
- A failed write of a log file is not reported anywhere yet (the lines still reach memory and the live view).
- The browser reads patterns with its own engine, so Go-only syntax (such as `[[:alpha:]]`) is refused by the filter box even though the server would accept it.
