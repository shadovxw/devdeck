# devdeck: Frontend Design System ("Quiet Instrument")

> 2026-10-17 · owner: Vrishank Warrier · expands §7 of [`00-implementation-plan.md`](00-implementation-plan.md)
> Live reference: [`ui-design/index.html`](../ui-design/index.html), the Home page built with this system (3D hero, cards, table, charts, palette, side sheet, toasts, light/dark).

---

## 1. Direction

**Quiet Instrument**: an instrument bench for your codebase. Calm, graphite surfaces lit softly from above. One physical-feeling 3D object (your running services) sits at the centre of attention. Everything else is precise, flat-ish and quiet, so the moments of depth and motion carry meaning.

It blends the two earlier moodboard options: **B. Soft depth** (layers, soft light, rounded 3D objects) with the precision of **C. Blueprint** (hairlines, grid, monospace data). **A. Holo HUD** is dropped: it's too loud for something open all day.

**From the subject's world**: colours follow the **flight-deck display convention** pilots use (cyan = something you can act on, green = normal, amber = caution, red = warning). A devdeck user learns it once and reads every screen the same way.

### Principles

| # | Principle | In practice |
|---|---|---|
| P1 | **Calm by default** | No motion or colour unless something changed or needs you. Idle screens are still. |
| P2 | **Depth means something** | 3D only where space carries information (service map, ER diagram, flow graph). Elevation marks what floats above the page (menus, sheets), never decoration. |
| P3 | **Summary → detail** | Every page opens with what needs attention, then the detail. Every number is a link to where it came from. |
| P4 | **Speed over spectacle** | Frequent actions are instant (≤ 120 ms). Big scene moves happen at most once per visit and are skippable. |
| P5 | **One place for everything** | The same thing is always in the same place: page actions top-right, status in the left column of a table, the command palette on Ctrl+K. |
| P6 | **Keyboard first** | Everything reachable by keyboard; palette commands for every action; visible focus. |
| P7 | **Everything has a 2D twin** | Every 3D or animated visual has a plain equivalent (list/table) for performance mode, reduced motion and accessibility. |

---

## 2. Tokens

Defined once as CSS variables (dark is the default theme, light is complete and equal). Tailwind v4 reads them through `@theme`. ECharts and three.js read them at runtime, so all three share one source.

### 2.1 Colour

| Token | Dark | Light | Use |
|---|---|---|---|
| `--bg` | `#0c1012` | `#eef2f3` | page plane |
| `--surface-1` | `#12181b` | `#fbfcfc` | cards, table body |
| `--surface-2` | `#182024` | `#ffffff` | raised: hover, menus, sheets, palette |
| `--surface-inset` | `#090c0e` | `#e4eaec` | inputs, code, chart wells |
| `--line` | `rgba(170,215,225,.09)` | `rgba(12,40,48,.10)` | hairlines, card borders |
| `--line-strong` | `rgba(170,215,225,.18)` | `rgba(12,40,48,.20)` | dividers, axis |
| `--ink` | `#e6edef` | `#0d1517` | primary text |
| `--ink-2` | `#a7b4b8` | `#3d4b50` | secondary text |
| `--ink-3` | `#72828a` | `#66767c` | muted, captions, axis labels |
| `--accent` | `#53d3e6` | `#0a7c8f` | **cyan = actionable**: links, primary buttons, focus, selection, single-series charts |
| `--accent-soft` | `rgba(83,211,230,.14)` | `rgba(10,124,143,.10)` | selected rows, active nav, chips |
| `--on-accent` | `#04252b` | `#ffffff` | text on accent fills |

**Status (fixed in both themes, never used as an accent; always paired with an icon + label):**

| Role | Hex | Icon | Meaning in devdeck |
|---|---|---|---|
| good | `#0ca30c` | ● filled dot | running, passed, healthy |
| warning | `#fab219` | ▲ triangle | degraded, idle, pending, slow |
| serious | `#ec835a` | ◆ diamond | restarting, flaky, needs attention soon |
| critical | `#d03b3b` | ■ square | crashed, failed, blocked |
| neutral | `--ink-3` | ○ ring | stopped, skipped |

