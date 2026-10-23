# Changes: devdeck as a desktop app

## PR 1: one program that serves the whole app

- **`web/webui.go`** (package `webui`) serves the built web app: a file that exists as it is (hashed `assets/` get a one-year immutable cache), any other path as `index.html` so the app's own routes (`/stacks`, `/hosts`) load on a reload, and never for `/api` or `/ws`. The files are embedded only with `-tags embedui` (`webui_embed.go`); a build without the tag (tests, CI, the Linux agent) has `Handler() == nil`, so nothing needs a web build.
- **`internal/server`** now builds and runs devdeck (store, bus, logs, supervisor, tunnels, the API, the app): `New`, `Run`, `Close`, `Handler`, `Running`. `cmd/devdeck/main.go` shrank to commands and `run()` calling it. `devdeck serve` behaves as before; the desktop window (PR 2) uses the same `Server`.
- **`api.Deps.UI`**: when set, the app is served for every path the API doesn't use. It sits behind the same Host/Origin check as the API.
- **`mise run build`** now builds the web app and then `go build -tags embedui`, so `bin/devdeck.exe` is the whole product. `mise run dev` is unchanged (Vite with hot reload, the server without the app).
- Checked for real: the 23 MB exe, started on another port with an empty data folder, served `/`, `/stacks` and `/hosts` as the app, the API, the favicon, 404 for an unknown API path, 403 for a foreign Host, and the page rendered in a browser with no console errors.

Next: PR 2, `devdeck app` with the Wails window.
