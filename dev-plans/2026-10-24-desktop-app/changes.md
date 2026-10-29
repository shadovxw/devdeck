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
- **Other CI failures on the PR, fixed:** `labstack/echo/v4` v4.16.0 → v4.16.1 (Trivy flagged new CVEs fixed in 4.16.1); `TestClearReachesServicesNeverReadIn` reopened the store with the real clock, so once the seeded day (20 Oct) was more than 7 days old the reopen pruned it and nothing was left to clear. It now reuses the test clock. The new server test closes its listener without tripping errcheck.

Not yet: the tray and the close choice (PR 3); the icon and installer (PR 4). Until then the window uses the default Wails icon and closing it quits.

## PR 4: the icon and the installer (built before PR 3, the tray)

- **Brand icon**: `build/appicon.svg` is the devdeck mark (colours of the dark variant of `web/public/favicon.svg`) on a dark rounded tile. `scripts/make-icons.mjs` renders it to `build/appicon.png` (1024 px) and `build/windows/icon.ico` (16 to 256 px). The outputs are committed; the script only runs when the icon changes (it needs `@resvg/resvg-js`, installed temporarily).
- **The exe carries the icon and a manifest** (per-monitor DPI awareness, long paths) as a Windows resource, `cmd/devdeck/rsrc_windows_amd64.syso`, made with `rsrc` from `build/windows/`. Every Windows build of devdeck gets it, so the taskbar, the title bar, Alt-Tab and the installer show the mark.
- **One exe for window and terminal.** The desktop exe is a GUI-subsystem program (a double click shows no black window), and it attaches to the terminal it was started from when it has no standard output of its own, so `devdeck status`, `devdeck agent token` and the rest still print. Pipes and files set up by the caller are left alone, so git still runs it as the credential helper (checked with redirected input and output).
- **Started with no command, the desktop build opens its window** (what a double click or a shortcut does). `devdeck serve` is still the headless server.
- **Installer** (`installer/devdeck.iss`, Inno Setup 6), as in the plan's decision 8: per user, desktop-shortcut checkbox (ticked), start-with-Windows and PATH checkboxes (unticked), WebView2 installed when missing, in-place updates (the AppId is fixed), data left alone on uninstall.
- **`mise run package`** builds the web app, the desktop exe and `dist/devdeck-setup-<version>.exe` (`scripts/package.ps1`; the version is `git describe`). Inno Setup is needed: `winget install --id JRSoftware.InnoSetup -e`.
- Checked for real: the icon extracted from the built exe is the devdeck mark; the exe prints from a terminal; as git's credential helper with pipes it answers like the console build. Not checked in this session: the window opening from a double click (the user's own devdeck window was open, so a second copy correctly handed over to it) and the installer itself (Inno Setup isn't installed yet).
- Unsigned: Windows SmartScreen warns on first run until the installer is signed with a certificate.
- **Packaging fixes found by running it:** Inno failed writing the setup exe into `dist\` ("Resource update error", antivirus or the synced Desktop holding the folder), so `scripts/package.ps1` builds the installer in a temp folder and copies it to `dist\`; the version only uses `v1.2.3` tags (otherwise `0.0.0-<commit>`).
- **Checked with the real installer** (silent, into a temp folder, no shortcuts): it installs `devdeck.exe` with its icon and an uninstaller, registers the uninstall entry, creates no desktop shortcut or start-up entry when those boxes are unticked, and uninstalling removes the files and the entry. Not checked: the wizard's look, the desktop-shortcut and PATH tasks, and starting from the shortcut.

## The window has no system title bar

- **Frameless window.** The blue Windows title bar is gone; the web app's top bar is the title bar: you drag it, a double click on it maximises, and **minimise, maximise/restore and close sit beside the theme switch** (`web/src/app/WindowControls.tsx`, shown only in devdeck's own window). Wails still gives the window its shadow, snapping and edge resizing.
- **How the page reaches the window.** Wails puts its runtime (move, minimise, maximise, close) only into pages it serves itself, and devdeck's window shows the server's page. So when the window starts the server, the page gets two script tags in its `<head>` that load the runtime from `http://wails.localhost` (the window serves those files whatever page it shows), and the server's own address is the origin allowed to use it (`BindingsAllowedOrigins`). `webui.HandlerWithHead` and `server.WithUIHead` do the injecting; a browser sees no change.
- **Attached to a server that was already running** (`devdeck serve`), that page has no runtime, so the window keeps its system title bar.
- **One window per address**, not one per session: the lock name includes the server's address, so a development copy and the installed one can both be open.
- Checked on the real window (clicking it): maximise, restore, dragging by the bar and close all work; close stops the server. The runtime isn't present in a browser, so the buttons never show there.

## No flashing console windows

- **Bug:** the desktop exe is a GUI-subsystem program with no console, so every `git`, `gh`, `docker` or `aws` that devdeck ran for a page got a new console window of its own, which flashed on screen. The Repositories page runs about 8 git commands per repository, so it showed dozens.
- **Fix:** `sdk/proc` (the one place programs are started) now starts every command with `CREATE_NO_WINDOW` on Windows. Output still comes through the pipes. `HideWindow` is not used, because it would also hide a command's own windows (the folder picker's dialog).
- Measured with the real exe on the Repositories call (20 repositories): 18 visible console windows before, 0 after.

## CI fixes on the installer PR

- **Lint (`unused`):** `runtimeHead` sat in `loader.go` but only the desktop build (`window.go`) uses it, so a build without `-tags desktop` saw it unused. It moved into `window.go`.
- **Sonar coverage gate (67.6% on new code against 80%):** the largest gaps were the Wails window (excluded in PR 27) and `sdk/proc/group_windows.go`, whose tests run on Windows while the coverage run is on Linux; it is now in `sonar.coverage.exclusions` too. The server gaps were closed by the tests in PR 27.
