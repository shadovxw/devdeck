# Project posters: a poster card that opens into a dossier

Status: P1 built 2026-11-28 (see changes.md); P2 to P4 to do. Follows `dev-plans/2026-11-28-projects-ring` (R1).

## 0. Why

The ring's cards are the old grid tile stretched into a tall slot, so most of each card is empty. A **poster** fills the card at rest, and the front card **expands** to show the details (a **dossier**).

## 1. What we want

**At rest, every card:**
- Number and state on top (`PRJ_01`, `4 PROBLEMS`).
- The project's poster: its own SVG or PNG, or a drawn fallback.
- Name, and the shape in a line (`4 repos · 3 run modes`).
- Side cards are dimmed, so the front card stands out.

**The front card, on hover or keyboard focus:**
- It grows, and the cards beside it move apart, with a bounce (the feel of React Bits' "Bounce Cards").
- The poster shrinks to a band at the top, and the dossier appears below it:
  - description
  - repos by type, with counts
  - large totals: repos, run modes, scripts
  - while running, one dot per service in place of the type rows
- A click or Enter opens the project, as now.

**Decisions:**
- **Only the front card expands.** The side cards are slanted and cut off at the edges. A click brings one to the front, as now, and it expands if the pointer is still on it.
- **Written ourselves.** React Bits is the visual reference only, as with the ring. Its license is MIT + Commons Clause and this repo is public.
- **The frame stays** (gradient edge, cut corners). The scanlines go, and so does the red in the gradient, which reads as an error edge.

## 2. The poster setting

```yaml
# project.yaml or workspace.yaml
poster: ~/Pictures/acme.svg
```

- **A local file only, never a web URL.** A web URL would call an outside host each time the page is opened.
- **The project file is the only place it is kept.** There is no upload, no copy and no database row. The Settings tab writes this line.
- **Paths** resolve like `root` (`ResolveRoot`): absolute, starting with `~`, or relative to the folder that holds the project file. That folder is devdeck's, not the repos' folder, so most people will paste a full path.
- **Network paths are refused** (`\\server\share\…`, `//server/…`). On Windows, even looking one up can make the machine connect and sign in to that server.
  - The check is on the string alone, and runs before **any** filesystem call in all three places that touch the path: the list, validate and the route. This matters because Claude's connector may POST `/workspaces/validate` with text of its own.
  - It runs on the path as written and as resolved. Anything that starts with two slashes, of either kind, or with `\??\` is refused. That covers UNC, `\\?\UNC\` and device paths, and behaves the same on every OS, so CI tests it. It also refuses the long-path form of a local file (`\\?\C:\…`).
  - A mapped drive letter is allowed: Windows already holds that connection.
  - Links are read with `Lstat` and `Readlink`, one part of the path at a time, and each target is checked before anything follows it. `Stat` and `Open` follow a link, so they would already have connected.
- **Types:** `.svg` and `.png`, a regular file, at most 2 MB.
- **Shape:** tall, 1 : 1.45 (for example 600 × 870). It is shown with `object-fit: cover`, so another shape is cropped at the edges. A wide or square logo loses its sides: see §7.
- **Themes don't reach inside the image.** It is shown with `<img>`, so one image has to read well on Paper and Paper Dark.

## 3. Serving the file

The image is the one new thing that crosses from the disk to the browser.

`GET /api/v1/workspaces/:id/poster`

- **The path comes only from the project file.** The request names a project, never a file.
- **Content is checked, not just the name:** a PNG starts with the PNG signature, and an SVG parses as XML with an `svg` root. Symlinks are resolved first, and the target passes the same checks.
- **Headers:**
  - `Content-Type` fixed by the checked type
  - `X-Content-Type-Options: nosniff`
  - `Cross-Origin-Resource-Policy: same-origin`, so another web page can't load it
  - on every poster: `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'`
- **Why the sandbox matters:** an SVG can hold script. In `<img>` it never runs. Opened directly at this address it would run as devdeck's own origin, with the whole API, including running scripts. The Host/Origin check doesn't stop that, and the sandbox does.
- **Never inline** the SVG into the page.
- **Claude:** the connector's route list is an allow list and doesn't include `/poster`. It stays that way, and a test says so.
- **Failures** answer 404 with no file path in the message.

**The list** (`GET /workspaces`) gains `poster_url`, such as `/api/v1/workspaces/acme/poster?v=<modified>-<size>`. It is set only when the file passes the checks that need no read (path, type by name, regular file, size). A changed file gets a new address, and there is no extra request per card to learn whether a poster exists.

**Problems:** for your own projects, a poster that is missing, too big, the wrong type or a network path is a **warning** on the `poster` line. It never stops the project from loading or saving.

## 4. The card

**Rest and fallback**
- With no poster, or one that fails to load: the project's initials, large and heavy, on the faint dot grid, drawn from theme tokens. Most projects will look like this, so it has to look finished.
- A fade from `--bg` sits behind the text over a poster, so the name and state stay readable on any image.
- The image is `<img alt="" draggable="false">` with `pointer-events: none`. Without that, the browser's own image drag takes over the ring's drag.
- In Paper the panel and the page are both white, so the card gets a `--fill` surface.

**Expanding**
- **Size:** an element inside the slot grows its real width and height, up to about 1.2×. It doesn't use `scale`: scaled text on a 3D face blurs, and the controller already owns the slot's transform.
- **Spreading:** the controller eases an extra angle (about 8°, tuned by eye) onto the other slots. The math is a pure function in `ring-math.ts`. Without it, the side cards, which sit nearer to the viewer in 3D, would cover the bigger front card.
- **Triggers:** the pointer rests on the front card for about 120 ms, or the card has keyboard focus.
- **Collapses** when the pointer leaves, the focus leaves, a drag or sideways scroll starts, or another card becomes the front one. The drift already pauses on hover and focus.
- **Touch:** no hover, so no expanding. A tap opens the project, as now.
- **Motion:**
  - Effects Full: bounce, from a new `--ease-bounce` token (CSS `linear()`).
  - Effects Reduced: the same growth with a plain ease.
  - Ring still (Effects Off or reduced motion): instant, spread included.
- **Narrow windows (< 768 px):** the card grows only as far as the width allows with a 16 px gutter. It never scrolls sideways.
- **Screen readers:** the button keeps its `Project <name>` label. The details are tied to it with `aria-describedby`, with one id per slot, because cards repeat round the ring.

## 5. Settings

A **Poster** block in the project's Settings tab, for your own projects (examples are read only):
- a path field, a preview in the card's shape, **Save** and **Remove**
- quotes around a pasted path are removed (Windows "Copy as path" adds them)
- before saving, the existing validate call shows any poster warning
- the block names the file it will write. Saving is the confirmation step, and the old file is kept as `.prev`

**No new write route.** It uses the file's text and hash (`useWorkspaceFile`), `setTopLevel(text, "poster", value)`, which keeps comments, and `useSaveWorkspaceFile` with the base hash. It works for `workspace.yaml` and `project.yaml`.

**One fix it needs:** the `["workspaces","file",id]` query is never refetched (`staleTime: Infinity`), and a save leaves it alone. A second save would send the old hash and be refused. After saving, put the new text and hash into that query.

The preview shows the saved poster. The server never serves a path that isn't in the file yet.

## 6. Steps (one PR each)

| Step | What | Done when |
|---|---|---|
| P1 | `poster` in `workspace.schema.json` (the project schema is built from it) and in `WorkspaceFile`; path and content checks; the warning; the poster route with its headers; `poster_url` and a `scripts` count on the list | A project with a `poster:` line serves it; a bad one is a warning and a 404 |
| P2 | The Settings block and the file-query fix | Add, change and remove a poster from Settings, twice in a row without a conflict; comments in the file survive |
| P3 | The resting card: poster, fallback, text fade, dimmed sides, frame cleanup, Paper fill; a demo SVG in `examples/workspaces/acme-shop`, written by hand with no editor metadata (the repo is public) | Cards with and without posters read well in both themes; dragging over a poster turns the ring |
| P4 | Expanding: the dossier, growth, spread, triggers, motion levels | The front card expands and collapses without flicker, overlap or sideways scroll |

**A gap P1 and P3 close:** the card's "N scripts" counts flow files only. That follows the projects plan ("flows become scripts"), but flows aren't converted yet, so the `scripts:` in the project file are left out. P1 adds a `scripts` count (the ones declared in the file), and P3 shows it together with the flows.

**Plan upkeep:** P3 changes ring plan §1 ("Nothing on them changes") to point here. Each step keeps `changes.md` in this folder.

## 7. Open questions

1. **Logos:** most ready-made images are square or wide logos, and `cover` cuts their sides. If that is the usual case, add `poster_fit: contain` (the logo whole, on the dot grid). Not in this plan.
2. **One image for both themes:** a separate dark poster can come later if one image isn't enough.
3. **Choosing a file:** devdeck has a folder picker only. A file picker for the Settings field can come later.

## 8. Tests

- **Go, table tests:**
  - path rules: absolute, `~`, relative, a network path, a symlink to one, a folder, a wrong extension, over 2 MB
  - content: a real PNG, a text file named `.png`, a real SVG, HTML named `.svg`
  - the route: headers, 404 with no path in the message, no poster set
  - the list: `poster_url` changes when the file does; `scripts` count
  - the connector is refused `/poster`
  - validate with a network-path poster warns without touching the filesystem
  - the schema accepts `poster` in both files, and converting to `project.yaml` keeps it
- **Vitest:**
  - Settings: save, save again, remove, a refused save, quotes removed, no block on examples
  - card: poster, fallback, fallback after an image error, scripts count
  - ring: spread math; expand on hover after the delay and on focus; collapse on drag and on a change of front card; no expanding for side cards or touch
- **Browser** (throwaway server on 7071/5183, demo data only): Paper and Paper Dark; Effects Full, Reduced and Off; 375 px; 1, 2 and 5 projects; a tall, a square and a transparent image.
