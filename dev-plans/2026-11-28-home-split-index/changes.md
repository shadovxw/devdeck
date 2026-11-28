# Changes

## 2026-11-28: mockup
- Added `mockup.html`, a standalone page for the split-index Home, so it can be judged before the real Home changes.
- The dot lens is written from scratch in Canvas 2D. The React Bits Dot Field it takes the idea from uses WebGL2, which would be a second WebGL context next to the orb. No React Bits code is copied.
- The orb in the mockup is a 2D stand-in for the app's WebGL orb.
- The fonts come from Google Fonts so the file opens on its own; the app keeps its bundled fonts.
- Short windows (780px high or less) use tighter rows so the whole list fits.
