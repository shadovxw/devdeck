# Home: split index (mockup)

**Status:** mockup, waiting for the owner's decision. The app is unchanged.

**Idea.** Replace the orbit on Home with a split page: the large orb partly off the left edge, and the pages as a numbered list on the right (00 Overview, then Work, Run and System). Behind both, the Neon dot grid gains a lens that follows the pointer.

**See it:** open [`mockup.html`](mockup.html) in a browser. The switches (bottom left, not part of the design) change the theme and the dots.

**If approved:**
- This replaces §8c of [the look plan](../2026-11-21-portfolio-look/plan.md); update it in the same PR.
- Home keeps its one WebGL orb. The dots are our own Canvas 2D layer, so there is no second WebGL context (decision 10 there: one renderer per page; reword it to say so).
- Dots follow Effects: Full has the lens, Reduced a still frame, Off today's CSS grid. Reduce motion keeps them still. Colours are read from theme tokens.
- The list is built from `nav.ts`, as the orbit is now. Ctrl K search, the orb's state line and the flight of a picked page into the sidebar stay.

**To decide before building:**
- **Intro and carry-across** (§8b there). The intro streams its particles into Home's orb slot, and the orb is later carried from that slot to the Projects page. With the slot partly off the left edge, the intro would end partly off screen and the carry would start there.
- **Cost.** At this size the orb covers several times today's pixels. Check frame rate and idle CPU in the real build, or draw it at a lower internal resolution.
