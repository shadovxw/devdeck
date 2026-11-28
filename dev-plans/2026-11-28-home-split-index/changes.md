# Changes

## 2026-11-28: mockup
- Added a richer menu after the owner found the list too simple: selection bar and thread to the orb, group rails and blurbs, sub-pages, shortcuts and keyboard control. A Menu switch keeps the plain list for comparison. Everything it shows comes from `nav.ts` and `shortcuts.ts`.
- Windows 901–1280px wide give the menu more room, so sub-pages don't cover a page's name.
- Added `mockup.html`, a standalone page for the split-index Home, so it can be judged before the real Home changes.
- The dot lens is written from scratch in Canvas 2D. The React Bits Dot Field it takes the idea from uses WebGL2, which would be a second WebGL context next to the orb. No React Bits code is copied.
- The orb in the mockup is a 2D stand-in for the app's WebGL orb.
- The fonts come from Google Fonts so the file opens on its own; the app keeps its bundled fonts.
- Short windows (780px high or less) use tighter rows so the whole list fits.
- Added the intro the owner described: the orb forms in the centre, moves left, then the page fades in. The logo and the forming particles are a simpler stand-in for the app's 3D intro; only the order and the timing are being judged. Its dots are drawn bigger while the orb is small in the centre.