**Chart series (validated):** up to 3 series use blue/orange/aqua (dark `#3987e5 #d95926 #199e70`, light `#2a78d6 #eb6834 #1baf7a`). These pass every colour-blindness and contrast check on devdeck's surfaces. Light-mode aqua sits below 3:1, so charts using it always show direct labels or a legend plus the table view. More than 3 series: fold into "Other" or split into small multiples. A single series always uses `--accent`.

### 2.2 Typography

**Decided 2026-10-17: one sans family, no serif, no greeting.**

| Role | Face | Use |
|---|---|---|
| UI, titles, numbers | **Geist** (400/500/600/700) | everything, including big KPI numbers |
| Data / code | **Geist Mono** | service names, tags, ports, paths, logs, SQL, table numbers |

Scale (px / line-height): 11/14 label · 12/16 caption · 13/18 small · 14/20 body and card titles · 24 KPI unit · 40/44 KPI number. All number columns use `tabular-nums`.

### 2.2a Text budget (dashboard rule)

A dashboard is read in seconds, so **text is the exception**:
- Card titles are **one or two words** ("Services", "CPU", "Findings"). No eyebrow labels, no subtitles, no card footers.
- Show **numbers and status icons**. The explanation goes in a **tooltip** (`title`), the side sheet, or the detail page.
- No greetings, no summary sentences, no helper text ("drag to look around"). Controls are icons with tooltips unless the action is the page's primary one ("Run checks").
- Toasts are one line ("ticket crashed"), plus at most one detail (`engine.go:198`) and one action.
- Long text belongs on detail pages (logs, findings, work items), never on Home.

### 2.3 Space, radius, elevation

- **Spacing** on a 4 px base: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 48. Card padding 16 (compact 12). Page gutter 24 (16 under 640 px).
- **Radius (tight; decided 2026-10-17)**: 3 tags/pills/chips · 4 controls and cards · 6 dock, status strip, palette. Never mix two radii on one card.
- **Flat: no borders, no shadows on cards and containers (decided 2026-10-17).** Things are separated by **surface tone only**: page `--bg` → card `--surface-1` → control `--fill`. Hairlines remain only *inside* content as row dividers (table rows, list items).

| Level | Recipe | Used for |
|---|---|---|
| e0 | `--bg` | page |
| e1 | `--surface-1`, no border, no shadow | cards, tables, dock, status strip |
| e2 | `--fill` / `--fill-hover` | buttons, chips, inputs, segmented controls, cells |
| e3 | `--surface-2` on a scrim | side sheet, command palette |
| float | `--surface-2` + one soft shadow, no border | toasts, hover cards, chart tooltips (the only shadows: they float over cards and would otherwise merge into them) |

New tokens: `--fill` (dark `#1f292d`, light `#e4eaec`) and `--fill-hover` (dark `#273338`, light `#d8e1e4`). Dark `--surface-1` lifts to `#151c20` and light `--bg` drops to `#e8edef`, keeping enough tonal separation without borders.

### 2.4 Motion

| Token | Duration / curve | Use |
|---|---|---|
| `instant` | 100 ms, ease-out | hover, press, toggle |
| `quick` | 180 ms, ease-out | chip/filter changes, toasts in |
| `move` | spring (stiffness 300, damping 30) ≈ 320 ms | list reorder, card → sheet, layout |
| `scene` | 700 ms, `cubic-bezier(.65,0,.35,1)` | camera moves, route changes between sections |
| `story` | 1.5–3 s GSAP timeline, skippable | stack boot sequence, first-visit intro |

Rules: motion explains *where something came from or went*. Numbers count up only on first load. Live data eases (never jumps) at 300–600 ms. `prefers-reduced-motion` or performance mode → all `scene`/`story` motion becomes an instant cut, and ambient 3D drift stops.

---

## 3. Layout and shell

