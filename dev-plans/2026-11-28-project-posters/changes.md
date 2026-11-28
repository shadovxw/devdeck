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

## 2026-11-28: P2, the Settings block

- **`pages/project/PosterSetting.tsx`**, in the Settings tab of your own projects:
  - a preview in the card's shape, a path field, Save and Remove, and the name of the file they write
  - quotes round a pasted path are removed
  - the server checks the text before it is saved, so a bad path is said first. A warning doesn't block saving
  - a file that changed on disk isn't overwritten: it is read again, what was typed stays, and saving again adds the line to the new version
- **`setPoster`** (`lib/yaml-doc.ts`) changes only the `poster:` line.
- **The save fix** (`useSaveWorkspaceFile`): after a save, the cached file gets the new text and hash, so the next save isn't refused. It also updates the copy the editor compares with, so the editor's own line for that is gone.

**A change from the plan:** `setPoster` instead of `setTopLevel`, which rewrites the whole file: `[lists]` and comments get respaced, and Windows line endings become Unix ones. plan.md is updated. The editor's Form view and quick fixes still use that rewrite, although `yaml-doc.ts` says they never reformat. That isn't changed here.

**Checked:**
- typecheck, lint and 957 web tests pass. With the save fix turned off, the "one save after another" test fails.
- In the browser, on a temporary server with a demo project whose file has Windows line endings:
  - saving a quoted Windows path added that one line, and the picture showed
  - a network path showed its warning before saving
  - three saves in a row went through, and after Remove the file was the same as at the start, byte for byte
  - Paper and Paper Dark
  - at 375 px the block fits. The page does scroll sideways there because of the project's tab row, which was so before this change

## 2026-11-28: P3, the resting poster card

- **The card** (`WorkspaceCards.tsx`): the poster fills it, with the number and state above and the name and shape below. The description and the type bar are gone from it. They come back in P4's dossier, and `typeMix` stays for that.
- **No poster, or one that fails to load:** the project's initials on the dot grid (`initials`: two words give their first letters, else the first two characters).
- **The image** is decorative (`alt=""`) and can't be dragged or clicked, so the ring keeps its drag.
- **The shape line** counts flows and the project file's `scripts:` together.
- **Styles** (`pieces.css`, from tokens):
  - fades behind the text over a picture
  - side cards at 55%
  - scanlines and the red in the frame's gradient removed (the project page's header keeps its own gradient)
  - on a narrow card the Example tag wraps under the name instead of cutting it short
- **Example:** `examples/workspaces/acme-shop/poster.svg`, written by hand, and its `poster:` line.
- **A P1 test** assumed the user's project was first in the list. The example, listed before it, now has a poster, so the test finds its project by name.

**A change from the plan:** the card's surface and fades use `--ink` mixed into `--bg`, not `--fill`. The tests couldn't see this: `--fill` is 7% see-through in this style, and the browser check showed unreadable text over the dark poster in Paper. plan.md is updated.

**Checked:**
- typecheck, lint, the web tests and `go test ./internal/...` pass.
- In the browser, on a temporary server with the example and four demo projects (a bright poster, a square see-through logo, two without a poster):
  - Paper and Paper Dark: the text on the card ahead reads well over each picture
  - dragging across a poster turns the ring and opens nothing
  - 375 px: no sideways scroll, all text inside the card
  - a square logo loses its sides, as the plan says (§7, question 1)
  - not checked by eye: Effects Off and Reduced, and rings of one or two projects

## 2026-11-28: P4, a still fan in place of the ring

**Asked mid-step:** cards like React Bits' "Bounce Cards", not a moving panorama. P4 was first built on the ring (dossier, growth, side cards spreading); that version is not committed. The dossier, its styles and the hover rules carry over.

- **`design/fan/CardFan.tsx`** replaces `design/ring/`, which is deleted with its tests. No animation loop: React sets each card's pose, and CSS moves it.
- **The page** is back to the normal width: the full-bleed layout was only for the ring. The Home scene change stays.
- **The dossier** (`WorkspaceCards.tsx`): description, repos by type (the biggest three and "N more" past four) or a mark per service while running, and totals. It is always in the page, as the button's description.
- **Styles** (`pieces.css`, `tokens.css`): the fan, the opening, `--ease-bounce` and `--dur-bounce` (nothing under reduced motion). The card's edge is a solid colour now, because cards lie over each other.
- **Found in the browser and fixed:** a covered card's summary line ran under its neighbour; large initials ran into the state on an open card; the description was hidden on cards with room for it.

