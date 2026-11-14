---
title: Admin Styles and Dark Mode
wide: true
description: How the admin's global stylesheet is built, how dark mode is split into a colour-only file that loads only in dark mode, how a dark choice is applied before the app starts, and the checks that keep both modes the same layout.
status: implemented
audience: [beginner, frontend]
last_verified: '2026-11-15'
source_of_truth:
    - apps/admin/scripts/dark-theme.mjs
    - apps/admin/scripts/build-dark-theme.mjs
    - apps/admin/vite.config.ts
    - apps/admin/public/assets/js/theme-mode.js
    - apps/admin/src/app/core/brand/theme-mode.ts
    - apps/admin/src/app/layout/header/widgets/mode
    - docker/images/admin-nginx.conf
    - e2e/dark-mode.admin.spec.ts
    - e2e/colour-checks.ts
---

# Admin styles and dark mode

The admin keeps its template theme's look. Its global styles start in `src/styles.scss`, which imports the self-hosted fonts and `public/assets/scss/app.scss` (Bootstrap, the toast and carousel styles, Remix Icon and the theme). Vite compiles that file for `index.html`. Each component keeps its own styles.

Dark mode is a file of its own: light pages never download it, and it can only change colours.

## Where the dark rules come from

The theme writes dark mode by hand as rules under `body.dark-only`, mostly in `themes/_dark.scss`, with small parts in `layout/_rtl.scss` and `pages/_login.scss`. They stay there: the SCSS is edited exactly as before. The build splits them out of the compiled CSS in two places, both using `scripts/dark-theme.mjs`:

| Step                                         | What it does                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `stripDarkRules` (PostCSS, `vite.config.ts`) | Removes every selector containing the `.dark-only` class from the main stylesheet. In a mixed list such as `.badge, body.dark-only .badge`, only the dark half goes.     |
| `styles` script                              | Sass compiles `app.scss` to `public/assets/scss/app.gen.css`; `scripts/build-dark-theme.mjs` then writes the dark rules alone to `public/assets/css/theme-dark.gen.css`. |

`stripDarkRules` only touches `src/styles.scss`. A component's own `:host-context(body.dark-only)` styles (the sidebar's dark logo, the inbox) are small, scoped and stay with the component.

`styles` runs before `dev` and `build` (`predev`, `prebuild`). Both outputs are generated and ignored by git. After changing a theme file while a dev server runs, run `pnpm --filter @saha-textile/admin styles` to refresh the dark file.

## Colours only

`darkRulesOnly` keeps a declaration only when it cannot move or resize anything:

- colours, backgrounds, shadows, `fill` and `stroke`, and custom properties;
- border and outline colours. A shorthand such as `border: 1px solid #1d3436` becomes `border-color: #1d3436`, and `border-bottom: none` (the theme hiding a line in dark mode) becomes `border-bottom-color: transparent`, so the line keeps the light theme's width;
- paint-only effects: `filter` (the theme inverts some icons), `opacity`, blend modes, and `animation: none` (the dark sidebar stops the moving gradient).

Everything else is left out, for example padding, sizes, `display`, `font-weight` and border radius. The script prints how many declarations it kept and left out; `DARK_THEME_VERBOSE=1` lists every one. The result is about 1,670 declarations, about 190 KB raw and 19 KB compressed.

## When it applies

| Piece                                         | Role                                                                                                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public/assets/js/theme-mode.js`              | A small classic script in `<head>`, before the app loads. When this browser chose dark, it links the dark stylesheet, paints the page background dark until the file arrives, and adds `dark-only` to `<body>` as the parser creates it. |
| `ThemeModeStore` (`core/brand/theme-mode.ts`) | Created by `App` on every screen, sign-in included. Holds the mode, applies it with `applyThemeMode`, and saves the choice.                                                                                                              |
| `app-mode` (`layout/header/widgets/mode`)     | The header's moon/sun switch. Its translated hover name says "Switch to dark" or "Switch to light". Enter and Space work as well as a click.                                                                                             |

The choice is per browser: `localStorage` key `st_admin_theme`, `dark` or `light`, beside the theme colour's `st_admin_theme_color`. Without a choice the admin is light. Other open admin tabs follow a switch at once through the `storage` event. When storage is refused (some private windows), the switch still works for the visit.

`applyThemeMode` links the stylesheet first and adds the class once the file has arrived, so the page never shows the light theme with dark-mode component colours in between. Switching back to light removes both.

### No flash

A page that starts dark is dark from its first paint:

- the stylesheet link carries `blocking="render"`, so browsers that support it wait for the file before painting;
- until it arrives, the script sets the dark page colour (`#0b141d`, the dark stylesheet's own `body.dark-only` background) on `<html>`, so other browsers paint dark too, then removes it;
- `<body>` gets its class from a mutation observer, whose callback runs before the browser next draws.

The script and the store must agree on the key, the file, the link id and the class. A unit test reads the script and checks each one, and checks the stand-in colour against the built stylesheet.

### Caching

The production admin container (`docker/images/admin-nginx.conf`) marks hashed build files as immutable for a year. The dark stylesheet and the boot script keep their names from release to release, because the script must know the file's address before the app runs, so they are served with `Cache-Control: no-cache` and browsers check them on every visit.

### Dark pictures

`ThemeModeStore.pick(light, dark)` returns the Brand Kit's dark picture in dark mode when one is set, otherwise the light one. The sign-in page uses it for its logo. The sidebar switches with its own component styles (see [Brand Kit](./brand-kit.md)).

## Checks

| Check                  | Where                                   | What it proves                                                                                                                                        |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Split and filter       | `scripts/dark-theme.spec.ts`            | Dark selectors leave the main stylesheet, mixed lists keep their light half, only paint survives, hidden borders become transparent.                  |
| Store and boot script  | `src/app/core/brand/theme-mode.spec.ts` | Saved choice, toggling, refused storage, other tabs, `pick`, and the boot script's behaviour and agreement with the app.                              |
| Downloads and no flash | `e2e/dark-mode.admin.spec.ts`           | Light pages request no dark file; the switch loads it and is remembered; a reload is dark before Angular runs; the main stylesheet has no dark rules. |
| Parity                 | `e2e/dark-mode.admin.spec.ts`           | On every admin screen and on sign-in, every visible element on the first screen has the same position, size, padding, margin and font in both modes.  |

`e2e/colour-checks.ts` holds the page functions both apps' dark-mode specs use: `firstScreen` for parity and `lowContrast` for WCAG AA text contrast. The admin runs `lowContrast` with see-through layers blended as the eye sees them and with text under a popup's backdrop skipped; the shop keeps its original settings.