```
┌──┬──────────────────────────────────────────────────────────────┐
│  │ status strip: workspace ▾ · stack ● 12/14 · errors 7 · CPU RAM │ ⌘K │ theme │
│D ├──────────────────────────────────────────────────────────────┤
│O │ page header: eyebrow / title (serif) / summary · actions →    │
│C │ hero (3D or summary) — sized to content, never 100vh          │
│K │ 12-col grid of cards: summary row → working area → detail     │
│  │                                                       side sheet ⟶ │
└──┴──────────────────────────────────────────────────────────────┘
```

- **Dock**: a 64 px icon rail. Tooltips show labels; an expanded mode is 220 px with labels. The active item has a cyan light bar. Groups match the sitemap (Code, Run, Data, Pipelines, Platform).
- **Status strip**: always visible. Click any part to jump (the stack → Stacks, errors → Logs filtered to errors).
- **Side sheet**: detail opens on the right without leaving the page (service, row, finding). Esc closes it. The URL updates, so detail views are linkable.
- **Breakpoints**: ≥ 1280 full; 960–1279 grid → 8 columns; 640–959 single column, dock collapses; < 640 (VS Code side panel / narrow window) is a compact list mode: no 3D hero, tables become stacked rows.

---

## 4. Components

### 4.1 Cards

One card family, five variants. Same anatomy everywhere so the eye learns it once.

```
┌──────────────────────────────────────────────┐
│ LABEL (11px caps, ink-3)        [chip] [⋯]  │  header: what this is + one entity chip + menu
│ Value / title                                │  body: the one thing this card says
│ supporting line (ink-2)          sparkline   │
│──────────────────────────────────────────────│  optional footer: freshness ("updated 4 s ago"),
│ updated 4 s ago               View logs →    │  one text action
└──────────────────────────────────────────────┘
```

| Variant | Content | Notes |
|---|---|---|
| **Stat** | label, big number (count-up on first load), delta, sparkline | max 4 in a row; the delta carries an icon + sign, not colour alone |
| **Entity** | service / repo / DB: status pill, name (mono), 2–3 facts, actions on hover | the most common card; clicking opens the side sheet |
| **Chart** | title, timeframe chips, chart, "Table" toggle | see 4.3 |
| **List** | activity, notifications, findings: rows with icon, text, time | max 6 rows, then "View all" |
| **Hero** | the 3D scene (≈ 540–760 px tall, clamp(540px, 68vh, 760px)) with the KPI, status tally and the page actions overlaid | one per page at most |

**States**: rest (e1) → hover (lifts 2 px, tilts ≤ 2° toward the cursor, a faint highlight follows the pointer; no shadow) → pressed (back to rest in 100 ms) → selected (accent-soft fill + 1 px accent border) → loading (skeleton bars with a slow shimmer, keeping the same layout) → error (critical icon + message + Retry, inside the same card frame) → empty (one sentence on what will appear and how to make it appear, plus the action button).

Rules: one radius (4), no border, no shadow, no coloured side bars. Cards separate from the page by tone. Severity shows as a status pill, never as a coloured card.

### 4.2 Tables

```
 ● Status   Service                 Port    CPU        RAM            Errors   Uptime
 ─────────────────────────────────────────────────────────────────────────────────────
 ● Running  infrabot-ticket-service 8083    5%  ▁▂▃▂   180 MB ▬▬▬     5 ↗      1h 12m   [⟳][■][≡]
 ■ Crashed  infrabot-catalog-service 8082   —          —              2        —        [⟳][≡]
```

- **Anatomy**: sticky header (11px caps, ink-3) · hairline row dividers (no zebra stripes) · 40 px rows (compact 32, comfortable 48) · status always in the first column (icon + label pill) · names and numbers in mono · numbers right-aligned with `tabular-nums` · inline micro-visuals (sparkline, meter bar) where a trend or share matters.
- **Interaction**: row hover = surface-2 + row actions fade in at the right · click opens the side sheet · `↑↓` moves, `Enter` opens, `Space` selects · multi-select shows a bulk-action bar that slides up from the bottom · sortable headers with an arrow · column picker and density switch in the table's ⋯ menu.
- **Scale**: virtualized beyond 200 rows (TanStack Table + virtual) · filters as chips above the table, removable · a "no results" row explains which filter emptied it.
- **Live updates**: changed cells flash `accent-soft` for 600 ms. New rows slide in, removed rows fade out (`move`). The sort order never reshuffles under the cursor while hovering.

