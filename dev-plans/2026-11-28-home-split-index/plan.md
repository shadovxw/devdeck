# Home: split index (mockup)

**Status:** mockup approved by the owner on 2026-11-28 (split layout, the intro order and the Rich menu). Not built yet; the app is unchanged. The points under "To decide before building" are still open.

**Idea.** Replace the orbit on Home with a split page: the large orb partly off the left edge, and the pages as a numbered list on the right (00 Overview, then Work, Run and System). Behind both, the Neon dot grid gains a lens that follows the pointer.

**See it:** open [`mockup.html`](mockup.html) in a browser. The switches (bottom left, not part of the design) change the theme and the dots, and replay the intro.

**Intro (the owner's direction).** The logo comes in, then flies to the corner as today. The orb forms in the **centre** of the window, holds briefly, then moves left and grows into its place. As it arrives, the header, greeting, list and state line fade in one after another. This changes §8b there, where the particles stream straight into Home's orb slot. In the mockup: logo 0.2–1.9 s, orb forms 1.9–3.3 s, move 3.6–4.6 s, fade in from 4.3 s. Any key or click skips it, and it plays only with Full effects.

**The menu (owner: the plain list felt too simple).** The mockup's Menu switch compares Rich with Plain.
- One page is always selected; Overview to begin with. A bar slides to it, a thread runs from the orb to the bar, its name grows and takes the gradient (the screen's one gradient word), and its shortcut shows on the right.
- While you are choosing, the other names and diamonds dim; the small text does not. In the mockup, with a page selected, the menu text measured at least 5.6:1 in all three themes (over the page colour). The dot lens fades out near the text.
- Stacks and Connections show their built sub-pages as links when selected.
- A rail with diamonds joins each group's pages, and each group says what it is about (nav.ts blurbs).
- Keys: ↑ ↓ move, Enter opens, 0–9 selects by number, G then the page's key jumps (shortcuts.ts). A one-line legend says so.
- Nothing in the menu is live: Home stays the same every time, and what runs stays on Overview.
- The bar and thread move; the travelling light and glow are Full effects only. Narrow windows drop the bar, thread and legend, and list sub-pages under their page.

**If approved:**
- This replaces §8c of [the look plan](../2026-11-21-portfolio-look/plan.md); update it in the same PR.
- Home keeps its one WebGL orb. The dots are our own Canvas 2D layer, so there is no second WebGL context (decision 10 there: one renderer per page; reword it to say so).
- Dots follow Effects: Full has the lens, Reduced a still frame, Off today's CSS grid. Reduce motion keeps them still. Colours are read from theme tokens.
- The list is built from `nav.ts`, as the orbit is now. Ctrl K search, the orb's state line and the flight of a picked page into the sidebar stay.

**To decide before building:**
- **Carry-across** (§8b there). The orb is later carried from Home's slot to the Projects page. With the slot partly off the left edge, that move would start there.
- **Cost.** At this size the orb covers several times today's pixels. Check frame rate and idle CPU in the real build, or draw it at a lower internal resolution.
