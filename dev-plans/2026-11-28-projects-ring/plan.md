# Projects as a ring (circular carousel)

**Replaced 2026-11-28** by a still fan of cards (`dev-plans/2026-11-28-project-posters`, P4). The ring's code is removed, and with it the "always the ring" decision. What follows is the record of R1.

Status: R1 built 2026-11-28 (see changes.md). Decided since the first draft: always the ring; the **panorama** preset with **tall** cards; written in our own code instead of a port. Source: React Bits "Circular Carousel" (reactbits.dev/components/circular-carousel).

## 0. Decisions after the first draft

- **Panorama, tall** (asked 2026-11-28, with a screenshot of the React Bits demo): the viewer stands inside the ring and the cards stand on its inside wall, facing in. The card ahead is straight in front, and the ones beside it swing in large and slanted at the edges. Cards are 1.45 times taller than wide. This replaces the orbit choice in §2.
- **Flat panels, not bent:** the cards are live DOM, and React Bits bends images by slicing them. Perspective still gives the side cards their slanted look.
- **Written ourselves**, after React Bits (credited in the code), not ported. The panorama needs only angles, a drag, momentum, snapping and a drift: about 300 lines without the image, preset and intro machinery. So no file carries the Commons Clause, and §2's license note no longer applies.
- **Few projects repeat round the ring** so it closes. Under 10 projects each one shows twice, half a turn apart, and the two copies are never in view together. Two projects get three rounds, 60° apart, so the other one sits on both sides of the card ahead.

## 1. What we want

The Projects page (`/workspaces`) shows its project cards on a 3D ring instead of a grid.

- **Drag** the ring with momentum, and it **snaps** to the nearest card.
- **Autoplay** drifts slowly, and pauses on hover.
- The card in front is the focused one. **Click** a card at the back to bring it to the front; **click** the front card to open its project.
- The cards are today's project cards (`WorkspaceCards.tsx`): kicker, state, name, description, shape and the type bar. Nothing on them changes.
- **Changed since:** the cards became posters (`dev-plans/2026-11-28-project-posters`, P3). That replaces "Nothing on them changes" above.
- **New project** stays a separate button next to the ring, not a card on it. A tile spinning past is hard to hit, and the page header already has the action.

## 2. The component

- **Dependencies:** none. It is plain React + CSS: a `requestAnimationFrame` loop, CSS 3D transforms, and pointer, wheel and keyboard events.
- **Built for images:** it takes `items: {src, alt, title, subtitle}[]`.
  - It *bends* a card by cutting it into 8 vertical strips, each showing a slice of the image through `background-position`.
  - That trick doesn't work for DOM content: we would have to render each card 8 times and clip it.
- **So we use it flat:** the `orbit` preset (`billboard: true`, `curve: 0`). Each card is one flat, upright face that always looks at the viewer, on a tilted ring.
  - It is the cheapest of the four presets.
  - It suits the Neon look (cut corners, no bending).
  - `cylinder`, `wheel` and `panorama` are left out.
- **The license is MIT + Commons Clause:**
  - Using it inside devdeck is allowed ("as part of an application").
  - Its copyright notice must stay in the copied file.
  - We may not redistribute or sell the component on its own. devdeck is a public repo, so the file carries the notice, and a `THIRD_PARTY_NOTICES.md` names it.
  - Note: the repo has no `LICENSE` file of its own yet. That is worth settling when this lands (see §7).

## 3. How it fits devdeck

**Port it, trimmed, to TypeScript** as `web/src/design/ring/ProjectRing.tsx` and `ring.css`:
- Keep: the ring math (radius from the card count, wrap, snap), momentum drag, wheel, keyboard, autoplay drift, pause on hover, click-to-focus, reduced motion, and the depth fade.
- Drop:
  - the image items and the default Unsplash photos (no outside hosts)
  - the strip bending and the other presets
  - the intro animations except `rise`
  - the caption digit reels
  - the item swap animation
- Items become `renderItem(item, {active})`, so the ring draws any React node. The Projects page passes today's `Card`.
- Move the pure math (radius, angle of item *i*, nearest index, wrap) into `ring-math.ts`, so it can be tested without a DOM.

