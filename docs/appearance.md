# Appearance: themes, mode and motion

How devdeck looks is set on **Settings → Appearance**. Changes show on the whole app as you make them.

## Mode

- **Light** and **Dark** show the theme you chose for that scheme.
- **System** follows your operating system and switches by itself between your light theme and your dark theme.

Two themes come with devdeck: **Paper** (light, the default) and **Paper Dark**. Choosing a theme makes it the one for its scheme (a dark theme for dark, a light theme for light) and shows it. To change the other scheme's theme, click it in the gallery.

## Make your own theme

1. Pick a theme and press **Duplicate & edit**. The built-in themes can't be changed; your copy can.
2. Change the colours. Each row has a swatch (it opens a colour picker), a hex box and a grade:
   - **AAA** (7:1 or more) and **AA** (meets what that colour needs) are fine.
   - **LOW** means some text or status colour is hard to read on the background. The preview under the list says which. A low theme still saves; it is your choice.
3. Press **Save** to keep it, or **Discard** to go back. Leaving the page with unsaved changes asks first.

The ten colours are the background, menus and panels, buttons and fields, text, the selected marker, the primary button, and the four status colours (success, warning, error, neutral). The rest (softer text, hover and pressed fills, the sidebar, the timeline tones) are worked out from them. Open **Advanced** to set any of those yourself; a colour you set there stays as you set it.

Radius, shadows, type and motion are the same in every theme.

## Copy, rename, export, import, delete

- **Rename** by editing the name at the top of your theme.
- **Duplicate** makes a copy with the same colours.
- **Export** downloads `<name>.devdeck-theme.json`. **Import** reads one; it gets an id of its own, so it never overwrites a theme you have.
- **Delete** asks first. If a mode was using that theme, it goes back to Paper (light) or Paper Dark (dark).

A theme file holds only colours:

```json
{
  "schema": 1,
  "id": "sunset",
  "name": "Sunset",
  "base": "paper-dark",
  "colors": { "primary": "#ffb454", "--ink-2": "#ccddee" }
}
```

`base` is `paper` or `paper-dark`. A colour is a role (`background`, `cards`, `controls`, `text`, `primary`, `selected`, `success`, `warning`, `error`, `neutral`) or one of the Advanced tokens, always as `#rgb` or `#rrggbb`. Anything else in a file is dropped, and a file with a bad colour is refused with the reason. Nothing in a theme is ever run or put into a stylesheet as text.

## Reduce motion

Turn it **On** to stop spinners and pulses and make every move a cut. devdeck also does this by itself when your operating system asks for reduced motion.

## Where it is kept

- Themes, the mode and the theme for each scheme are kept by the devdeck app (in its database), so the browser and the desktop window show the same ones.
- This browser keeps a copy of the colours, so the page has the right colours from the first moment, and uses it when the app can't be reached.
- Reduce motion is kept in this browser only.
- At most 30 themes are kept.
- Claude Code's connector can't read or change any of it.

## For developers

- `web/src/design/tokens.css` is Paper: the colours every page uses as CSS variables. Components use the variables, never fixed colours.
- `web/src/theme/` holds the rest: `types.ts` (the roles and the Advanced tokens), `derive.ts` (how colours are worked out from the roles), `builtins.ts` (Paper and Paper Dark; a test keeps Paper equal to `tokens.css`), `checks.ts` (contrast), `validate.ts` and `file.ts` (theme files), `apply.ts` (sets the variables), `store.ts` (the choice of mode and themes, and syncing with the server), `server.ts`.
- The server side is `internal/api/themes.go` (`/api/v1/appearance`), on the `themes` table and the `settings` table.
- The plan and what was built, step by step, are in [`dev-plans/2026-11-01-custom-themes/`](../dev-plans/2026-11-01-custom-themes/plan.md).
