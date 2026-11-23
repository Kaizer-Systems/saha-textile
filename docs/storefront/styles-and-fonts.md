---
title: Styles, Dark Mode and Fonts
description: How the storefront's global stylesheet is built and ordered, how the theme's dark mode loads only when it is switched on, and how every text font is served from the apps' own addresses.
status: implemented
audience: [beginner, frontend, operations]
last_verified: '2026-11-24'
source_of_truth:
    - apps/storefront/src/styles.css
    - apps/storefront/src/scss/app.scss
    - apps/storefront/src/scss/dark.scss
    - apps/storefront/src/app/core/brand/theme-mode.ts
    - apps/storefront/service-worker.vite.ts
    - apps/storefront/src/server/critical-css.ts
    - apps/storefront/src/server/plugins/critical-css.ts
    - apps/storefront/src/server/expect-link.ts
    - apps/storefront/src/server/plugins/expect-link.ts
    - apps/storefront/src/app/layout/layout.html
    - apps/storefront/vite.config.ts
    - apps/storefront/index.html
    - apps/admin/src/styles.scss
    - scripts/self-host-fonts.mjs
    - scripts/font-fallback-metrics.mjs
    - apps/storefront/src/font-fallbacks.css
    - apps/storefront/src/app/layout/header/widgets/language/language.scss
    - apps/storefront/src/scss/components/_gallery-before-start.scss
    - apps/storefront/src/app/features/shop/product-detail/product-gallery/product-gallery.ts
    - scripts/split-icon-font.mjs
    - apps/storefront/public/assets/css/remixicon-shop.css
    - apps/storefront/src/icon-font.spec.ts
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
| 2     | `src/font-fallbacks.css`               | The measured Public Sans fallback (see Fonts)                                       |
| 3     | `bootstrap/dist/css/bootstrap.min.css` | Bootstrap 5                                                                         |
| 4     | `@damjantonkli/ngx-toastr/toastr`      | Toast messages                                                                      |
| 5     | `swiper/swiper-bundle.css`             | Swiper's core rules plus arrows, dots and zoom, for the full-screen product gallery |
| 6     | `src/scss/app.gen.css`                 | The theme, compiled from `src/scss/app.scss`                                        |
| 7     | `src/scss/theme-color.css`             | The shop's theme colour, which overrides the theme's default                        |

`swiper-bundle.css` already contains every rule in `swiper/css`, so the core file is not imported separately.

### Compiling the theme

The Analog dev server cannot resolve the theme's relative SCSS imports, so dart-sass compiles them. `pnpm --filter @saha-textile/storefront styles` writes two files:

- `src/scss/app.gen.css` from `src/scss/app.scss`: the theme in light colours.
- `public/assets/css/theme-dark.gen.css`: the dark mode's colour changes, described below. Sass first compiles `src/scss/dark.scss` to `src/scss/dark-copy.gen.css`, then `scripts/build-dark-theme.mjs` reduces it.

The script runs before `dev`, `build` and `lint`. A running dev server does not recompile SCSS, so run `styles` after changing a theme file. `styles:watch` recompiles only the light theme; run `styles` once more to refresh the dark file. Both outputs are generated and ignored by git. The admin works the same way with its own `styles` script.

## Critical CSS

The theme stylesheet is about 1 MB (100 KB compressed). Linked normally it blocks the first paint until it has downloaded, which on a phone took about 4 s of the home page's first paint. The shop therefore inlines the CSS a page's first paint needs and loads the full stylesheets without blocking, as Google's guidance on critical CSS describes.