### 4.3 Charts

| Data | Chart | Library |
|---|---|---|
| Value over time (CPU, error rate) | line / area, 2 px line, area fades to transparent | ECharts |
| Compare items (RAM by service) | horizontal bars, sorted, 4 px rounded end, 2 px gap | ECharts or SVG |
| Share of a whole (disk) | treemap with zoom | ECharts |
| Density over time (log levels) | stacked bars per minute, status colours + legend | ECharts |
| One number vs a limit (CPU now) | ring gauge with label | SVG |
| Trend in a cell | sparkline, last point emphasised | SVG |

Rules (from the dataviz method): one y-axis per chart, never two · faint gridlines, axis labels in ink-3 · single series in `--accent`, up to 3 series in the validated palette, more fold to "Other" · status colours only with icons and labels · crosshair + tooltip on every line/area chart, per-mark tooltip on bars · a legend whenever there are ≥ 2 series · **every chart has a "Table" toggle** (P7) · live charts append points smoothly and keep the y-axis stable (no jumping scales).

### 4.4 Status pill, chips, entity links

- **Status pill**: icon + label, tinted background at 14% of the status colour, label in ink. Never colour alone.
- **Filter chip**: label + ✕, accent-soft when active.
- **Entity link chip**: mono name with a small kind icon (service, repo, db, table, run, finding, work item). Hover for 300 ms shows a **preview card** (status + 3 facts + "Open"). These chips are how "every page is linked" works: any mention of an entity anywhere is one of these chips.

### 4.5 Buttons and inputs

| Kind | Look | Use |
|---|---|---|
| Primary | accent fill, on-accent text | one per view: the main action (Start stack) |
| Secondary | surface-2 + hairline | other actions |
| Ghost | text only, hover wash | toolbars, row actions |
| Danger | critical outline → fill on confirm | stop, delete, migrate on non-local |

Inputs: surface-inset, 1 px line, focus = 2 px accent ring with an offset. Destructive actions confirm **in place** (the button becomes "Confirm stop?" for 3 s); no modal dialog for single actions.

### 4.6 Overlays

- **Command palette (Ctrl+K)**: e3 sheet centred near the top, search across entities and actions, grouped results, keyboard only, recent items first. Every page action is also a palette command.
- **Side sheet**: 420–560 px from the right, `move` spring in, the page behind dims slightly and stays scrollable.
- **Toasts**: bottom-right, stack up to 3, each = status icon + one sentence + one action ("Restart"). Auto-dismiss after 6 s unless critical. Mirrors the Notifications page.

---

## 5. 3D system

| Item | Decision |
|---|---|
| Where 3D is used | Home **service constellation** · Databases **ER map** · Flows **graph** (2.5D) · Stacks **boot sequence**. Nowhere else. |
| Engine | React Three Fiber v9 + drei, one persistent `<Canvas>` behind the routes, scenes swapped per route |
| Look | Soft, matte "instrument" spheres on a dark bench plane with a faint grid. Status shows as an emissive ring and a soft halo. Dependencies are thin arcs; travelling dots show log rate. No chrome, no lens flare. |
| Lighting | 1 key light from top-left, 1 cool rim light, ambient fill. Shadows baked into a soft contact texture, not real-time. |
| Interaction | Hover = node lifts + label · click = camera flies in (`scene`) + side sheet opens · drag = slight orbit (±25°) · double-click empty space = reset view |
| Budget | ≤ 60 draw calls (instancing), ≤ 80k triangles, pixel ratio ≤ 1.5, 30 fps cap for ambient drift, `frameloop="demand"` when nothing moves, **0 frames when hidden or off-screen** |
| Fallback (P7) | Performance mode, reduced motion or no WebGL → the same data as a 2D node list with status pills |

---

## 6. Motion choreography

