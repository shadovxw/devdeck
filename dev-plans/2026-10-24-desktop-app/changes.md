# Changes: devdeck as a desktop app

## PR 1: one program that serves the whole app

- **`web/webui.go`** (package `webui`) serves the built web app: a file that exists as it is (hashed `assets/` get a one-year immutable cache), any other path as `index.html` so the app's own routes (`/stacks`, `/hosts`) load on a reload, and never for `/api` or `/ws`. The files are embedded only with `-tags embedui` (`webui_embed.go`); a build without the tag (tests, CI, the Linux agent) has `Handler() == nil`, so nothing needs a web build.
- **`internal/server`** now builds and runs devdeck (store, bus, logs, supervisor, tunnels, the API, the app): `New`, `Run`, `Close`, `Handler`, `Running`. `cmd/devdeck/main.go` shrank to commands and `run()` calling it. `devdeck serve` behaves as before; the desktop window (PR 2) uses the same `Server`.
- **`api.Deps.UI`**: when set, the app is served for every path the API doesn't use. It sits behind the same Host/Origin check as the API.
- **`mise run build`** now builds the web app and then `go build -tags embedui`, so `bin/devdeck.exe` is the whole product. `mise run dev` is unchanged (Vite with hot reload, the server without the app).
- Checked for real: the 23 MB exe, started on another port with an empty data folder, served `/`, `/stacks` and `/hosts` as the app, the API, the favicon, 404 for an unknown API path, 403 for a foreign Host, and the page rendered in a browser with no console errors.

Next: PR 2, `devdeck app` with the Wails window.

## PR 2: `devdeck app`, the window

- **`internal/desktop`**: `Run` starts the server (or uses a running `devdeck serve`, detected by its health answer) and opens a Wails window (title devdeck, 1400×900 by default, minimum 960×640, the last size remembered in `window.json`). Closing the window stops the server it started, in the same order as `devdeck serve` (stacks, tunnels, logs, database). The Wails code is behind `-tags desktop`; without the tag `devdeck app` says how to build it, so tests, CI and the Linux agent don't need Wails.
- **Changed from the plan: the window opens the server's own address**, not a Wails-served origin. Wails' asset server can't carry a WebSocket, which devdeck's live updates use. Its first page only moves the window to `http://127.0.0.1:<port>`, so the app behaves exactly as in a browser: same API, same WebSocket, same Host/Origin check, no guard change.
- **One window per session**: a second launch hands over to the first (Wails single-instance lock) and exits; the open window is shown and un-minimised.
- **`Server.Start`/`Done`** split out of `Run` so the window can wait for the server to listen; an address already in use is `ErrAddrInUse`, reported in words ("something else is using 127.0.0.1:7070: stop it, or set DEVDECK_ADDR").
- **No terminal behind the window**, so the app logs to `<data>/app.log` (started over past 5 MB).
- **`mise run app`** builds `bin/devdeck-app.exe` (30 MB; `-tags desktop,production,embedui -ldflags "-H windowsgui"`).
- Dependency: `github.com/wailsapp/wails/v2` v2.17.0 (and what it needs).
- Checked for real: on a spare port with a throwaway data folder, the exe opened a window titled "devdeck" (WebView2), the page connected to the server, a second launch exited and left the first running, closing the window saved its size and stopped the server.

- **Coverage gate (Sonar, 52.6% on new code against 80%):** `internal/desktop/window.go` is the Wails glue, built only with `-tags desktop` and needing a real WebView2 window, so it can't be unit-tested; it is now in `sonar.coverage.exclusions` (still analysed). New tests cover `Server.Start` (address in use, a bad address, `Done` quiet while serving, `Run` returning a failed start's error) and `pluginIDs`; `internal/server` goes from 80.3% to 86.8%.

Not yet: the tray and the close choice (PR 3); the icon and installer (PR 4). Until then the window uses the default Wails icon and closing it quits.
