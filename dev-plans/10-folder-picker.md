# Folder picker for Add workspace

The Add workspace form has a **Browse…** button next to the folder box. It opens the operating system's own folder window; when you choose a folder the path is filled in and the folder is scanned at once. Typing a path still works.

## Why the server opens the window

A browser never tells a web page the full path of a folder, only a handle to it, so a page can't fill in `C:\Users\you\code` by itself. devdeck runs on your own computer, so the server can show the window and send the path back.

## How it works

- `POST /api/v1/system/pick-folder` (no body) shows the dialog and waits. `200 {"path": "..."}` when a folder is chosen, `204` when the window is closed without choosing, `409` when a folder window is already open, `500` with a plain message when the window can't open (the form then says to type the path).
- It is a POST behind the usual Host and Origin checks, so a link, an image or another website can't open it. The window always starts in your home folder and its title is fixed, so a page can't steer it. Only the person at the screen can choose; a page can only ask.
- Closing the tab or leaving the page ends the request and closes the window. A window nobody answers is closed after 10 minutes.
- Only one window can be open at a time.

## The window runs in a child process

The first version showed the window inside the server and relied on the dialog library to close it when the request ended. A real test showed it doesn't: the window stayed open and blocked the next one. So `internal/dialog` starts devdeck itself as a short-lived child (`devdeck --pick-folder <title> <start folder>`), reads the chosen path from its output, and ends the process when the request ends. That always closes the window, and a problem in the operating system's dialog code can't take the server down. Exit code 3 means "closed without choosing".

The dialog itself comes from `github.com/ncruces/zenity` (MIT licence, pinned to v0.10.15): the Windows folder window, the macOS one, or `zenity`/`kdialog` on Linux. Only the library and `golang.org/x/image/colornames` are compiled in; the other modules that appeared in `go.mod` belong to the library's own tooling and tests.

## Limits that still apply

Scans stay inside your home folder, or the folders in `DEVDECK_SCAN_ROOTS`. A folder chosen outside them is refused by the scan with a message that says so. A phone or another computer opening the page can't pick a folder, since the window opens on the machine devdeck runs on.

## Code

- `internal/dialog`: `PickFolder` (starts the child), `RunChild` (what the child does), `Native` (zenity), `ErrCancelled`.
- `internal/api/system.go`: the route; `api.FolderPicker` is injected, so tests use a fake and no window opens.
- `cmd/devdeck/main.go`: runs the child when it sees `--pick-folder`.
- Web: `usePickFolder`, and the Browse button, waiting note and error in `WorkspacesPage`.

## Verified

Go and web tests (the dialog tests run the real child process with a fake window, including closing a window that nobody answers). By hand with a real server and the real Windows window: the window opened, closing the request closed it, no process was left, and the next window opened normally. A closed-without-choosing window came back as 204.