| Moment | What happens |
|---|---|
| First load | Shell appears instantly. Cards rise 8 px and fade in, staggered 40 ms in reading order (max 400 ms total). Stat numbers count up. The 3D scene fades in and the camera settles from slightly wide. |
| Navigate between pages | Content cross-fades with an 8 px shift (`quick`). If both pages have a 3D scene, the camera moves between them (`scene`). |
| List → detail | The clicked row or card morphs into the side sheet header (shared element, `move`). |
| Live change | Changed numbers ease. Status changes flash the pill once. A crash pulses the node red twice, then holds a steady red halo. |
| Something finishes | A toast slides in. The related card shows the new state, nothing else moves. |

---

## 7. Making it intuitive

- **Information scent**: every label says what you get ("Start full stack", not "Execute"). Counts on tabs and nav ("Findings 3").
- **One way to do each thing**, reachable three ways: button on the page, palette command, keyboard shortcut.
- **Show the next step**: empty and error states always offer the fixing action. A crashed service shows "Restart" and "View last error".
- **Never surprise**: destructive or shared-state actions (push, migrate, cleanup) show exactly what will happen, including the command (plan review G15).
- **Freshness everywhere**: live data shows "updated 4 s ago" or a live dot, so you know whether to trust it.

---

## 8. Accessibility

WCAG 2.2 AA: text contrast ≥ 4.5:1 (body) and ≥ 3:1 (large text, UI marks) · visible focus ring on everything · full keyboard support · `aria-live="polite"` for status changes, rate-limited · status never by colour alone · reduced-motion respected · every chart and 3D view has a table/list twin (P7).

---

## 9. Implementation map

| Piece | How |
|---|---|
| Tokens | `web/src/design/tokens.css` (CSS variables, dark default + light) → Tailwind v4 `@theme` |
| Components | shadcn (Radix/Base UI) copied into `web/src/design/ui/`, restyled from the tokens; nothing keeps the default look |
| Motion | `web/src/design/motion.ts` exporting the 5 tokens as Motion presets + GSAP defaults |
| 3D | `web/src/scene/`: `<SceneRoot>` (persistent canvas), scene registry per route, `useSceneBudget()` (visibility/perf mode) |
| Charts | `web/src/charts/`: ECharts theme built from the tokens at runtime and rebuilt on theme change, plus `<ChartCard>` with the Table toggle |
| Showcase | `/kit` route: every component and state, both themes. Doubles as the visual-regression page for Playwright screenshots. |

---

## 10. Frontend build plan

Replaces Phase 1 in the master plan with 1a + 1b (plan review G8).

**Phase 1a: system and shell (≈ 1–1.5 weeks, before Phase 2)**
- 1a.1 Tokens (colour, type, space, radius, elevation, motion) + the theme switch
- 1a.2 Shell: dock, status strip, page header, grid, side sheet, command palette, toasts
- 1a.3 Kit v1: buttons, inputs, chips, status pill, entity chip + preview card, card family (5 variants), table (with virtualization), skeleton/empty/error states
- 1a.4 Chart kit v1: ECharts theme + line/area, bars, sparkline, ring gauge, Table toggle
- 1a.5 3D: `<SceneRoot>` + budget controller + the Home constellation (from `ui-design/index.html`) + 2D fallback
- 1a.6 `/kit` showcase + Playwright screenshots in both themes
- **Done when**: the Home page from the sample runs on live data, meets the §7.5 performance budget, and the `/kit` page shows every component state in both themes.

**Phase 1b: signature visuals, built with each feature phase**
| With phase | Visual |
|---|---|
| 2 Stacks | boot-sequence wave |
| 3 Logs | brushable level-histogram timeline, error sparks |
| 5 Resources | rings, live CPU area, disk treemap zoom |
| 6 Databases | ER map (2.5D) |
| 7 Flows | animated flow graph, run playback |
| 8 Findings | severity heat grid |
| 9 Images | tag timeline, build capsule |
| 10 Work items | stage track |

---

## 11. Open design decisions

1. **Theme default**: dark first (current) or follow the OS?
2. ~~Display serif~~: decided, all-sans (Geist).
3. **Dock**: icon rail by default, or expanded with labels?
4. **Ambient 3D drift** on Home: keep the slow drift, or fully still until you interact?
