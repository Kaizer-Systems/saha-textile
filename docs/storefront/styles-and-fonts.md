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

| Order | File                                   | What it holds                                                                       |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| 1     | `src/fonts.css`                        | The `@font-face` rules for the self-hosted text fonts                               |
| 2     | `bootstrap/dist/css/bootstrap.min.css` | Bootstrap 5                                                                         |
| 3     | `@damjantonkli/ngx-toastr/toastr`      | Toast messages                                                                      |
| 4     | `swiper/swiper-bundle.css`             | Swiper's core rules plus arrows, dots and zoom, for the full-screen product gallery |
| 5     | `src/scss/app.gen.css`                 | The theme, compiled from `src/scss/app.scss`                                        |
| 6     | `src/scss/theme-color.css`             | The shop's theme colour, which overrides the theme's default                        |

`swiper-bundle.css` already contains every rule in `swiper/css`, so the core file is not imported separately.

### Compiling the theme

The Analog dev server cannot resolve the theme's relative SCSS imports, so dart-sass compiles them. `pnpm --filter @saha-textile/storefront styles` writes two files:

- `src/scss/app.gen.css` from `src/scss/app.scss`: the theme in light colours.
- `public/assets/css/theme-dark.gen.css`: the dark mode's colour changes, described below. Sass first compiles `src/scss/dark.scss` to `src/scss/dark-copy.gen.css`, then `scripts/build-dark-theme.mjs` reduces it.

The script runs before `dev`, `build` and `lint`. A running dev server does not recompile SCSS, so run `styles` after changing a theme file. `styles:watch` recompiles only the light theme; run `styles` once more to refresh the dark file. Both outputs are generated and ignored by git. The admin works the same way with its own `styles` script.

## Dark mode

The theme builds dark mode by compiling the whole theme a second time with dark variables, with every rule under `.dark`. Loaded as it is, that copy repeats every size, spacing and font rule, and because `.dark x` outranks `x` it undoes the shop's own layout work wherever that differs from the original theme (logo sizes, the hero's padding, the footer's logo plate).

So `scripts/build-dark-theme.mjs` keeps only what dark mode is meant to change. It walks the dark copy rule by rule, matches each rule to the light rule with the same selector in the same media query (the n-th occurrence to the n-th, because the theme repeats some selectors), and keeps a declaration only when:

- its value differs from the light value, and
- it is a colour property: `color`, backgrounds, border colours, shadows, `fill`, `stroke`, outline colour or a custom property.

Border and outline shorthands are rewritten to their colour longhand (`border: 1px solid #333` becomes `border-color: #333`), so dark mode can never add a border width the light theme does not have. Keyframes, font faces and the theme's random demo confetti are dropped. The script prints what it kept and how many non-colour declarations it left out. The result is about 1,170 declarations, about 110 KB raw and 12 KB compressed, instead of a 1 MB copy.

Light and dark pages therefore have identical layout. A Playwright comparison of every visible element's position, size, padding, margin and font on 22 page types at 390, 768, 1024, 1280 and 1920 px found no difference.

### The shop colour as text

The shop colour (`--theme-color`, `#417394`) reads well on white but not on the dark theme's charcoal. The dark build therefore gives every light rule that colours text or an icon with `var(--theme-color)` a dark twin using `--theme-text-on-dark`, defined on `html.dark` as `color-mix(in srgb, var(--theme-color) 55%, #ffffff)`, which is about 6.6 : 1. The tint is worked out from the colour, so it follows any Brand Kit colour. Two kinds of rule keep the true colour: text over photographs (`home-contain`, `banner-contain`) and blue text on its own white background. Buttons and other filled areas always keep the true colour; white text on it already passes.

### Named colours

The shop's own screens use named colours instead of typed values, so they work in both modes:

| Name                                          | Light                           | Dark                            | Used for                                  |
| --------------------------------------------- | ------------------------------- | ------------------------------- | ----------------------------------------- |
| `--st-surface`                                | `#ffffff`                       | `#1d1d22`                       | Cards, tables, the search box             |
| `--st-surface-soft`, `--st-surface-subtle`    | `#f8f8f8`, `#fafafa`            | `#1d1d22`                       | Pills, table heads, form panels           |
| `--st-surface-hover`                          | `#f5f5f5`                       | `#33373a`                       | Hover rows                                |
| `--st-text`, `--st-text-body`                 | `#222222`, `#4a5568`            | `#ffffff`, `#dddddd`            | Headings and body text                    |
| `--st-text-muted` … `--st-text-faint-2`       | `#666666` … `#999999`           | `#b8b8b8` … `#a8a8a8`           | Helper and secondary text                 |
| `--st-border` and variants                    | `#eeeeee` …                     | white at 12–30 %                | Borders and lines                         |
| `--st-success`, `--st-warning`, `--st-danger` | `#237032`, `#e8590c`, `#e03131` | `#51cf66`, `#ff922b`, `#ff6b6b` | Stock and status text                     |
| `--st-accent-text`                            | `var(--theme-color)`            | `var(--theme-text-on-dark)`     | The shop colour as text in our components |