**Theme tokens only** (CLAUDE.md):
- `fadeColor: "#000000"` becomes `var(--bg)`, so the depth fade works on Paper and Paper Dark.
- `innerShade` and `cornerRadius` come from tokens (`--radius-*`).
- Glow on the focused card appears only at Effects *Full*, as everywhere else.

**Always the ring** (decided 2026-11-28: no grid, no toggle). The ring adapts instead:
- **Effects *Off*, or the OS asks for reduced motion:** the ring stands still. There is no autoplay, momentum or intro, and drag, arrows and clicks move it one card at a time with no tween.
- **Effects *Reduced*:** no autoplay or intro. Momentum stays short, and snapping is kept.
- **1 or 2 projects:** the ring still shows. One card sits alone in front; two face each other. The radius has a minimum (`along * 0.6` in the original), so it doesn't collapse.
- **Narrow windows (< 768 px):** smaller cards (`cardWidth` from the container's width) and less perspective, so the ring fits with a 16 px gutter and the page never scrolls sideways.
- **No projects:** the page keeps today's empty state (the mini-orb) and its New project action. There is nothing to put on a ring.

**Accessibility:**
- The ring is a `region` with `aria-roledescription="carousel"`, and each card is a button labelled "Project acme, 2 of 5".
- ←/→ move the focus and Enter opens the project. The focus follows the front card.
- A polite live region says which project is in front.
- Cards turned away from the viewer are `aria-hidden` and `inert`, so Tab only reaches the visible ones.

**Performance:**
- The loop runs only while the ring is moving or drifting and the tab is visible (`document.hidden`). It sleeps when the ring is idle.
- Transforms only, no layout in the loop.
- The ring loads lazily with `React.lazy`, so the main bundle doesn't grow (it is already 1.4 MB).

## 4. Steps (one PR each)

| Step | What | Done when |
|---|---|---|
| R1 | Port the ring to TS, trimmed, plus `ring-math.ts` with table tests; the Projects page uses it in place of the grid, which is removed; the still and narrow cases of §3 | The ring spins, snaps, focuses and opens a project; it stands still with Effects off or reduced motion; it fits at 375 px with 1, 2 and 10 projects |
| R2 | Keyboard and screen-reader pass, live region, `inert` back cards | Everything works by keyboard alone; axe shows no new problems |
| R3 | Neon polish: focused card glow (Effects Full), depth fade from tokens, light and dark checked, the `rise` intro once per visit | Both themes look right; the intro doesn't replay on each visit to the page |

## 5. Tests

- **Vitest, `ring-math.test.ts`:** radius for 3, 5 and 12 cards; the angle of each card; the nearest index after a drag of ±0.4 or ±0.6 of a step; wrap-around at 0 and *n*−1.
- **Vitest, page tests:**
  - the ring with 1, 2 and many projects
  - no autoplay with reduced motion or Effects off
  - the empty state with no projects
  - Enter on the front card opens its project
  - clicking a back card focuses it instead of opening it
- **Browser check** on the throwaway server (7071/5183) with the demo projects (copy `acme` to get ≥3):
  - drag, wheel, arrows, autoplay pause and click-to-open
  - Paper and Paper Dark
  - Effects Full, Reduced and Off
  - a 375 px window

## 6. Risks

- **Text on a moving 3D face can blur.** Cards come to rest at whole pixels, and there is no transform on the front card when it's still.
- **Hit targets move.** Autoplay pauses on hover and while focus is in the ring, and click-to-focus means a moving card is never opened by accident.
- **Many projects (20+)** make a huge ring. The radius is capped, and above the cap cards sit closer together and get smaller, so every project stays on the ring. Arrow keys and the live region still reach each one.

## 7. Open questions

1. Which preset: flat `orbit` (recommended, because the cards are DOM content), or try the bent `cylinder` with cards rendered as images? The second costs a canvas snapshot per card and loses live state on the card.
2. ~~Default view~~: decided, always the ring, no grid.
3. Should `acme` get two more demo projects (git-ignored) so the ring has enough cards to look right?
4. devdeck's own license: the repo has no `LICENSE` yet. Pick one before the first third-party file with conditions lands.