**Checked:**
- typecheck, lint and 932 web tests pass (fewer than before: the ring's tests are gone).
- In the browser, on a temporary server with the example and demo projects:
  - hover opens a card, and moving across its open edge keeps it open
  - a click opens the project; Tab onto a card opens it up
  - 5 cards in one fan, 8 in fans of 6 and 2; nothing clipped at the ends
  - Paper and Paper Dark
  - 375 px: one scrolling row of straight cards, and no sideways page scroll
  - not checked by eye: Effects Off and Reduced, the bounce itself (screenshots show where things end up), service dots on a running project, and a tap on a real touch screen

## 2026-11-28: the fan made smooth

**Asked:** it wasn't smooth; look at React Bits' source. Their "Bounce Cards" writes one `transform` per card from hand-written springs, with no hover delay. Their code isn't copied (license); the technique is rebuilt with the installed `motion` package.

**Why ours stuttered:**
- the open card animated its real width and height, and inside it the picture's height and the dossier's rows, so the text was laid out again on every frame
- CSS transitions start again from a standstill when the pointer moves on
- a 120 ms delay, during which the open card closed before the next one opened
- a drop shadow was painted again on every frame (Effects Full)

**Now** (`CardFan.tsx`, `pieces.css`, `lib/motion.ts`):
- only transforms and opacity change: springs for each card's pose, a dossier sheet that slides up, initials that move up, a glow layer that fades
- cards are drawn at their open size and scaled down at rest
- hover acts at once; only the cards' unmoving places answer the pointer
- the Example tag sits beside the state, so a card's name never moves to another line
- `poseFor` is table-tested; the component tests check which card is open, not transform strings

**Checked:**
- typecheck, lint and the web tests pass
- in the browser: while opening, the card and its name keep the same layout size; no width or height is transitioned inside the fan; the open card rests with no transform, so it is sharp; switching, closing back to the exact rest poses, a click past the card's resting edge, Tab and Enter, and the 375 px row all work; no console errors
- **smoothness itself was not measured:** the browser pane couldn't be brought into view, so the page's frames were throttled

## 2026-11-28: after the reference's source was shared

The Bounce Cards source was pasted into the session. Its code isn't copied (license); it confirmed the approach above, and showed three differences, now matched in our own code:
- size has its own looser spring (`cardPop`: 170 / 13), so a card pops as it opens
- the open card rises a little
- the pointer is read against where cards rest, never where they are now. Ours still let the open card's larger area cover about half of the next card's visible part (found by working out the sizes), so moving right felt stuck. Fixed hit areas over the fan replace that.

**Checked:** typecheck, lint and 938 web tests pass. In the browser: the hit areas sit edge to edge on top; with one card open, moving 8 px into the next one's area opens it (one leave and one enter), it stays open, and a click opens that project. Smoothness still isn't measured.

## 2026-11-28: a gap beside the open card

**Asked:** a gap between the cards when one is hovered, and pictures to see the cards with.

- **The gap** (`CardFan.tsx`): the others move out until at least 0.08 of a card is clear on each side, counting a tilted card's extra width. To keep everything on the page, cards are a little smaller when a fan is full, narrower pages take fewer to a fan, and the scrolling row now starts under 680 px.
- **Hit areas:** the open card is read over all of itself and its neighbours from its edge outwards (`hitFor`). This replaces the rest-only areas of the entry above, which no longer match what is on screen once cards move that far. "Moving onto the right edge of an open card switches" is no longer so.
- **Tests:** for each page width and number of cards, whichever card is open: the gap is there on both sides, nothing passes the edges, and each area that can open a card lies inside that card's open area (so a still pointer can't flicker between cards).

**Pictures:** five hand-drawn sample SVGs for the local demo projects, in their folders under the git-ignored `.devdeck/data`, each with a `poster:` line saved through the app (which keeps a `.prev`). Nothing in the repo changed for them.

**Checked:** typecheck, lint and 972 web tests pass. In the running app: all five posters load; with a middle card open there is a clear gap on both sides, nothing is cut off and the page doesn't scroll sideways. A card opening that the test hadn't pointed at was traced by logging pointer events: a real mouse was moving over the browser pane at the same time. That is likely also what caused the odd result in the entry above, which wasn't logged.
