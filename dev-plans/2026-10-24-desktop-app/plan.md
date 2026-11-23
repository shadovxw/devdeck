# devdeck as a desktop app (Wails)

> Status: **plan, for review** · goal: a devdeck icon on the desktop and in the Start menu; clicking it starts devdeck and opens its UI in a window of its own, like Claude desktop. No terminal, no browser tab, no Node.

## 1. Today

- `devdeck.exe` is the Go server (`127.0.0.1:7070`, Host/Origin guard).
- The UI is a Vite app. In development Vite serves it on 5174 and proxies the API; there is no production path that serves the built UI from the Go binary yet.
- Stopping the server stops the local stacks it started (`sup.StopAll`), closes the log store and the tunnels.

## 2. Decisions

1. **Wails v2** shows the UI in a native window through **WebView2** (the Edge engine that ships with Windows 10/11). One exe, about 20–25 MB, no Chromium or Node bundled. The Go backend stays as it is.
2. **The UI is embedded in the binary.** `web/dist` is built first and embedded with `go:embed` in a small `web` Go package. The same embedded files serve both the app window and a plain browser at `http://127.0.0.1:7070` (useful for the second monitor or for debugging). `mise run dev` keeps working as now: Vite with hot reload, the server without the embedded UI.
3. **The window talks to devdeck over HTTP and the WebSocket, exactly as the browser does.** We do not move the API into Wails bindings: the React app, its fetch calls, the WebSocket and the Host/Origin guard stay unchanged. Wails' asset server forwards `/api` and `/ws` to the in-process Echo server (Wails `AssetServer.Handler`), so the page's origin is the Wails one and the guard learns it as an allowed origin. Nothing listens on the network that doesn't today.
4. **`devdeck app`** is the new mode (and what the icon runs): it starts everything `devdeck serve` starts, in the same process, then opens the window. `devdeck serve` (headless) and the CLI commands stay.
5. **One devdeck at a time.** A second click finds the running one (Wails single-instance lock, keyed per user) and brings its window forward instead of starting a second server on the same port and data folder.
6. **Closing the window hides it; Quit stops devdeck.** A tray icon (Show devdeck, Running stacks: n, Quit) keeps stacks running while the window is closed. Quit asks when stacks are running ("Stop 2 running stacks and quit?") and then shuts down in the same order as today. A setting can make closing the window quit instead.
7. **Data stays where it is**: `%AppData%\devdeck` (the default data folder), so the app and `devdeck serve` share workspaces, tokens and logs.
8. **Installer: Inno Setup** (changed from NSIS through Wails: devdeck builds with plain `go build`, not the Wails CLI, and Inno's "tasks" are exactly the checkboxes asked for). It installs per user into `%LocalAppData%Programsdevdeck` (no admin prompt) and adds a Start menu entry, a **"Create a desktop shortcut"** checkbox (ticked), **"Start devdeck when I sign in"** (unticked) and **"Add devdeck to my PATH"** (unticked). It installs the WebView2 runtime if it is missing, updates an installed devdeck in place (closing it first), and leaves the user's data alone on uninstall.
9. **Icon** from the existing logo (`web/public/favicon.svg`) on a dark rounded tile (`build/appicon.svg`), rendered to `build/appicon.png` (1024 px) and a multi-size `build/windows/icon.ico`; used by the exe (a Windows resource), the window, the tray and the installer.
10. **Code signing later.** An unsigned installer shows a SmartScreen warning on first run; signing needs a certificate, so it is a later step and the walkthrough says how to get past the warning for now.

## 3. Pieces

| Where | What |
|---|---|
| `web/embed.go` (Go package `webui`) | `//go:embed all:dist`; `Handler()` serving the SPA with index.html fallback for client routes, long cache for hashed assets |
| `internal/server` (new) | The server construction now in `cmd/devdeck/main.go` (`run()`): config, store, bus, logs, supervisor, tunnels, Echo, `Register`; `Start`, `Handler`, `Shutdown(ctx)`. Used by both `serve` and `app` |
| `internal/api` | Serve `webui` at `/` when present; `Guard` accepts the Wails origin in app mode |
| `cmd/devdeck/app.go` (build tag `desktop`) | `devdeck app`: Wails window (1400×900, min 960×640, remembers size), single instance, tray, Quit confirmation, asset server forwarding to Echo |
| `build/` | `appicon.png`, `windows/icon.ico`, `wails.json`, NSIS options |
| `mise.toml` | `mise run app` (dev window against Vite), `mise run package` (`npm run build` + `wails build -nsis`) |
| CI | A Windows job that builds the installer on tags and attaches it to the release (with the Linux agent binary) |

The desktop build sits behind a build tag so `go build ./...`, the tests and the Linux agent build don't need Wails or CGO.

## 4. Order of work

| PR | What | Done when |
|---|---|---|
| 1 | Embed the built UI and serve it from Go; move server setup into `internal/server` | `npm run build && go build` gives one exe that serves the whole app at 127.0.0.1:7070 with no Vite |
| 2 | `devdeck app` with Wails: window, asset forwarding, single instance, remembers size | Running `devdeck app` opens the UI in its own window; a second launch focuses it |
| 3 | Tray, close-to-tray, Quit with confirmation, clean shutdown | Closing the window keeps stacks running; Quit stops them and exits |
| 4 | Icon, NSIS installer, `mise run package`, optional start at sign-in, CI release job | Installing `devdeck-setup.exe` puts devdeck on the desktop and Start menu, and clicking it opens the app |

## 5. Risks

- **WebView2 missing** on an old Windows: the installer's bootstrapper handles it.
- **Port 7070 taken** by `devdeck serve` already running: the app finds it (single instance covers the app; a running headless server is detected and the app offers to use it or stop it).
- **CGO / toolchain**: Wails on Windows builds without CGO; the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails`) is a dev-only tool, checked by Doctor for contributors.
- **Antivirus / SmartScreen** on unsigned builds, until signing (decision 10).

## 6. Open questions

- ~~Close button~~ and ~~desktop shortcut~~: answered in §7.
- Later: macOS and Linux builds (Wails supports both; not planned now).

## 7. Answered (2026-10-24)

- **Close button: both.** The first time the window is closed while devdeck runs, it asks: "Keep devdeck running in the tray" or "Quit devdeck", with "Remember my choice". The choice is a setting (Settings → App → When I close the window: Keep running in the tray / Quit), changeable any time. Quit still asks first when stacks are running.
- **Desktop icon: a checkbox in the installer**, "Create a desktop shortcut", ticked by default. The Start menu entry is always created. "Start devdeck when I sign in" is a second checkbox, unticked by default.
