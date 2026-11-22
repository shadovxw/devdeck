# Neon, refined: the portfolio look across devdeck's pages

> 2026-11-21 · owner: Vrishank Warrier · from the owner's design brief and approved mockups (private, in the git-ignored `tmp/`; nothing from them is copied here) · refines [`2026-11-21-neon-look/`](../2026-11-21-neon-look/plan.md) and touches [`02-frontend-design-system.md`](../02-frontend-design-system.md) · status: **approved 2026-11-21 ("match the mockup"); P1 in progress.**

## 1. Goal

Make the **Neon** style (Settings → Appearance → Style) look like the approved mockups on every page: a near-black page with a faint dot grid, big tight heavy headlines, every label in uppercase mono written like a terminal (`01 $ UP  STACKS ─── TOTAL_STACKS: 04`), one accent from the theme, one gradient word per screen, no borders, no rounded corners, no shadows except glow on focus and hover, panels set apart by a lighter shade, diamonds as markers. Calm and dense: a tool opened every day.

**Flat (Paper) stays exactly as it is**, pixel for pixel.

## 2. Ground rules (from `CLAUDE.md`, unchanged)

- Everything hangs off `:root[data-look="neon"]` in `web/src/design/looks.css` and files it imports. New components render the same structure in both styles; only the Neon CSS changes how they look, or a component renders a Neon-only extra (the orb, the gradient word) that is absent in Flat.
- **No hard-coded colours** in components: theme tokens, or Neon tokens made from them with `color-mix()`. The purple is the owner's theme's `primary`; it never appears in CSS.
- **Public repo:** no names, workspaces, stacks or dates from the mockups in code, tests, fixtures or docs (`acme`, `demo-api`, `example.com`). Nothing from `tmp/` is committed.
- **The built-in Neon theme is neutral** (decision 3); the owner's purple lives in their own theme file.
- No git writes; `npm` only; fonts from `@fontsource-variable/*` (already installed); no CDN.

## 3. Decisions

