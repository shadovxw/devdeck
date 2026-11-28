# Projects ring: changes

## 2026-11-28: R1, the ring (panorama, tall cards)

- **`design/ring/ring-math.ts`** (table-tested): the panorama's geometry.
  - **Slots:** items under 10 show twice, half a turn apart (two items get three rounds), so the ring closes. Copies of one item are never in view together; the tests prove this for 3 to 9 items.
  - **Radius:** the slots side by side make the circumference, never closer than 1.6 cards.
  - **Turning:** the angle of each slot, the slot ahead, snapping with momentum, and the short way round to a slot.
  - **Visibility:** a card is seen within ±78°, at full strength within ±50°.
- **`design/ring/ring-controller.ts`:** the moving parts, outside React.
  - It writes each card's transform straight to the DOM (`rotateY(-angle) translateZ(-radius)`) and tells React only when the card ahead changes.
  - It handles the drag with momentum, sideways wheel, easing to a card, and a slow drift.
  - The animation frame stops whenever the ring is still or the tab is hidden.
  - Cards beside and behind the viewer are `visibility: hidden`, `inert` and `aria-hidden`.
- **`design/ring/ProjectRing.tsx`:** the component.
  - The stage sits at the camera (`translateZ(radius)`, with the perspective equal to the radius), so the viewer is inside the ring and the card ahead shows at its own size.
  - The card ahead opens on click or Enter; any other card turns to the front first. ←/→ turn the ring and the focus follows.
  - A live region says which project is ahead ("acme, 1 of 5"). The section is a `region` with `aria-roledescription="carousel"`.
  - Card sizes come from the container's width: 220 to 300 px on a desktop, 60% of the width on a phone. The page never scrolls sideways.
- **Motion** (`ringMotion` in `pages/workspaces/WorkspaceCards.tsx`):
  - Effects Full: drift and momentum.
  - Effects Reduced: no drift, short momentum.
  - Effects Off, devdeck's Reduce motion, or the OS asking for reduced motion: still, so the ring jumps card to card.
- **The Projects page:** the grid and the New project tile are gone. The cards are today's project cards, unchanged but full height in a tall slot, with a 5-line description. New project stays in the page header.
- **Styles** (`pieces.css`, from tokens): a grab cursor, no hover lift inside the ring, and a glow on the card ahead only at Effects Full.

Checked: typecheck, lint, and 905+ web tests:
- the ring math
- the component: click to bring ahead and open, arrows and focus, hidden cards, a single card, sizes
- the page: the ring and the two-click open
- `ringMotion`

In the browser, with 5 projects (three scratch copies of the demo, removed afterwards):
- The panorama looked like the reference: the card ahead, the side cards large and slanted.
- Drift, drag-to-snap, the arrows (with the focus following) and the live region all worked.
- At 375 px the front card fits with no sideways scroll.
- Not checked: the light theme (the ring only uses tokens) and the Reduced and Off motion levels by eye (covered by tests).
