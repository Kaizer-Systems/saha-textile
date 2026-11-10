---
title: Styles, Dark Mode and Fonts
description: How the storefront's global stylesheet is built and ordered, how the theme's dark mode loads only when it is switched on, and how every text font is served from the apps' own addresses.
status: implemented
audience: [beginner, frontend, operations]
last_verified: '2026-11-10'
source_of_truth:
    - apps/storefront/src/styles.css
    - apps/storefront/src/scss/app.scss
    - apps/storefront/src/scss/dark.scss
    - apps/storefront/src/app/core/brand/theme-mode.ts
    - apps/storefront/service-worker.vite.ts
    - apps/storefront/index.html
    - apps/admin/src/styles.scss
    - scripts/self-host-fonts.mjs
    - scripts/build-fallback-pages.mjs
    - docker/production/nginx/edge.conf.template
---

# Styles, dark mode and fonts

The storefront keeps its template theme's look. Its styles reach the browser as one global stylesheet linked from `index.html`, plus Angular's component styles. The theme's dark mode and every text font are files of their own, so a page downloads them only when it needs them.

## The global stylesheet

`src/styles.css` is linked from `index.html`, so the server-rendered page is styled before it first paints. Importing it from `main.ts` instead would let the dev server add it from JavaScript, and the page would paint unstyled first. Its imports run in this order, and the order matters:

| Order | File                                   | What it holds                                                           |
| ----- | -------------------------------------- | ----------------------------------------------------------------------- |
| 1     | `src/fonts.css`                        | The `@font-face` rules for the self-hosted text fonts                   |
| 2     | `bootstrap/dist/css/bootstrap.min.css` | Bootstrap 5                                                             |
| 3     | `@damjantonkli/ngx-toastr/toastr`      | Toast messages                                                          |
| 4     | `swiper/swiper-bundle.css`             | Swiper's core rules plus arrows, dots and zoom, for the product gallery |
| 5     | `src/scss/app.gen.css`                 | The theme, compiled from `src/scss/app.scss`                            |
| 6     | `src/scss/theme-color.css`             | The shop's theme colour, which overrides the theme's default            |

`swiper-bundle.css` already contains every rule in `swiper/css`, so the core file is not imported separately.

### Compiling the theme

The Analog dev server cannot resolve the theme's relative SCSS imports, so dart-sass compiles them. `pnpm --filter @saha-textile/storefront styles` writes two files:

- `src/scss/app.gen.css` from `src/scss/app.scss`: the theme in light colours.
- `public/assets/css/theme-dark.gen.css` from `src/scss/dark.scss`: the dark mode, described below.

The script runs before `dev`, `build` and `lint`. A running dev server does not recompile SCSS, so run `styles` (or `styles:watch`) after changing a theme file. Both outputs are generated and ignored by git. The admin works the same way with its own `styles` script.

## Dark mode

The theme builds dark mode by compiling the whole theme a second time with dark variables, with every rule under `.dark`. That copy is about as large as the light theme (about 1 MB, about 119 KB gzip), so it lives in its own file instead of the global stylesheet.

- **When it applies.** The shop's mode comes from `general.mode` in `site-config.json`. `applyThemeMode` (`core/brand/theme-mode.ts`), called from `App`, adds the `dark` class to `<html>` and appends a stylesheet link with the id `theme-dark` that loads `theme-dark.gen.css` when the mode is `dark`, and removes both otherwise.
- **No flash.** The function also runs during server rendering, so a dark page arrives with the stylesheet already linked. In the browser it finds the server's link by its id and does not add a second one.
- **No cost in light mode.** Light pages never request the file, so search engines and Lighthouse see the same page as without it. The service worker's precache list (`injectManifest.globIgnores` in `service-worker.vite.ts`) leaves it out, so light-mode shoppers do not download it in the background either.
- **Scoping.** `dark.scss` imports the base variables inside `.dark`, so the theme's default `--theme-color` lands under `.dark` and never overrides `theme-color.css`.

The admin has its own dark mode, switched from its header, and is not affected by any of this.

## Fonts

Every text font is served from the app's own address. No page contacts Google Fonts, so a page never waits for a connection to a second host before it can draw, and visitors' addresses are not sent to a third party.

| App             | Families                                                                           | Files                          | Rules                                          |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------- |
| Storefront      | Public Sans (100–900, upright and italic), Noto Sans Bengali (400, 600), Russo One | `public/assets/fonts/text/`    | `src/fonts.css`, first import of `styles.css`  |
| Admin           | Public Sans, Noto Sans Bengali                                                     | `public/assets/fonts/text/`    | `src/fonts.css`, first import of `styles.scss` |
| Release Console | Chakra Petch, IBM Plex Sans, IBM Plex Sans Condensed, IBM Plex Mono                | `public/fonts/`                | `src/fonts.css`, first import of `styles.css`  |
| Fallback pages  | The fonts the storefront's and admin's built stylesheets ask for                   | copied to `/__fallback/fonts/` | the copied stylesheet                          |

Each `@font-face` rule names one language subset through `unicode-range`. A browser downloads a file only when the page shows a character in that range in that family and style, so the Bengali files load only on pages with Bengali text, and Russo One loads only where something uses it. Public Sans is a variable font: one file per subset and style covers all nine weights.

The storefront and the admin preload `public-sans-normal-100-900-latin.woff2`, the face every page draws first, so text does not reflow when the font arrives.

### Updating the fonts

`node scripts/self-host-fonts.mjs` (or `node scripts/self-host-fonts.mjs storefront` for one app) asks Google Fonts for the same stylesheet a current Chrome receives. It saves every WOFF2 file with a readable name (`<family>-<style>-<weights>-<subset>.woff2`), saves each family's SIL Open Font License beside the files, and rewrites the app's `fonts.css`. The families and weights each app needs are listed at the top of the script. Run it only to add a family or weight, or to take a newer release, and commit the fonts, the licences and `fonts.css` together. Do not edit `fonts.css` by hand.

### Fallback pages

The "back in a moment" pages that Nginx shows when an app is down copy that app's built stylesheet (`scripts/build-fallback-pages.mjs`). Because `/assets/` belongs to the app that is down, the script copies every font file the stylesheet asks for into the fallback folder and points the stylesheet at `/__fallback/fonts/`.

### Content Security Policy

`font-src` and `style-src` in `docker/production/nginx/edge.conf.template` do not allow the Google Fonts hosts. A page that linked Google Fonts again would be blocked in production.

## The display font

The theme's `.text-russo` class sets Russo One, a squared display face with one weight and Latin and Cyrillic letters only (no Bengali). No page uses the class. Where it may be used is decided under `DEC-DISPLAY-FONT` in `pending-decisions.mdx`. Until then, the font is available and never downloaded.
