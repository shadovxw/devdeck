# devdeck: Frontend Design System ("Paper")

> 2026-10-31 · owner: Vrishank Warrier · expands §7 of [`00-implementation-plan.md`](00-implementation-plan.md)
> Replaces the 2026-10-17 "Quiet Instrument" system. Reference mockup: board **F · Black and white** on the design canvas (Home page).
> Scope: **light theme only**. The dark theme will be rebuilt from these rules later (§12).

---

## 1. Direction

**Paper.** devdeck is open all day, so it should feel like a clean sheet. The page is white, the UI is black and grey, and there are no boxes, no borders, no rounded corners and no decoration. Two colours earn their place:

- **Status dots** (green, amber, orange, red) are the only colours that mean health.
- **One blue** (`#0b3d91`) means "do this" or "go there": the primary button, links and the focus ring.

Everything else is greyscale, so a red dot on a quiet page is impossible to miss.

### Principles

| # | Principle | In practice |
|---|---|---|
| P1 | **White page, no boxes** | Every section sits directly on `--bg` (#ffffff). No card fills, no borders, no row dividers. Sections are separated by space: 48 px vertically, 56 px side by side. |
| P2 | **Square** | Radius 0 on everything: buttons, inputs, rows, toasts, menus, the logo tile. The only round things are status dots. |
| P3 | **Flat, except what floats** | Nothing on the page has a shadow. A toast, menu, command palette, side sheet or tooltip gets `--shadow-float`. A shadow always means "above the page". |
| P4 | **Greyscale by default** | Text, controls, charts, tabs and selection are black/grey. Colour appears only for status (dots) and action (blue). |
| P5 | **Black = selected, blue = action** | The selected tab, the active nav item and the selected row use black. The primary button, links and focus use blue. They never swap. |
| P6 | **Problems first** | A page opens with its title and a one-line status summary. Anything broken is pinned at the top as its own row with one action. |
| P7 | **Minimal text** | Titles are one or two words. No greetings, helper sentences or subtitles. Explanations go in tooltips; long text lives on detail pages. |
| P8 | **Keyboard first** | Every action is reachable from the keyboard and the command palette (Ctrl+K). Focus is always visible. |

---

## 2. Colour

Defined once as CSS variables in `web/src/design/tokens.css`. Tailwind reads them through `@theme`, and ECharts reads them at runtime.

### 2.1 Ground and controls

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | The page. The only surface. |
| `--fill` | `#f3f3f3` | Resting fill for controls: secondary buttons, inputs, the active nav item. Never a section background. |
| `--fill-hover` | `#ebebeb` | Hover on anything with `--fill`. |
| `--fill-press` | `#e2e2e2` | Pressed. |
| `--inset` | `#fafafa` | Background of a problem row (§6.6). Nothing else. |
| `--surface-float` | `#ffffff` | Floating layers only (toast, menu, palette, sheet, tooltip), always with `--shadow-float`. |
| `--scrim` | `rgba(10,10,10,0.18)` | Behind a side sheet or the command palette. |
| `--hairline` | `0` | Border width. Zero on purpose; kept as a token so nobody adds one. |

### 2.2 Text

| Token | Value | Contrast on white | Use |
|---|---|---|---|
| `--ink` | `#0a0a0a` | 19.8:1 | Content, titles, numbers, service names, status words, selected tab. |
| `--ink-2` | `#3d3d3d` | 11.0:1 | Secondary text, nav labels, values, log service column. |
| `--ink-3` | `#666666` | 5.7:1 (5.2:1 on fill) | Muted: mono labels, ports, timestamps, placeholders, unselected tabs. The lightest text allowed. |

### 2.3 Action

| Token | Value | Use |
|---|---|---|
| `--primary` | `#0b3d91` | Primary button fill (white text, 10.0:1). One per page, top-right. Also the action button in a problem row. |
| `--primary-hover` | `#082f70` | Hover and pressed. |
| `--on-primary` | `#ffffff` | Text and icons on primary. |
| `--link` | `#0b3d91` | Links and text actions ("Open logs", `engine.go:198`, the toast's "Restart"). |
| `--focus` | `#0b3d91` | Focus ring: 2 px outline, 2 px offset, on every interactive element. With no borders anywhere, it's the only outline people see. Never remove it. |
| `--selected` | `#0a0a0a` | Selected tab underline, active nav icon, selected row marker. |

### 2.4 Status

Status is always **a round dot + a word in `--ink`**: the dot carries the colour, and the text stays black.

| Token | Value | Dot means | Notes |
|---|---|---|---|
| `--good` | `#13892f` | running, passed, healthy | 4.4:1 on white |
| `--warning` | `#b77f00` | idle, slow, pending | 3.5:1; never use as text |
| `--serious` | `#c4562b` | restarting, flaky | 4.5:1 |
| `--critical` | `#c62f2f` | crashed, failed, blocked | 5.5:1 |
| `--neutral` | `#8a8a8a` | stopped, skipped | Drawn as an **empty ring**, not a filled dot |

All dots pass the 3:1 minimum for non-text graphics. The word next to the dot is what carries the meaning, for colour-blind users and screen readers alike.

### 2.5 Status strip (60-minute timeline)

| Token | Value | Cell means |
|---|---|---|
| `--strip-ok` | `#e2e2e2` | Healthy minute |
| `--strip-idle` | `#a3a3a3` | Idle or slow minute |
| `--strip-off` | `#f3f3f3` | Stopped, no data |
| `--strip-bad` | `#0a0a0a` | Crashed or failing minute (black, not red, so the strip stays greyscale) |

### 2.6 Charts

Charts are greyscale, so the page keeps one accent.

- A single series uses `--ink` (2 px line, no fill or a 6% fill).
- Two or three series use `--ink`, `--ink-3` and `--strip-idle`, with **direct labels** at the line ends (no colour legend needed).
- Error and failure series are allowed to use `--critical`, because that's status.
- More than three series: fold into "Other" or split into small multiples.
- Every chart has a **Table** toggle.

### 2.7 Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-float` | `0 10px 30px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)` | Toast, menu, command palette, side sheet, tooltip. Nothing on the page. |

---

## 3. Typography

One family pair, hosted via `@fontsource-variable` (already installed): **Geist** for UI and numbers, **Geist Mono** for anything machine-like.

| Style | Face | Size / line | Weight | Use |
|---|---|---|---|---|
| `page-title` | Geist | 30 / 34, −0.025em | 600 | One per page ("Home"). |
| `metric` | Geist | 32 / 34, −0.03em | 600 | Big numbers. Always `tabular-nums`. |
| `section-title` | Geist | 14 / 20 | 600 | Section headings ("Stack", "Live logs"). |
| `body` | Geist | 13 / 18 | 400 | Default UI text. |
| `strong` | Geist | 13 / 18 | 500 | Button labels, tabs, active nav, names in sentences. |
| `small` | Geist | 12 / 16 | 400 | Secondary links. |
| `data` | Geist Mono | 12 / 18 | 400 | Service names, ports, paths, tags, log lines, table numbers. |
| `label` | Geist Mono | 11 / 14, +0.06em, UPPERCASE | 400 | Column heads, metric names, nav groups. Always `--ink-3`. |
| `caption` | Geist Mono | 11 / 14 | 400 | Timestamps, deltas, keyboard hints. |

---

## 4. Space, size, radius

- **Spacing** on a 4 px base: 4 · 8 · 12 · 16 · 20 · 24 · 28 · 48 · 56.
- **Section gaps:** 48 px between rows of sections and 56 px between side-by-side sections. These gaps **are** the separators: never replace them with a line.
- **Page padding:** 24 px top, 28 px sides (16 px under 640 px).
- **Controls:** buttons, inputs, icon buttons and nav items are 34 px tall. Tabs are 28 px. Small row actions are 28 px.
- **Radius:** `--radius: 0` everywhere. Status dots are circles (`50%`). Nothing else is round.
- **Elevation:** two levels only. Level 0 (the page) has no shadow. Level 1 (floating) uses `--surface-float` + `--shadow-float`.

---

## 5. Layout and shell

```
┌──────────────┬─────────────────────────────────────────────────────────┐
│ devdeck      │ acme / full ▾                                           │
│              │                                                         │
│ ▣ Home       │ Home                              [Stop all] [Restart ▶] │
│ Workspaces   │ ● 12 of 14 running   ● 2 need attention   up 3h 14m     │
│ RUN          │                                                         │
│ Stacks       │ Stack  full · 14          List  Map    Now               │
│ Logs         │ ● worker  crashed 2m   engine.go:198 [Restart]  REQUESTS │
│ Hosts        │ ● auth    restart 3/5  auth.log      [View]     142      │
│ CODE         │ ● demo-api :8080 ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮ 12%          ERRORS 7 │
│ Repos        │ ● postgres :5432 ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮  6%          CPU 34%  │
│ Images       │                                                         │
│ Databases    │ Live logs  All Errors Warnings  Open logs   Activity     │
│ PLATFORM     │ ● 21:42:07 worker panic: nil map write       ● worker…   │
│ …            │                                                         │
│ Settings     │                                        [toast ▸]        │
└──────────────┴─────────────────────────────────────────────────────────┘
```

- **Sidebar:** 216 px on `--bg`, with no divider. It holds the logo, then nav groups (Run, Code, Platform) with `label` headings and Settings pinned at the bottom. The active item is a `--fill` block with an `--ink` label (weight 500) and an `--ink` icon. It collapses to a 64 px icon rail under 960 px.
- **Top bar:** 56 px, **breadcrumb only** (workspace / stack ▾). There are no visible search, bell or theme buttons:
  - **Search** is the command palette on Ctrl+K. A "Search Ctrl K" item can sit at the top of the sidebar if discoverability needs it.
  - **Notifications** are a sidebar item with a count, plus toasts and the Activity list.
  - **Theme** moves to Settings.
- **Page header:** `page-title`, then one summary line (dots + words + a mono uptime), with actions on the right (secondary on `--fill`, one primary in blue).
- **Sections** flow in a wrapping row: a wide one (flex 2, min 560 px) beside a narrow one (flex 1, min 300 px).
- **Side sheet:** detail (service, log line, finding) opens on the right as a floating layer over `--scrim`. Esc closes it, and the URL updates.
- **Breakpoints:** ≥1280 full · 960–1279 narrower sections · 640–959 sections stack and the sidebar becomes a rail · <640 single column, 16 px padding.

---

## 6. Components

All components use only the tokens above. shadcn components are re-skinned to radius 0, no border and no shadow.

### 6.1 Button
- **Primary:** `--primary` fill, white text, 34 px tall, padding 0 14 px, `strong`. One per page.
- **Secondary:** `--fill` → `--fill-hover` → `--fill-press`, `--ink` text.
- **Link button:** no fill, `--link` text, weight 500–600. Used for inline actions ("Restart" in a toast).
- **Icon button:** a 34 px square on `--fill` with an `aria-label`.
- Icon first (14 px), 8 px gap. Labels are a verb + noun ("Restart failed").

### 6.2 Tabs (view and filter switches)
- Text only, with no fill. 20 px between tabs.
- Unselected: `--ink-3`. Selected: `--ink` with a **2 px `--selected` underline** (black, not blue).
- Counts go inside the label ("Errors 7"). Uses `aria-pressed` or the tab role.
- Examples: List / Map on the stack; All / Errors / Warnings on logs.

### 6.3 Input
- `--fill` background, no border, radius 0, 34 px tall. Placeholder in `--ink-3`.
- Label above in `label` style. Machine values (tags, paths) in `data`.
- Focus: a 2 px blue ring.

### 6.4 Nav item
- 34 px tall, 10 px padding, 16 px icon in `--ink-3`, label in `--ink-2`.
- Active: `--fill` block, `--ink` label and icon, `aria-current="page"`.

### 6.5 Status dot
- An 8 px circle in the status colour followed by the word in `--ink` `body` ("running", "crashed"). Stopped is an empty `--neutral` ring.
- 6 px inside dense rows and the log stream.
- A dot is never shown alone without text unless it has an `aria-label`.

### 6.6 Problem row
- Full width, `--inset` background, padding 12 × 14 px.
- Contains: the status dot, the service name (`data` 13 px, 500), the state in `--ink-2`, the error location as a **link** (`engine.go:198`, opening the log at that line), and one **primary** action button (Restart / View logs).
- Problem rows always come first in their section.

### 6.7 Timeline row
- A 5-column grid: dot · name (`data`) · port (`caption`) · a 60-minute strip of 40 cells · value (CPU or state).
- Rows separate by 5 px padding, with no dividers. A `label` header row names the columns ("60 MIN AGO … NOW").
- The strip is decorative (`aria-hidden`). The value at the end of the row carries the meaning. Clicking a row opens the side sheet.

### 6.8 Metric
- A `label` (REQUESTS), the number in `metric` with its unit in `--ink-3`, one `caption` line (a delta or breakdown), and a 120 × 34 sparkline on the right.
- Sparkline colour: `--ink` by default, `--critical` for errors, `--ink-3` for neutral load.
- Metrics stack with space, not dividers. Every number links to its source.

### 6.9 Log stream
- **On the white page, with no panel.** Uses `data` type with 4 px row padding.
- Columns: 6 px dot · time (`--ink-3`) · service (`--ink-2`, click to filter) · message (`--ink`, ellipsised).
- Level filters are tabs above it, with an "Open logs" link at the end of the tab row.
- The newest line is at the bottom, with auto-scroll unless the reader has scrolled up. Virtualized beyond 200 lines.

### 6.10 Activity list
- Rows of: dot · sentence with a bold name ("**worker** crashed") · mono detail · relative time on the right. 9 px padding, no dividers.

### 6.11 Toast
- `--surface-float` + `--shadow-float`, radius 0. Bottom-right, up to 3 stacked.
- Contains: dot · one sentence · at most one mono detail · one **link button** action ("Restart").
- Auto-dismisses after 6 s unless critical. Enters in 180 ms.

### 6.12 Floating layers (menu, command palette, side sheet, tooltip)
- Same recipe as the toast. The command palette and side sheet add `--scrim`.
- The command palette sits near the top centre and groups results (entities, then actions, recent first). Every page action is also a palette command.

---

## 7. Interaction and motion

- **Hover:** the fill darkens one step. **Press:** two steps. Nothing lifts, scales or moves.
- **Focus:** a 2 px blue ring with 2 px offset (`:focus-visible`).
- **Selected:** black (tab underline, nav fill).
- **Motion tokens** (unchanged from the old system):

| Token | Duration | Use |
|---|---|---|
| `instant` | 100 ms ease-out | hover, press, toggle |
| `quick` | 180 ms ease-out | tab change, toast in |
| `move` | spring ≈ 320 ms | list reorder, sheet open, layout |
| `scene` | 700 ms | route changes between sections (rare) |

- Numbers count up only on first load. Live values ease and never jump.
- `prefers-reduced-motion` or performance mode turns every transition into an instant cut.

---

## 8. Iconography

- Lucide, 16 px (14 px in buttons), stroke 1.75, **square line caps and mitred joins** to match the square system.
- Colours: `--ink-3` at rest, `--ink-2` in buttons, `--ink` when active, white on primary.
- No icon-background chrome and no coloured icons. Colour belongs to status dots.

---

## 9. Logo in the UI

- The sidebar uses a **monochrome lockup**: a black square tile with a white `>_` prompt, plus "devdeck" in Geist Bold `--ink`.
- The full-colour gradient mark (`brand/`) stays for the app icon, the installer, the README and splash screens.
- To do: add a `brand/logo-mark-mono.svg` so the sidebar uses a real file instead of hand-drawn markup (§13).

---

## 10. Libraries

| Need | Choice | Notes |
|---|---|---|
| Primitives | shadcn on `radix-ui` (installed) | Re-skin: radius 0, no border, no shadow except floating layers. Add: dialog, dropdown-menu, popover, tabs, select, switch, skeleton, scroll-area, context-menu, hover-card, kbd, resizable. |
| Command palette | `cmdk` (shadcn Command) | Ctrl+K, replaces the visible search box. |
| Toasts | `sonner` (shadcn Sonner) | Restyle to §6.11. |
| Tables and long lists | `@tanstack/react-table` + `@tanstack/react-virtual` | Logs and services beyond 200 rows. |
| Charts | `echarts` (import from `echarts/core`) | Greyscale theme built from tokens at runtime (§2.6). |
| Code / YAML / SQL | CodeMirror 6 (`@uiw/react-codemirror`) | Stack editor, SQL. Lighter than Monaco. |
| Graphs (flows, service map 2D) | `@xyflow/react` | Behind the "Map" tab. |
| Shortcuts | `react-hotkeys-hook` | |
| Forms | `react-hook-form` + `zod` | Connections, Settings, Hosts. |
| Animation | `motion` (installed) + `tw-animate-css` (installed) | **GSAP dropped.** Motion covers the boot sequence. |
| 3D | React Three Fiber | **Deferred.** Lazy-load only inside the Map view if it's ever built. It no longer sits behind every route. |

---

## 11. Accessibility checklist

- All text is ≥4.5:1 on its background (`--ink-3` is the floor: 5.7:1 on white, 5.2:1 on fill).
- Status dots are ≥3:1 and always paired with a word.
- Every interactive element is a real `<button>`, `<a>` or `<input>`, with a visible blue focus ring.
- Icon-only buttons have `aria-label`. Decorative SVGs (strips, sparklines) are `aria-hidden`.
- Every chart has a Table view. Every animated element has a static equivalent.
- Touch targets are ≥28 px tall in dense rows and 34 px for primary controls.

---

## 12. Dark theme (later)

Not designed yet. When it is, it should keep the same rules: one surface, no borders, square corners, greyscale UI, status dots as the only health colours and one blue for action (lighter, around `#7aa7ff`, for contrast on dark). Until then, the app ships light only and the theme switch in Settings stays disabled.

---

## 13. Implementation steps

1. **Tokens.** Replace the light block in `web/src/design/tokens.css` with §2 and keep the existing variable names where they map, so current components keep working:

```css
:root[data-theme="light"], :root {
  --bg: #ffffff;
  --surface-1: #ffffff;        /* cards no longer differ from the page */
  --surface-2: #ffffff;        /* floating layers */
  --fill: #f3f3f3;
  --fill-hover: #ebebeb;
  --fill-press: #e2e2e2;
  --surface-inset: #fafafa;    /* problem rows only */
  --line: transparent;         /* no borders */
  --line-strong: transparent;
  --ink: #0a0a0a;
  --ink-2: #3d3d3d;
  --ink-3: #666666;
  --accent: #0b3d91;           /* primary, links, focus */
  --accent-hover: #082f70;
  --accent-soft: rgba(11, 61, 145, 0.08);
  --on-accent: #ffffff;
  --selected: #0a0a0a;
  --scrim: rgba(10, 10, 10, 0.18);
  --good: #13892f;
  --warning: #b77f00;
  --serious: #c4562b;
  --critical: #c62f2f;
  --neutral: #8a8a8a;
  --strip-ok: #e2e2e2;
  --strip-idle: #a3a3a3;
  --strip-off: #f3f3f3;
  --strip-bad: #0a0a0a;
  --shadow-float: 0 10px 30px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.08);
  --radius: 0px;
  --sidebar: #ffffff;
  --sidebar-foreground: #3d3d3d;
  --sidebar-primary: #0a0a0a;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #f3f3f3;
  --sidebar-accent-foreground: #0a0a0a;
  --sidebar-border: transparent;
  --sidebar-ring: #0b3d91;
  color-scheme: light;
}
```

2. **Radius and borders.** Set every shadcn `rounded-*` to `rounded-none` (or `--radius: 0`) and remove `border` classes from cards and containers. Keep the `index.css` focus-ring rule using `--accent`.
3. **Shell.** Remove the search, bell and theme buttons from the top bar, wire Ctrl+K to `cmdk`, and move theme to Settings.
4. **Status.** Replace the shape marks (`StatusMark`, `ServiceStateMark`, `LevelMark`) with the round dot + word, with stopped as a ring.
5. **Tabs.** Replace pill/chip filters with underline tabs (§6.2).
6. **Home.** Rebuild it as: header → Stack (problem rows + timeline rows) | Now (metrics) → Live logs | Activity.
7. **Charts.** Build an ECharts greyscale theme from the tokens.
8. **Brand.** Add `brand/logo-mark-mono.svg`.
9. **Clean-up.** Archive `ui-design/` (the Quiet Instrument reference) and point the CLAUDE.md "UI" section at this document and the board F mockup.

---

## 14. What changed from "Quiet Instrument"

| Before | Now |
|---|---|
| Graphite dark-first, cyan accent | White, greyscale, one blue |
| Cards separated by surface tone | No cards: sections separated by space |
| Radii 3 / 4 / 6 px | 0 everywhere; status dots round |
| Status shapes (● ▲ ◆ ■ ○) | Round dot + black word; stopped = ring |
| Cyan primary button | Navy-cobalt `#0b3d91` primary; links and focus share it |
| Pill chips | Underline tabs, black underline |
| Status strip on top bar, search box, bell, theme toggle | Breadcrumb only; Ctrl+K palette; theme in Settings |
| 3D hero behind every route, GSAP stories | No 3D on Home; Map view later; GSAP dropped |
| Log panel in a tinted well | Log lines directly on white |

## 15. Open questions

1. Is the problem-row background (`--inset`, `#fafafa`) worth keeping, or should problem rows be pure white with only the dot and button?
2. Should a "Search Ctrl K" item appear at the top of the sidebar, or should it stay keyboard-only?
3. When will the dark theme be designed, before or after the Home rebuild?
