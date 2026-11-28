# Project posters: changes

## 2026-11-28: P1, the setting and serving the image

- **The setting:** `poster:` in `workspace.schema.json` (the `project.yaml` schema is built from it) and `WorkspaceFile.Poster`.
- **`internal/workspace/poster.go`:**
  - `findPoster` checks the path without reading the file. Web addresses and network paths are refused from the text alone, before any disk call. Then: the type by name, links, a regular file, 2 MB.
  - `followLinks` walks the path with `Lstat` and `Readlink`, so a link to a network path is refused before anything follows it. It reads Windows junctions too.
  - `Manager.Poster` reads the file and checks the content: the PNG signature, or well-formed XML with an `svg` root.
- **Warnings:** a poster that can't be shown is a warning on the `poster` line, for your own projects. The project still loads and saves, and the message names no path.
  - The warning doesn't read the file, because the list loads every project often. A file with the right name and wrong content gets no warning: the route answers 404, and the card will fall back.
- **List:** `poster_url` (with the file's time and size, so a change gets a new address) and `scripts`, the number the project file declares.
- **Route:** `GET /api/v1/workspaces/:id/poster`, with a sandbox policy, `nosniff` and same-origin only. The versioned address is cached; the plain one isn't.
- **Not changed:** the web app. Nothing reads `poster_url` yet (P2 and P3).

**A change from the plan:** network paths are found by how the text starts (two slashes, or `\??\`), not with `filepath.VolumeName`, which does nothing outside Windows. plan.md is updated.

**Checked:**
- `go vet ./...` and `go test ./...` pass on Windows.
- The six symlink cases are skipped on Windows without the right to make links. The poster tests, those included, pass on Linux (WSL).
- On a temporary server, with an SVG that carries a script:
  - the headers are as listed, and Claude's connector gets 403
  - opened directly, the image shows, the browser blocks the script, and the page's origin is `null`
  - it still loads in `<img>`

**Not covered:** the existing checks of `root` and repo folders still look up whatever path the text names, including network paths. That is outside this work and has its own task.