- **What works it out.** Beasties (the successor of Google's Critters, used by Angular and Nuxt) reads a page's own HTML and keeps the rules its elements need, media queries included, so one answer serves phones and computers.
- **When.** Working it out takes about 5 s on this stylesheet, so it never runs on a shopper's request. The first visit to a page type after a release is sent as drawn; a worker thread then works out that page's critical CSS once, and later visits get it. An answer lasts as long as the build: its key holds the stylesheets' hashed names, and new content is handled by the shape check below.
- **One answer for every page of a type.** Every product page shares one answer, and so does every category page, so an answer must hold the rules of whatever those pages draw. Each answer keeps the shape of the pages it was made from: every tag, class and attribute name on them (`pageShape`; ids and values are left out, as they differ from product to product). A page whose shape adds nothing new gets the answer (`covers`). A page with something new, such as the first fabric-by-the-metre product after a sari, is sent as drawn with its blocking stylesheets (today's page, so nothing on it moves), and its body joins the answer's samples; the answer is then worked out again from all the samples in one document (`samplesDocument`), so its rules stay in the stylesheets' own order and the cascade is exactly theirs. At most `MAX_SAMPLES` (8) shapes join one answer; a page beyond them keeps its blocking stylesheets (`x-st-critical: uncovered`). A handful of shapes covers a catalogue, so the work grows with templates, not with products.
- **Fonts.** The first paint must draw text in the room it will finally take, or the header moves when the fonts apply (a layout shift). So the inlined block declares the faces whose file the page already preloads (`index.html` preloads Public Sans' English letters and the shop's icons) and the measured Public Sans fallback below; every other face (বাংলা, italic, the subset with the ₹ sign) is left to the full stylesheets, so the critical CSS never starts a font download of its own (`preloadedFontsOnly`). Two details: Beasties 0.5.4 drops a selector made of one bare attribute test, such as the icon font's `[class^='ri-']`, so `allowRules` keeps the shop's three such selectors (a unit test lists them); and the inlined icon-font address resolves to the same file `index.html` preloads. The options are `BEASTIES_OPTIONS` in `src/server/critical-css.ts`.
- **Which pages.** Pages are grouped by type and language: Home, category pages (`/{lang}/collections/…`) and product pages (`/{lang}/product/{slug}`), each in English and বাংলা (`PAGE_TYPES`). The key also holds the stylesheets the page links and the page's Page Builder section outline, so a new build, dark mode (which links its own stylesheet) or another layout never reuses an answer made for something else.
- **How the page changes.** A `<style data-st-critical>` block goes before the first stylesheet, and each local stylesheet becomes `media="print"` switched to `all` once it has loaded, with a `<noscript>` link for browsers without JavaScript. The shop's CSP allows both.
- **Seeing it.** The page answer carries `x-st-critical: pending`, `inlined` or `uncovered`. `ST_CRITICAL_CSS=off` turns it off.

`ST_BUILD_DIR=<folder> pnpm build` builds the shop into that folder instead of `dist/`, so a build can be measured beside a running shop without replacing the files it serves.

## The header draws once, whole

A page reaches a phone in pieces, and Chrome draws what it has read so far. The header sits about 133–180 KB into the page (its menu holds every category for the flyouts), so on a slow phone Chrome drew it in several steps: the centred menu widened item by item and the icons on the right pushed in, moving the whole header sideways while the page loaded (a layout shift of about 0.008, measured with Chrome slowed four times on a 400 KB/s line).

`index.html` therefore asks Chrome to hold the first paint until the tag after the header has been read: `<link rel="expect" href="#page-content" blocking="render">`, where `page-content` is the layout's `router-outlet` (`layout/layout.html`). Three details:

- **The tag after the header, not the header.** Chrome lifts the hold when the named element's opening tag is read, not its end, so naming the header would lift it at once.
- **The page's own address.** The shop's `<base href="/">` turns a bare `#page-content` into the home page's address, and Chrome ignores an expect link that points at another page. A server plugin writes each page's own path and query in front of it (`src/server/expect-link.ts`, `src/server/plugins/expect-link.ts`), on pages answered with 200. Other answers keep the bare link, which Chrome ignores.
- **What it costs.** On the same slowed phone the main content (Largest Contentful Paint) appears at the same moment with and without the hold; the first paint comes 0.3–0.7 s later, because what used to appear first was a partial header. On a fast connection nothing changes. Browsers without `rel="expect"` ignore it, and a page without the tag stops waiting at its end.

`e2e/header-and-fonts.spec.ts` checks that nothing moves on a বাংলা page while it loads.

## The icon font

The theme's icons are Remix Icon, one font of about 2,500 icons (141 KB as WOFF2). Every page used to preload all of it at high priority, competing with the page's first picture on a phone, while the shop's templates use about a hundred. The font is now split by `unicode-range`, the technique Google Fonts uses for large fonts: the same family is declared twice, each declaration covering different characters, and a browser downloads a file only when the page shows one of its characters.

- `remixicon-shop.woff` holds the icons the shop names (templates, code and demo data) and the code points the theme's own styles draw: 102 icons, about 9 KB. `index.html` preloads it, so icons still never reflow text.
- Every other icon is declared from the vendor's own `remixicon.woff2`, unchanged, for the other characters only, so a page fetches it only if it ever shows one of them. Nothing is removed and every icon still works.
- The small file is the family's default face (no `unicode-range`), declared first, and the vendor font follows with its range: a browser tries the later face first for the characters it covers, so each icon comes from exactly one file. Icons are drawn from CSS `content`, not page text, so a `unicode-range` on the small face would make Beasties judge it unused and leave it out of the critical CSS; the header icons were then drawn in a fallback on the first paint and the header moved when the stylesheets arrived (found in testing, fixed by this order).
- `index.html` links `public/assets/css/remixicon-shop.css`, which is the vendor's `remixicon.css` with only its `@font-face` replaced; every icon rule is the vendor's, byte for byte. The vendor stylesheet stays in the repository as the source, and the service worker does not precache it.

`node scripts/split-icon-font.mjs` writes the WOFF, the stylesheet and the preload's `?v=` version. It needs HarfBuzz's `hb-subset` (`brew install harfbuzz`) and packs the subset as WOFF 1.0 with Node's zlib. Run it after adding an icon to a template: `src/icon-font.spec.ts` fails until then, and also checks that the stylesheet still matches the vendor file, that every icon belongs to exactly one file and that `index.html` preloads the right address. A one-off check drew all 102 icons from the new file and from the full font in Chrome and found them pixel-identical; `e2e/critical-css.spec.ts` checks that Home fetches only the small file and that every icon on it draws.

## The language menu's flags

The page-language menu shows a flag beside each language (`languageFlag` in core: `us` for English, `in` for every other language). The theme draws `.iti-flag` from intl-tel-input's country sprite on cdnjs, which is 5,630 px wide and 161 KB at double density, and every page fetched it at high priority for two 20 px flags. The language widget's own stylesheet now points those two at `public/assets/images/flags/us.svg` and `in.svg` (2 to 7 KB, drawn to the flags' official proportions); the theme's box, shadow and grey backing are unchanged. Any other flag code still draws from the sprite, and the phone-number field on the sign-in pages keeps it, since it lists every country. `e2e/languages.spec.ts` checks that Home requests no sprite.

## Heading levels and heading classes

Screen readers and search engines read a page's headings as an outline, and Lighthouse fails a page whose headings skip a level. The theme chose heading tags for their look, so some levels were out of order: a hero's small line (`h6`) before its heading, product names (`h6`) under a section's `h2`, prices and stock lines as headings, footer column titles (`h4`) after `h2`. Each was changed to the right level, or to plain text, with exactly the same look (decision D4, 17 Nov 2026):

| Where                                                                             | Was              | Now                                                                 |
| --------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| Home hero: the small line above a heading                                         | `h6`             | `div.h6`                                                            |
| Product card name                                                                 | `h6`             | `h3.h6` (`h4.h6` under the product page's "Trending Products" `h3`) |
| Product card price and stock line                                                 | `h5`, `h6`       | `div.h5`, `div.h6`                                                  |
| Blog card date and title                                                          | `h6`, `h5`       | `p.h6`, `h3.h5`                                                     |
| Category page: children's names and counts                                        | `h4`, `h6`       | `h2.h4`, `p.h6`                                                     |
| Category page: "Sort By"                                                          | `h5`             | `p.h5`                                                              |
| Product page: price, "Please hurry! Only 4 left", the sticky bar's name and price | `h3`, `h6`, `h5` | `p.h3`, `p.h6`, `p.h5`                                              |
| Product options: "Attributes", each option's label, add-on and bundle headings    | `h4`             | `h2.h4`                                                             |
| Product options: a bundle part's name, the order summary, the measurements title  | `h6`, `h5`       | `h3.h6`, `h3.h5`                                                    |
| Product page: "Product Information", "Delivery Details"                           | `h4`             | `h2.h4`                                                             |
| Product page: "Review this product", "Have doubts…?"                              | `h4`             | `h3.h4`                                                             |
| Product page: rating counts, star rows, review dates, the Q and A labels          | `h5`, `h6`       | `div.h5`, `div.h6`                                                  |
| Product page: a question                                                          | `h6`             | `h4.h6`                                                             |
| Phone menu: "Menu"                                                                | `h5`             | `h2.h5`                                                             |
| Footer column titles                                                              | `h4`             | `h3.h4`                                                             |
| Footer contact labels and values                                                  | `h6`, `h5`       | `p.h6`, `p.h5`                                                      |
| Footer "Stay connected" and copyright                                             | `h6`             | `div.h6`                                                            |
| Newsletter subtitle; cookie box text                                              | `h5` (`h4`)      | `p.h5` (`p.h4`)                                                     |

Text that is not a heading becomes a `p`, or a `div` where the theme styles `p` in that area (`.home-detail p`, `.product-box .product-detail p { display: none }`, `.sub-footer p`), so nothing new reaches it. Where a class rule and a theme rule now weigh the same and the theme's should win (the hero's `.ls-expanded` letter spacing and its `margin-right: -12px`), the theme's rule moved after the heading rules, as the cascade had it before; nothing else changed. An `h1` or `h2` that takes a smaller look drops the theme's capitalising of `h1`/`h2`. The proof: every text on Home, a category page and a product page (phone and computer, light and dark, English and বাংলা) was captured before and after, and only the colours of D2 and D3 differ.

The look comes from the heading classes `.h3`–`.h6` (Bootstrap's names). `scss/components/_heading-classes.scss` builds them the way Bootstrap's own Sass does, with `@extend`, so a class gets every theme rule written for its tag, in every context: `.home-detail h6` also styles `.home-detail .h6`, and the Bengali line height and the dark colours follow. It is imported at the top level of `app.scss` and of `dark.scss` (after `shop-dark.scss`), so the dark copy and the shop's own `html.dark` rules get the classes too. Bootstrap's compiled CSS gives `.h1`–`.h6` only its own sizes, which is why the theme's look has to be extended here. Component styles are compiled on their own, so a component rule that names a tag (the card name's two-line rule) names the class instead. The classes add about 34 KB to the theme stylesheet before compression and nothing to the critical CSS of a page that does not use them. A section that needs a heading level that differs from its look uses the tag for the level and the class for the look.

The same round gave Home's hero dots a 24 px tap area each (WCAG 2.5.8, decision D5): the dot is drawn in the middle of its button, so the dots look the same; two tap areas may not overlap, so the dots sit 24 px apart (the gap between two small dots grows from 8 to 15 px), and the row sits 7.5 px lower so each dot stays where it was.

## The product page's photo gallery

The gallery (main photo carousel and thumbnail strip) is drawn by the server too, so hydration keeps the same picture: before, the server drew a single stand-in photo and the browser swapped in the gallery, which was 164 px taller on a phone, so the buy box jumped (CLS 0.037) and the main photo was found only after the scripts ran (LCP 11.5 s on a phone). Owl cannot measure on the server, so it writes every slide and the loop's copies at no width; `scss/components/_gallery-before-start.scss` lays that HTML out as the started carousels do (only the first real slide, as a full-width block so the photo's width and height attributes keep its box before the file arrives; three thumbnails, each (strip − 20 px) / 3 wide, with owl's own 10 px margin), until `ProductGallery` adds `.st-gallery-started` once every slide carries a pixel width. The first photo is preloaded from the head, as Home's first picture is. The thumbnail strip draws the small `card` files: the product-page answer carries them with each gallery photo (`GALLERY_FRAME_ROLES`); a photo sent without them falls back to the gallery's own smallest size. Measured: CLS 0.000 on phone and computer.

## Pictures the theme drew as CSS backgrounds

The theme's `bg-size` pattern sets a picture as an element's `background-image`. A CSS background cannot load lazily or choose a size, so it is the wrong tool for content pictures. Home's blog rail (`features/themes/widgets/blog`) drew each post's 1600 px original that way, and a phone downloaded six of them (1.35 MB) with the page. Each card now holds an `<img>` with the post's `srcset`, `sizes` for one, two or three cards per row, `loading="lazy"` and `decoding="async"`, placed in the theme's own ratio box (the link's `:before`) with Bootstrap utilities (`position-relative` on the link; `position-absolute top-0 start-0 object-fit-cover` on the picture). The theme already sizes `.blog-image img` to the box, so the card looks the same, keeps its hover zoom, and the link keeps its name. The same treatment fits any other `bg-size` content picture when its page is worked on; decorative theme shapes stay backgrounds.

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
| `--st-text-unavailable`                       | `#6b6b6b`                       | `#a8a8a8`                       | Words on an option that can't be chosen   |
| `--st-danger-text`                            | `#d32f2f`                       | `#ff8a80`                       | Red words such as "Out of Stock"          |

Light values live in `scss/utils/_shop-colours.scss` (part of the light theme) and dark values in `scss/shop-dark.scss`, which `dark.scss` imports, so they load only in dark mode. `shop-dark.scss` also holds the few dark fixes for the theme itself: Bootstrap tables, form labels, status pills, stock chips, the gallery arrows, the newsletter popup text, and hero text that keeps its light colours. Every rule in it is a colour.

### Contrast in both modes

A full audit measured every visible piece of text on 160 page-and-state combinations: light and dark, desktop and phone, signed in and out, popups and menus included. It changed these theme colours in both modes so all of them reach WCAG AA:

- The red buttons (`btn-animation`, the sign-in tabs, the account buttons): `#d32f2f → #c62828` instead of `#ff6b6b → #ff4f4f`.
- Badges: dark text `#1d1d22` on the yellow "New" and "Featured" labels; `#c62828` instead of `#ff7272` for "Sale", the menu "New" label and the cart count.
- Order and refund statuses darker in light mode, lighter in dark mode.
- Grey hint text `#777` and `#999` now `#666` and `#6b6b6b`; the Facebook button `#166fe5`.
- The phone's bottom bar labels (Category, Search, My Wish, Cart): full white instead of 80 % white over the shop blue, 5.1 : 1 instead of 3.9 : 1 (decision D2, 17 Nov 2026).
- The product page's out-of-stock option row: `--st-text-unavailable` (5.3 : 1) instead of `#b0b0b0` (2.2 : 1), and its "Out of Stock" label `--st-danger-text` (4.98 : 1) instead of `#ff4f4f` (3.2 : 1). In dark mode the row's grey #8c8c8c measured 4.13 : 1 on the dark page, so it is the shop's dark grey #a8a8a8 (5.9 : 1); the red stays #ff8a80 (decision D3).

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

### The measured fallback (storefront)

Until Public Sans has arrived, a browser draws text in the next font of the stack, and a plain fallback is wider or narrower and sits higher or lower, so the text moves when Public Sans swaps in. The storefront's stack is `'Public Sans', 'Public Sans Fallback', 'Noto Sans Bengali', sans-serif`. `Public Sans Fallback` (`src/font-fallbacks.css`, imported right after `fonts.css`) is the Arial every computer has, scaled with `size-adjust` to Public Sans' average letter width and given Public Sans' ascent, descent and line gap with `ascent-override`, `descent-override` and `line-gap-override`. This is what Next.js (`next/font`) and Nuxt (fontaine) generate. There are four faces (regular and bold, upright and italic, each over the matching Arial face), for Latin letters only, so বাংলা text still goes on to Noto Sans Bengali. Safari applies `size-adjust` but not the three overrides, so there only the widths match.

`node scripts/font-fallback-metrics.mjs` writes the file. It measures the shop's own Public Sans files and the installed Arial in Chrome, the way the browser reads them: average width per character over a sample of the shop's kind of English, ascent, descent and line gap. Size-adjust is Public Sans' average width divided by Arial's; each override is Public Sans' metric divided by size-adjust (Capsize's formulas). Run it on a Mac after taking a new Public Sans release with `self-host-fonts.mjs`, and commit the result. `e2e/critical-css.spec.ts` loads Home with Public Sans blocked and again with it, and checks that every text box keeps its height and the words keep their total width within 3%.

### Updating the fonts

`node scripts/self-host-fonts.mjs` (or `node scripts/self-host-fonts.mjs storefront` for one app) asks Google Fonts for the same stylesheet a current Chrome receives. It saves every WOFF2 file with a readable name (`<family>-<style>-<weights>-<subset>.woff2`), saves each family's SIL Open Font License beside the files, and rewrites the app's `fonts.css`. The families and weights each app needs are listed at the top of the script. Run it only to add a family or weight, or to take a newer release, and commit the fonts, the licences and `fonts.css` together. Do not edit `fonts.css` by hand.

### Fallback pages

The "back in a moment" pages that Nginx shows when an app is down copy that app's built stylesheet (`scripts/build-fallback-pages.mjs`). Because `/assets/` belongs to the app that is down, the script copies every font file the stylesheet asks for into the fallback folder and points the stylesheet at `/__fallback/fonts/`.

### Content Security Policy

`font-src` and `style-src` in `docker/production/nginx/edge.conf.template` do not allow the Google Fonts hosts. A page that linked Google Fonts again would be blocked in production.

## The display font

The theme's `.text-russo` class sets Russo One, a squared display face with one weight and Latin and Cyrillic letters only (no Bengali). No page uses the class. Where it may be used is decided under `DEC-DISPLAY-FONT` in `pending-decisions.mdx`. Until then, the font is available and never downloaded.