Light values live in `scss/utils/_shop-colours.scss` (part of the light theme) and dark values in `scss/shop-dark.scss`, which `dark.scss` imports, so they load only in dark mode. `shop-dark.scss` also holds the few dark fixes for the theme itself: Bootstrap tables, form labels, status pills, stock chips, the gallery arrows, the newsletter popup text, and hero text that keeps its light colours. Every rule in it is a colour.

### Contrast in both modes

A full audit measured every visible piece of text on 160 page-and-state combinations: light and dark, desktop and phone, signed in and out, popups and menus included. It changed these theme colours in both modes so all of them reach WCAG AA:

- The red buttons (`btn-animation`, the sign-in tabs, the account buttons): `#d32f2f → #c62828` instead of `#ff6b6b → #ff4f4f`.
- Badges: dark text `#1d1d22` on the yellow "New" and "Featured" labels; `#c62828` instead of `#ff7272` for "Sale", the menu "New" label and the cart count.
- Order and refund statuses darker in light mode, lighter in dark mode.
- Grey hint text `#777` and `#999` now `#666` and `#6b6b6b`; the Facebook button `#166fe5`.

`e2e/dark-mode.spec.ts` keeps it that way (see [Quality and Definition of Done](../frontend/quality-and-definition-of-done.md)).

- **When it applies.** `ThemeModeStore` (`core/brand/theme-mode.ts`), created by `App`, decides the mode: the shopper's choice from the `st_theme` cookie, or, without a choice, `general.mode` in `site-config.json` (the site mode). When the Brand Kit's **Show the light/dark switch in the shop** is off, the cookie is ignored and everyone gets the site mode. `applyThemeMode`, run by the store whenever the mode changes, adds the `dark` class to `<html>` and appends a stylesheet link with the id `theme-dark` that loads `theme-dark.gen.css` when the mode is `dark`, and removes both otherwise.
- **No flash.** The function also runs during server rendering, so a dark page arrives with the stylesheet already linked. In the browser it finds the server's link by its id and does not add a second one.
- **No cost in light mode.** Light pages never request the file, so search engines and Lighthouse see the same page as without it. The service worker's precache list (`injectManifest.globIgnores` in `service-worker.vite.ts`) leaves it out, so light-mode shoppers do not download it in the background either.
- **Scoping.** `dark.scss` imports the base variables inside `.dark`, so the theme's default `--theme-color` lands under `.dark` and never overrides `theme-color.css`.

The admin has its own dark mode, built the same colour-only way from its own theme rules; see [Admin Styles and Dark Mode](../admin/styles-and-dark-mode.md).

### The light/dark switch

`app-mode` (`layout/header/widgets/mode`) is a moon/sun button in the top bar, after Language and Currency, at every width. When the top bar is turned off it sits in the menu panel's heading instead. The icon shows the mode a press gives, and its translated hover name says "Switch to dark" or "Switch to light". The Brand Kit's `modeSwitch` setting (on by default) shows or hides it.

Pressing it calls `ThemeModeStore.toggle()`, which writes `st_theme=dark|light`:

| Cookie consent     | `st_theme` is kept                             |
| ------------------ | ---------------------------------------------- |
| Functional allowed | One year                                       |
| Functional refused | Until the browser closes (a visit-only cookie) |

A later refusal shortens an existing `st_theme` to the visit instead of deleting it (`VISIT_ONLY_WHEN_REFUSED` in `cookie-catalogue.ts`), so the switch never undoes itself on the next page. Cookie settings list it under Functional.

The server reads the cookie from the request, so the page arrives in the chosen mode with no flash. Because pages differ by this cookie, a cache placed in front of the storefront's HTML must vary on it or skip pages that carry it; today's Nginx setup does not cache pages.

### Dark pictures

In dark mode, `ThemeModeStore.pick(light, dark)` returns the Brand Kit's dark picture where one is set:

| Place                       | Light mode                        | Dark mode, dark picture set |
| --------------------------- | --------------------------------- | --------------------------- |
| Header (wide screens)       | Logo                              | Dark logo                   |
| Header (phones)             | Seal                              | Dark seal                   |
| Footer                      | Logo on a white plate             | Dark logo, no plate         |
| Newsletter and event popups | Logo                              | Dark logo                   |
| Browser tab icon            | Follows the browser's own setting | Dark icon                   |

Where no dark picture is set, the light one stays. With no shopper choice and a light site mode, the tab icon keeps following the browser's light or dark setting (`applyBrandHead` in `core/brand/brand-head.ts`).

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