1. **This is the Neon style, refined** (the brief's default), not a third style. The first Neon slice (Inter/JetBrains Mono, `//` labels, active diamond, dot grid, glass menus, mono buttons) is the base; this plan changes some of it (decisions 6 and 7).
2. **Tokens under Neon** (all from theme tokens): every radius `0` except status dots; no hairlines on panels, header, sidebar or rows (outline buttons and tags keep a 1px border); `--neon-panel` = the theme's cards colour, which must stay visibly lighter than the page; `--neon-gradient` from primary through a mix to critical, used on **one word per screen**; `--neon-grid` 5–6% ink on a 24px grid; a second accent (the theme's `--link`) only for *live / connected*; **no orange**: under Neon `--serious` (restarting) uses the warning colour, so green, yellow and red only mean status; label text is the muted ink, at least 4.5:1 on the page (checked with `theme/checks.ts`).
3. **A built-in "Neon" theme, neutral** (near-black, one cool accent, tuned status colours), so the style looks right without importing anything. It is a third built-in base next to Paper and Paper Dark, which means the theme validation (`theme/validate.ts`, and `builtInThemes` in `internal/api/themes.go`) learns the new base. The owner's purple stays in their imported theme.
4. **Type scale under Neon:** greeting 40px/900/-0.04em; section display heading 48px/900/-0.045em; card title 24px/900; body 14–18px/500; mono labels 11–12px uppercase, letter-spacing 0.15–0.25em.
5. **Shared pieces, built once** in `web/src/design/`, each with a Vitest test: `SectionHeader` (boxed index, `$ VERB`, `NAME`, a short primary line, `COUNT: 04`; optional display heading with the gradient on its last word), `Panel` (shade, no border, 20–24px padding, a header row with a mono label left and a link right), `StatusStrip` (`KEY:: VALUE` pairs, value coloured by meaning), `StageRail` (five diamonds joined by a line, done / to do / warning, labels under it), `Tag` (tiny mono label, 1px border in its status colour). In Flat they render in today's Paper idiom (plain heading, plain list), so Flat doesn't change.
6. **Buttons under Neon:** primary is **solid ink on the page colour** (white on dark), dark text, mono uppercase, 48px tall, square; secondary is transparent with a 1px 25% ink border; quiet controls (workspace switcher, `Ctrl K`, segmented toggles) are a 7% ink fill, no border; a pressed segment is solid ink. This replaces the first slice's "primary-coloured button with glow on hover": the accent stays for marks and words, not the main button.
7. **Navigation under Neon:** the app's **real groups stay** (Workspace, Code, Run locally, Run remotely, Data, Pipelines, Explore, Platform); only their look follows the mockup (`// NAME` mono headers, a 7px hollow diamond per item, filled primary with glow when active, a 6% ink fill on the active row, the wordmark as `dd.` with the dot in primary). The mockup's own group names were drawn for the picture; renaming the nav is a separate decision (open question 2).
8. **An Effects setting arrives with the orb** (the neon-look plan's planned *Off / Reduced / Full*). Its **default follows the style**: Flat → Off, Neon → Full; the owner can lower it. Reduce motion still wins over everything. This changes the neon-look plan's "Off by default", in the same PR.
9. **The orb is the one WebGL exception.** It breaks the neon-look plan's decision 6 ("no WebGL") and the main plan's "3D deferred, no 3D on Home". It is allowed because it only appears on **empty** pages (never on Home with data), only under Neon with Effects above Off, as a **lazy chunk** (`three` is never in the main bundle), with a still frame under Reduce motion, a stopped loop when the window is hidden, and the existing `EmptyArt` as the fallback (Flat, Effects Off, no WebGL). Both plans are updated in the PR that adds it. Plain three.js, not react-three-fiber: one small scene doesn't need it.
10. **The orb reads its colours from the theme at run time** (`getComputedStyle` on `:root`, again when the theme changes), never hard-coded. One renderer per page, `devicePixelRatio` at most 2, 30–60 fps, everything disposed on unmount; decorative (`aria-hidden`), with the real message in text.
11. **Three kinds of empty**, treated differently: *never set up* (full empty state: orb, mono line, headline, one action, one command), *set up but idle* (one quiet mono line and a small action, no orb), *no results* (`0 results for "x"` and *Clear filter*, no orb, no motion).
12. **Greeting on Home:** "Good evening, <name>." uses a name from **Settings → General → Your name**; empty means "Good evening." with no name. Never hard-coded, never read from a repo. (Open question 3.) This is a Neon-only line: the design system's "no greetings" (P7) stays the rule for Flat.
13. **Checking Flat is unchanged:** before-and-after screenshots of Home and Stacks in the browser pane at the same size, kept in `tmp/` (not committed), compared by eye and by a pixel diff where possible. There is no screenshot test runner in the repo; adding Playwright is not part of this plan.
14. **Checks run as plain commands** (the owner doesn't use mise): `npm run lint`, `npm run typecheck`, `npm test` in `web/`, `go test ./...` when Go changes.

## 4. Pages

- **Home, with data:** a compact header, not a hero: mono kicker (`WORKSPACE · <NAME> · <DATE>`), the one-line greeting at 40px with a muted summary beside it, then a `StatusStrip` (Docker, Claude, branch, mode). Then `01 $ UP  STACKS` and "RUNNING **STACKS**", stack cards **four across** (label and status on one line, name, services / ports / uptime, `StageRail`). Then two panels side by side: recent runs, and Doctor findings. All stacks visible without scrolling at 1440×900.
- **Resources, running:** `02 $ TOP  RESOURCES` with a live dot (`LIVE · 2s`), "LIVE **USAGE**". Three tiles (CPU, memory, disk): big number, unit, a small bar series (latest solid, earlier faded). The per-service table in a panel (no row lines; CPU as a thin bar and %), a right column with a host `StatusStrip` and an event tail. The time window (5M / 15M / 1H / 24H) as a segmented control in the top bar.
- **Every other page with data:** the same pieces, nothing new. The page title becomes a `SectionHeader` and a display heading with one gradient word. Tables lose borders and row lines; spacing and the panel shade separate rows. Status uses the status dot, `Tag`, and `StageRail` where there are stages (stacks, runs, migrations, flows).
- **Home, no workspace:** the only **hero orb** (about 440px), with its state under it (`THINKING · WAITING FOR A STACK` / `IDLE`); `00 $ BOOT · NO STACKS RUNNING`; "Your workspace is ready **to connect**." at 48px; one line of text; *Configure workspace* (primary) and *Setup guide* (secondary); then `or run devdeck init` and `Ctrl K for commands` as mono chips.
- **Other empty pages:** a **mini orb** (about 120px), the same component with a variant per page (the brief's table: a cluster for Workspaces, a ring for Repositories, branches for Features, layers for Stacks, a falling stream for Logs, a heartbeat for Resources, a satellite for Remote hosts, a cylinder for the data pages, a path for flows and runs, a cube for Images, a closed shell for Storage and Secrets, sockets for connections, the plain orb for Claude, a calm success-coloured orb for Findings and Doctor, a tiny one for Notifications, none for Docs and Settings). "Thinking" only while devdeck is really working (Doctor running, a stack starting, Claude busy); "ok" in the success colour for good-news empties, never purple.

## 5. Order of work (small PRs)

| PR | What | Done when |
|---|---|---|
| P0 | This plan | Approved |
| P1 | Neon tokens of decision 2 (square, borderless, panel shade, no orange), the nav regrouped as the mockup (§8) and styled, the top bar, buttons (decision 6) (`Tag` moved to P2) | Neon matches the mockups' shell (sidebar, top bar, buttons); Flat unchanged by screenshot |
| P2 | `SectionHeader`, `Panel`, `StatusStrip`, `StageRail`, `Tag`, each tested; used on Home | Home's sections use them in both styles; Flat unchanged |
| P3 | Home with data (greeting; the name waits for Q3) | Matches the mockup at 1440×900; four stacks visible without scrolling |
| P3b | Resources in the Neon look. **Waits for its data:** the page is still a placeholder (main plan Phase 5 collects CPU, memory and disk; the system-metrics plugin is only a stub). Built with Phase 5 | Matches the mockup with real numbers |
| P4 | The Effects setting (decision 8), `EmptyOrb` hero (lazy, theme colours, off switches), Home's empty state; neon-look and main plans updated (decision 9) | `three` only in its own chunk; still frame with Reduce motion; stops when hidden (test); `EmptyArt` on Flat, Effects Off and without WebGL |
| P3c, P3d | Home as a launcher, the dashboard to Overview: see §8a | See §8a |
| P5a | Mini orb variants, part 1 (Workspaces, Repositories, Features, Stacks, Logs, Resources, Claude, Findings/Doctor) and the three kinds of empty | Each of those pages checked empty and filtered to nothing |
| P5b | Mini orb variants, part 2 (the rest of the table) | Every nav page checked empty |
| P6 | The remaining data pages restyled with the shared pieces | `grep` finds no hard-coded colour in any component |
| P7 | Docs: `docs/appearance.md` (Neon, the orb, its fallbacks), `CLAUDE.md` UI rules for Neon, design-system doc pointer | Reviewed |
| P8 | Neon options: text size, UI and code fonts, gradient colours (Settings → Appearance, under Style) | Changing each option shows at once across the app; Flat is unaffected |

P5 is split in two because the variants are the riskiest part (shader work per page); the first half proves the approach before the rest.

Each PR: lint, typecheck, Vitest, `go test` if Go changed; screenshots of the changed pages in the PR text (both styles where the page changed).

## 6. Checks before calling it done

- **Contrast:** every text colour at least 4.5:1 on its background, in the owner's theme and in the built-in Neon theme (`theme/checks.ts`).
- **Keyboard:** visible focus on every control (the glow ring); nothing mouse-only; the orb decorative, the message in text.
- **Performance:** Home with data has no WebGL; the orb chunk loads only on empty pages; idle CPU near zero with the window hidden.
- **Narrow windows:** the nav stacks, cards go two then one across, tables scroll inside their panel.

## 7. Risks

- **The orb's cost and look per variant:** one shader with parameters per variant, not one scene per page; P5a proves it on eight pages before P5b.
- **`three` size** (hundreds of KB): lazy chunk only, checked in the build output.
- **Drift between Flat and Neon markup:** shared components render one structure; screenshots of Flat on every PR.
- **WebView2 differences** (blur, additive blending): checked in the desktop window, not only in a browser.

## 8. Answered (2026-11-21)

The owner: "match the mockup and start; the theme will be Neon; we can customise the size, font and neon gradient colours, not the theme."

- **Q1:** this refines the Neon style. No third style.
- **Q2:** the nav follows the mockup: five groups, **Overview, Run locally, Data, Automate, System**, for both styles (grouping is structure, not looks). Pages the mockup doesn't show go where they fit: Features to Overview; Saved scripts and Storage to Data; Images, Flow trace to Automate; Plugins, Claude access, Notifications, Docs to System. This is the one change Flat also gets.
- **Q4:** Effects follow the style (Flat Off, Neon Full).
- **Q5:** the primary button is solid white (ink), as in the mockups.
- **Decision 3 dropped:** no built-in Neon theme. Colours come from the owner's own theme. Instead, Neon gets its own **options** later (PR P8): text size, the two fonts, and the gradient's colours (defaults from the theme's primary and critical).
- **Q3** (the greeting's name) is still open; until answered, the greeting has no name.

## 8a. Home as a launcher (decided 2026-11-22)

After P4 the owner chose to make Neon's Home a **fixed launcher**: the same every time, a place to go somewhere from, not a dashboard whose content changes. Their answers:

- **Neon only.** Flat's Home stays as it is.
- **The command bar is page search** for now: a big "Where to?" box that finds pages by name and opens them. The real Ctrl K palette (pages, stacks, actions, from anywhere) stays hub milestone H2.
- **The dashboard moves to a new Overview page:** what P3 built for Neon's Home (status strip, running-stack cards, Needs a look) becomes `/overview`, under `// OVERVIEW`. In Flat, Overview shows the same dashboard Flat's Home already shows. Home links to it.
- **No login.** devdeck is local and single-user (auth stays deferred, `CLAUDE.md`). The greeting's name comes from a **Your name** setting; empty means "Good evening." (Proposed to the owner; confirm before P3d.)

**The launcher, top to bottom:**
1. **Header:** "Good evening, <name>." and the workspace switcher. No summary line (it would change).
2. **The orb, always** (hero size). It is the one part that moves: idle when nothing is happening, "thinking" while devdeck works (a stack starting; later Doctor running, Claude busy), with its state in a mono line under it. Effects Off, Flat or no WebGL: the usual art.
3. **The command bar:** "Where to?" as a large input; typing filters the nav pages (label, group, and the page's empty-state text), arrows move, Enter opens. The `Ctrl K` hint shows only once the palette exists.
4. **The launch grid:** one large square tile per nav group (Run locally, Data, Automate, System; Overview's pages first as a row), each with its mono label (`// RUN LOCALLY`) and its pages as links. Built from `nav.ts`, so a new page appears by itself.
5. **Not included:** "Recently opened" (it changes; the owner can ask for it later).

The hero empty state of P4 ("Your workspace is ready to connect") moves to the **Workspaces** page's empty state in Neon, where configuring a workspace happens.

| PR | What | Done when |
|---|---|---|
| P3c | `/overview` (new nav item under Overview): the P3 Neon dashboard and, in Flat, the dashboard Flat's Home shows today; tests move with it | Overview shows the stacks in both styles; Flat Home unchanged |
| P3d | Neon Home as the launcher: header with name (the *Your name* setting), the orb with live state, the page-search bar, the launch grid; the hero empty state moves to Workspaces | Home looks the same with and without stacks; typing a page name and Enter opens it; every nav page is reachable from the grid |

## 8b. Launch intro, loading states, orb carried across (designed 2026-11-22)

The owner's design canvas has three more screens: the **launch intro** that ends in the launcher Home with the **one orb** (`Intro`, `IntroToHome`, `IntroStoryboard`), the **loading states** (`LoadingStates`), and **Home → Workspaces with the orb carried across** (`OrbTransition`). They build on P3d, so they come after it. The design's hex colours (brand teal, theme purple) map to theme tokens (`accent`, `accent-2`, `warn`, `critical`), read at run time as `orb/model.ts` already does, so every theme reaches them.

**Launch intro (P9b).** About 3.4s, then the app:
1. *Gather* (0–1.1s): the particles drift in and form a ring.
2. *Assemble* (0.35–1.35s): the D's stem flies in from depth and the ribbon swings shut on its hinge.
3. *Prompt* (1.15–1.45s): the `>_` pops and the cursor blinks.
4. *Lockup* (1.35–3.0s): the mark faces you and moves left, `devdeck` rises letter by letter, the tagline shows and a light sweeps across.
5. *Hand-off* (3.0–3.45s): the lockup shrinks into the sidebar logo (`data-ui="logo"`), and the ring streams into Home's orb slot.
6. *Home* (3.2–3.8s): the sidebar slides in, then the launcher rises.

Rules for when it plays and how it degrades:
- **When:** cold start only, at most once per app session (`sessionStorage`), never on reloads or page changes. Only on Neon with Effects Full; any other setting skips it.
- **Skip:** any key or click jumps straight to Home.
- **Server not up yet:** the intro plays while the server connects. If the server has not answered by 3.0s, the lockup holds with a thin progress line. If it is offline, the intro ends in the offline state (P9a) and carries on into Home once the server answers.
- **Fallbacks:** with Reduce motion or Effects Reduced, a 300ms fade of the flat lockup. Without WebGL, the SVG lockup with the same letter reveal.
- **One orb:** the intro's canvas lays its particles exactly on Home's orb (same sphere maths as `orb/model.ts`, sized from the slot's rect). It then fades out over the lazily loaded `EmptyOrb`, which takes over, so only one orb is ever seen.
- **Code:** `design/intro/` holds the timeline (pure, table-tested), the scene and the overlay. `three` stays in the orb's lazy chunk.

**Loading states (P9a).**
- **Offline at start** (the Neon `Splash`):
  - the dimmed lockup, with the progress line turning red
  - `SERVER OFFLINE · 127.0.0.1:7070` and one sentence: it connects by itself once the server runs
  - **Retry now**, the start command as a chip, and `RETRYING IN 4s · ATTEMPT 3`
  - retries back off: 1s, 2s, 4s… up to 15s (today it is a flat 3s)
- **Reconnecting during use:** the page stays and keeps its last data.
  - After 2s without the server, a warn strip shows at the top: `RECONNECTING · 12s` and `ACTIONS PAUSED`. Shorter blips show nothing.
  - Buttons that change things are disabled, with a tooltip saying why; reading still works. A `useServerUp()` hook drives this, and the shared write buttons read it.
  - The orb turns warn-coloured and "thinks" (`THINKING · RECONNECTING`).
  - When the server is back, the strip turns green for 2s (`CONNECTED`), the data refreshes, and the strip goes away.
- **Flat** gets the same strip and back-off in its own plain style, with no orb.

**Orb carried across (P9c).**
- From Home's orb, **Configure** opens Workspaces when there is no workspace.
- The orb travels to the Workspaces hero (`No workspace yet`, `+ Add workspace`, `← Home`) while the two pages slide across each other in about 0.9s. The nav diamond moves with them.
- **How:** one View Transition with `view-transition-name: orb` on both slots, so no second WebGL scene is needed.
- **Later:** the design's morph into three small orbs, which is shader work, waits for the P5a mini-orb variants.
- With Reduce motion, it is a plain page change.

| PR | What | Done when |
|---|---|---|
| P9a | Offline splash (Neon) with back-off, countdown, Retry now; reconnecting strip in both styles; write buttons paused; orb warn state | Stopping the server shows the strip after 2s and pauses writes; starting it shows Connected, then the strip goes away (tests with fake timers) |
| P9b | Launch intro, ending in the launcher Home with the one orb; skip, once per session, fallbacks | Plays once on cold start in Neon Full; any key skips it; Reduce motion gives the fade; no WebGL gives the SVG lockup; Flat never shows it |
| P9c | Home → Workspaces with the orb carried across (View Transition) | The orb moves between the two slots; Reduce motion gives a plain page change |

## 9. Open questions (as first asked)

1. **Replace or add:** this plan refines the existing Neon style (the brief's default). Confirm, or should it be a third style next to Flat and today's Neon?
2. **Nav group names:** keep the app's real groups in the Neon look (proposed), or rename the nav to the mockup's five groups (Overview, Run locally, Data, Automate, System) for both styles?
3. **Your name for the greeting:** a *Your name* field in Settings (proposed, empty = no name), or the Windows account's name?
4. **Effects default:** follow the style (Flat Off, Neon Full; proposed), or keep the neon-look plan's Off for everyone (then the orb shows only after turning Effects on)?
5. **Primary button colour:** solid white as in the mockups (proposed), or the theme's primary (today's Neon)?
