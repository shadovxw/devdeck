# devdeck

devdeck is a personal developer cockpit that sits on top of VS Code. One click starts any codebase's stack, and you get live logs, resources, databases and git (across multiple GitHub accounts) in one place. It also runs plugin-based security and build pipelines, and turns Claude-assisted work into reviewed PRs, all inside a 3D, animated desktop app.

## Status

Planning. Nothing is built yet.

| What | Where |
|---|---|
| Implementation plan (phases 0–13, decisions, architecture) | [`dev-plans/00-implementation-plan.md`](dev-plans/00-implementation-plan.md) |
| Bare HTML mockup of every page (start at the sitemap) | [`ui-mockup/sitemap.html`](ui-mockup/sitemap.html) |

To view the mockup, serve the folder and open `http://localhost:7071/sitemap.html`:

```bash
python -m http.server 7071 --directory ui-mockup
```

## Planned stack

- **Backend:** Go, Echo, SQLite, its own process supervisor
- **Frontend:** React + Vite + TypeScript, Tailwind, shadcn (re-skinned), Motion + GSAP, React Three Fiber, ECharts
- **Desktop:** Wails

## Owner

Vrishank Warrier
