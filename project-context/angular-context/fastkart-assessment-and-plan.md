# Fastkart Assessment & Adoption Plan (Angular)

> **Status: DECISIONS LOCKED (updated).** This was the original file-grounded assessment; the open decisions in §10 have since been **decided by the owner** and the rest of `angular-context/` (KB, roadmap, Cursor prompt) is reconciled to them. **The concrete build plan now lives in `fastkart-execution-plan.md`** — that file supersedes the §9 wireframe below (which assumed "adopt Fastkart's code"; the final direction is **"Fastkart is a UI reference only; build everything custom; admin first"**). Source of truth = the actual Fastkart files in `vendor/fastkart-responsive-angular-21-ecommerce-template/` (read directly).
>
> **Locked outcome (the reverse of this doc's original lean):** Fastkart is a **UI + behaviour reference ONLY — never forked.** We keep **our** heightened stack for everything (state, auth, routing, env, SEO, i18n, SSR, PWA): **AnalogJS · NgRx hybrid · TanStack Query · Transloco · vite-plugin-pwa/Workbox · Vitest · Reactive/Signal Forms**. We accept from Fastkart only its **look/feel (Bootstrap 5 + ng-bootstrap + SCSS)**, **ApexCharts**, and **angular-eslint** config style. We never drop below Fastkart's standard for any feature.

---

## 0. TL;DR verdict

- **Fastkart is a strong, current, well-architected asset — but we use it as a UI + behaviour _reference_, not a codebase.** It's **Angular 21**, ships **SSR already working**, has a clean layered structure (services / NGXS state / interceptors / resolvers / typed interfaces / guards), and is the **`-rest` variant designed to consume a REST API**. We study it to understand normal e-commerce flows and to replicate its polished look/feel — then we build the actual app to **our** architecture, never forking its code.
- **Decided:** we keep **our** heightened stack for all logic (**AnalogJS, NgRx hybrid, TanStack Query, Transloco, vite-plugin-pwa/Workbox, Vitest, Reactive/Signal Forms**) and accept from Fastkart only its **look/feel (Bootstrap 5 + ng-bootstrap + SCSS)**, **ApexCharts**, and **angular-eslint** style. Fastkart's own choices (NGXS, ngx-translate) are **not** adopted — they were considered and rejected in favour of our stack. The bar runs one way: our implementation must **meet or exceed** Fastkart for every feature.
- **Fastkart is a MULTI-VENDOR grocery/general marketplace** ("FastKart Marketplace: Where Vendors Shine Together"). We **strip the marketplace** (vendors/stores, commission, payouts, withdrawal, vendor-wallet, customer wallet) and the **6 extra demo themes**, keeping the single **Paris** theme and single-store config (Setting + Theme-Options). **Loyalty Points is kept as a future add-on** (UI replicated now; model/API seams reserved).
- **The real work is not the UI — it's: (1) repointing the data layer to our API + reconciling DTOs with `contracts`, (2) the Saha Textile-specific commerce model (design/stitching base option + per-line measurement add-ons, multi-parent taxonomy, status/archival, scoped promotions, INR-canonical multi-currency with gross-up), and (3) full en↔bn translation of BOTH UI chrome and DB content.** Fastkart gives us ~70% of the storefront/admin shell for free; these three are the 30% that's ours.

---

## 1. What Fastkart actually is (verified from files)

| Aspect        | Finding                                                                                                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version       | **Angular 21.0.6** (front + admin), TypeScript 5.9, `@angular/cli` 21 (changelog: 19→20→21 over 2025)                                                                                                                                                                                                |
| Apps          | **`fastkart-front`** (storefront, name `fastkart-front-rest`) + **`fastkart-admin`** — mirrors our storefront/admin split                                                                                                                                                                            |
| Rendering     | **SSR present** — `@angular/ssr` 21, `src/main.server.ts`, `src/server.ts` (Express), admin has `server.ts` + `vercel.json`. Changelog notes "solve ssr issue."                                                                                                                                      |
| Architecture  | Clean & layered: `shared/services` (29 API services), `shared/state` (29 NGXS stores), `core/interceptors`, `core/guard`, `shared/resolvers`, `shared/interface` (typed DTOs), `shared/pipe`, `shared/directive`, `shared/validator`. **This is a genuinely well-structured app, not a flat theme.** |
| Data source   | Services call `${environment.URL}/<entity>.json`. In the demo that's static JSON; in the **`-rest`** variant `environment.URL` points at a REST API. **→ our seam: set `environment.URL` = NestJS API base, return matching shapes.**                                                                |
| State         | **NGXS** (`@ngxs/store` + `storage-plugin` + `logger-plugin`) — cart, product, order, currency, wishlist, compare, auth, account, coupon, etc. (29 stores).                                                                                                                                          |
| Styling       | **Bootstrap 5.3 + @ng-bootstrap/ng-bootstrap** + **SCSS** (`styles.scss` → `public/assets/scss/app.scss`). Not Tailwind.                                                                                                                                                                             |
| i18n          | **@ngx-translate/core** + http-loader. Ships `en.json` + `fr.json` (~454 keys each — UI chrome only).                                                                                                                                                                                                |
| UI libs       | ngx-owl-carousel-o, swiper, ng-select2-component, ngx-image-zoom, ngx-toastr, feather-icons. Admin adds **ApexCharts** (`ng-apexcharts`), `ngx-editor` (rich text), `ngx-dropzone` (uploads).                                                                                                        |
| Lint/format   | **angular-eslint + typescript-eslint + Prettier** (already! matches our tooling).                                                                                                                                                                                                                    |
| Test          | Karma/Jasmine (not Vitest).                                                                                                                                                                                                                                                                          |
| Scope shipped | **Multi-vendor marketplace**, wallet, loyalty points, Q&A, reviews, compare, refunds, 7 homepage themes (Paris/Tokyo/Osaka/Rome/Madrid/Berlin/Denver), theme customizer bar, dark mode. Origin: grocery/bakery, general enough for textile.                                                          |

---

## 2. Fastkart's stack vs our locked baseline — the central reconciliation

This analysed the conflicts between Fastkart's stack and ours; the owner has since **decided**. Final verdicts (**"Ours"** = keep our stack/build custom; **"Fastkart"** = accept Fastkart's choice):

| Concern          | Our stack               | Fastkart ships                        | **DECISION**                          | Note                                                                                                                        |
| ---------------- | ----------------------- | ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Framework        | Angular latest          | Angular 21                            | ✅ **Angular 21**                     | Aligned; target 21 to match Fastkart UI libs                                                                                |
| Meta-framework   | —                       | Angular CLI                           | ✅ **AnalogJS (Ours)**                | Fastkart-as-code is off the table, so we pick the best: Analog (native Vitest + vite-plugin-pwa + server routes)            |
| SSR              | SSR                     | `@angular/ssr` (working)              | ✅ **Analog SSR (Ours)**              | We build our own; Fastkart confirms it's very doable                                                                        |
| **Styling**      | Tailwind+spartan-ng     | **Bootstrap 5 + ng-bootstrap + SCSS** | ✅ **Bootstrap (Fastkart's LOOK)**    | Accept Fastkart's look/feel; **Tailwind + spartan-ng DROPPED.** We replicate the visuals, build the components ourselves.   |
| **Client state** | NgRx                    | NGXS                                  | ✅ **NgRx hybrid (Ours)**             | **NGXS rejected.** SignalStore (feature/UI) + Store/Effects/Entity (cart/orders/offline). Non-negotiable for offline + PWA. |
| **Server state** | @tanstack/angular-query | services + NGXS                       | ✅ **TanStack Query (Ours)**          | **Not dropped.** Owns server fetch/cache + offline catalogue persistence.                                                   |
| **i18n**         | Transloco               | @ngx-translate                        | ✅ **Transloco (Ours)**               | **ngx-translate rejected.** Transloco final.                                                                                |
| PWA              | service-worker          | _none_                                | ✅ **vite-plugin-pwa/Workbox (Ours)** | Best feature set; Analog-native; offline catalogue + cart                                                                   |
| Forms            | Reactive Forms          | Angular forms                         | ✅ **Reactive + Signal Forms (Ours)** | —                                                                                                                           |
| Charts (admin)   | —                       | **ApexCharts**                        | ✅ **ApexCharts (Fastkart)**          | Accept; pin to Fastkart version                                                                                             |
| Lint             | angular-eslint          | angular-eslint                        | ✅ **angular-eslint**                 | Accept Fastkart's config style                                                                                              |
| Test             | Vitest                  | Karma/Jasmine                         | ✅ **Vitest (Ours)**                  | Analog-native; Karma not used                                                                                               |

**Final stack:** Angular 21 + **AnalogJS** (SSR/SSG) + **Bootstrap 5/ng-bootstrap/SCSS (look only)** + **NgRx hybrid** + **TanStack Query** + **Transloco** + **vite-plugin-pwa/Workbox** + **Reactive/Signal Forms** + **ApexCharts** (admin) + **angular-eslint** + **Vitest**. **From Fastkart we take only: look/feel, ApexCharts, lint style, and behavioural intuition.** Everything else — state, auth, routing, env, SEO, i18n, SSR, PWA, data — is **custom to our architecture**, and the KB / roadmap / Cursor prompt are reconciled to this.

---

## 3. Feature inventory — USE / MODIFY / DROP / BUILD-NEW

### ✅ USE largely as-is (the reuse win)

- App shell, layout, header/footer, mega-menu, **Paris** homepage, responsive design, dark mode, theme-option customizer.
- Product **listing/collection** pages (grid/list, sidebar filters, off-canvas filter), product **detail** (gallery, zoom, image swatches, variant selectors, tabs/accordions, sticky add-to-cart, related/cross-sell).
- **Cart, mini-cart, checkout** flow scaffolding; wishlist; compare; coupon field; search box + typeahead UI.
- **Account** area (orders, addresses, profile), **auth** screens (login/register/OTP/forgot/update-password) — repoint to our JWT/OTP API.
- **Blog**, FAQ, CMS pages, breadcrumbs, toasts, loaders, interceptors, guards, resolvers.
- **Admin:** dashboard, data tables, CRUD forms, ApexCharts, rich-text editor, dropzone uploads, role/permission scaffolding.

### 🔧 MODIFY (keep the component, change behavior/data)

- **Data services** (`shared/services/*.ts`): repoint from `*.json` to our REST endpoints; align response shapes to `contracts`.
- **DTO interfaces** (`shared/interface/*.ts`): reconcile with our zod `contracts` (see §4).
- **Currency**: Fastkart has a currency switcher + `currency.state`; rewire to **INR-canonical + backend price recompute + gateway-by-currency + PayPal gross-up** (§7).
- **i18n**: complete the key set + add **bn**; serve localized DB content per active locale (§6).
- **Product detail variant selector**: extend to render the **"No Stitching/No Blouse" base option** first-selected + the **measurement add-on fields** (§5).
- **Category**: extend to **arbitrary-depth multi-parent** taxonomy with materialized-path breadcrumbs (§5).
- **Collection/sidebar filters**: keep Fastkart's grid/list/sidebar/off-canvas UI patterns, but replace hardcoded/demo filters with API-provided facets/counts/ranges from `SearchPort`/Meilisearch and category facet config.
- **Product status**: Fastkart's `status: boolean` → our `published/draft/archived/disabled/discontinued` lifecycle.

### 🗑️ DROP (out of our scope)

- **Multi-vendor / marketplace**: stores/vendors, vendor dashboards, vendor approval (`is_approved`, `store`, `store_id`), "become a seller."
- **Wallet** (`wallet.*`) and the **marketplace/vendor cluster** (Store/Vendor, Commission, Payout-Details, Withdrawal, Vendor-Wallet). _(Loyalty **Points** is NOT dropped — it's a kept future add-on; see BUILD-NEW/FUTURE and the execution plan.)_
- **6 of 7 themes** (keep Paris; remove Tokyo/Osaka/Rome/Madrid/Berlin/Denver) and the grocery-specific demo content.
- **fr** locale demo data (optional — could keep as a bonus, but bn is required; en+bn is the target).
- Any Karma test scaffolding if we standardize on Vitest.

### 🏗️ BUILD-NEW (Saha Textile-specific; Fastkart has no equivalent)

- **Design/stitching variation pattern** with `isBase` "Material Only" + per-line **measurement add-ons** (Shoulder/Waist/Sleeve/Chest) captured per cart line (Reactive Forms).
- **Polymorphic scoped promotions** (global/category/product/variation/**color**/tag/cart; flash/clearance/coupon) — admin builder + storefront resolution display (engine lives in our API).
- **INR-canonical multi-currency** with daily FX cron + PayPal gross-up math + **gateway-by-currency** (INR→CCAvenue, else→PayPal).
- **Arbitrary-nesting multi-parent taxonomy** (materialized path) + admin manager.
- **Product status/archival lifecycle** + bulk archive + storefront/sitemap/search exclusion.
- **SEO**: Product/Offer/BreadcrumbList/FAQPage JSON-LD, hreflang/canonical, sitemap.xml, SEO-safe accordion FAQ.
- **PWA**: vite-plugin-pwa/Workbox + offline cart (`idb`).
- The **NestJS API + hexagonal backend + self-hosted Docker MongoDB 8.3** (entirely ours; Fastkart's demo backend is discarded).

---

## 4. DTO reconciliation — Fastkart interfaces ↔ our `contracts` (zod)

Fastkart's `IProduct` is a Laravel-style, **snake_case, single-language** shape. It already covers a lot: `type` (simple/variable), `variations`/`variants`/`attributes`/`attribute_values`, `categories[]` (multi-category ✓), `price`/`sale_price`/`discount`, `sku`, `stock`/`stock_status`, `meta_title`/`meta_description` (SEO ✓), `tags[]`, `related_products`/`cross_sell_products`, reviews/ratings/Q&A.

**Gaps vs our model:**

1. **No i18n content objects** — `name`/`description` are plain `string`. → Either serve locale-resolved strings from the API per active locale (recommended, least invasive — DTO stays `string`), or widen to `{ en, bn }` and adjust bindings.
2. **No semantic split between attribute, variation, add-on, and bundle option** — Fastkart's Classified mode treats selected Attributes as variation axes. → Keep our canonical option semantics and map Fastkart UI concepts at the edge.
3. **No `isBase` flag / measurement add-ons** — Fastkart variations don't model the "Material Only" base or per-line measurements. → Extend the variation/attribute interface + add named add-on groups and tailoring fields.
4. **`status: boolean`** → our richer status enum + `archivedAt`.
5. **No materialized-path / multi-parent ancestors** on category.
6. **Naming/casing**: snake_case vs our camelCase zod types.

**Strategy (recommended): an anti-corruption mapping layer.** Keep `contracts` (zod) as the canonical API shape. In the API, expose endpoints that return Fastkart-friendly shapes (or add a thin **adapter/mapper** in the storefront's services that maps `contracts` ⇄ Fastkart `interface`). **Do not bend our domain to Fastkart's DTO** — map at the edge. This preserves the hexagonal discipline. Decide per-entity whether to (a) reshape the API response to match Fastkart's interface (fastest for high-overlap entities like product/cart/order) or (b) keep our shape and map in the Angular service (cleaner for entities we're extending heavily). Default: (a) where overlap is high, (b) where we add Saha Textile-specific fields.

---

## 5. The Saha Textile commerce model on Fastkart

- **Option semantics:** Fastkart's Attribute master becomes our reusable option/attribute definition, not the full domain truth. Product upload chooses semantic role per option group: `filter_only`, `variation_axis`, `named_add_on`, or `bundle_component_option`.
- **Display styles:** keep Fastkart's visual renderers as `displayStyle`: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`. Display style is visual only and never decides business behavior.
- **Variable product + design/stitching base:** Fastkart's variant system maps directly only when the option is a true `variation_axis`. Mark the base term (`No Stitching`/`No Blouse`) `isBase: true` and render it first/selected as "Material Only." **Image-swatch variant style fits design swatches perfectly.**
- **Toggle-based axes:** Color, size, fabric, design, waist, liter, etc. are product-specific. They become variation axes only when they change SKU/stock/price row/image/base identity/purchasability; otherwise they remain filter/descriptive.
- **Named add-ons and measurement add-ons:** net-new. Saree-attached blouse design is a named add-on group with default `No Design`, not a saree variation matrix. Add Reactive/Signal Forms groups on the product page for required measurements (Shoulder/Waist/Sleeve/Chest), captured per cart line and snapshotted into the order line.
- **Bundle/composite products:** net-new domain behavior. They may reuse Fastkart display widgets for choices, but inventory/component resolution belongs to our bundle contracts, not Fastkart's Classified matrix.
- **Taxonomy:** Fastkart categories are simpler (parent/child). Extend to arbitrary depth + multi-parent + materialized path; render breadcrumbs from the path; the mega-menu binds to our taxonomy.
- **Category/sidebar facets:** treat Fastkart's filter UI as reusable presentation only. Facet visibility/order/display comes from `categoryFacetConfigs`; listing APIs return products plus facet counts/ranges; arbitrary filter URLs stay `noindex,follow` unless promoted to a curated SEO route/product group.
- **Status/archival:** drive visibility from our status enum; storefront queries, search index, sitemap exclude non-`published`; admin gets a status control + bulk archive.

---

## 6. Full multi-language (the explicit requirement)

**Why the demo only half-translates (verified from code):** Fastkart uses ngx-translate for **UI chrome** (the ~454 `en.json`/`fr.json` keys: menu, buttons, labels) — switching language swaps those. But **product/category content** comes from the backend as **single-language strings** (`IProduct.name`/`description` are `string`), so dynamic content never changes on switch. **This is a content/coverage gap, not a library limit.**

**Our fix (with our locked i18n = Transloco, not Fastkart's ngx-translate):**

1. **Full chrome keys** — every hard-coded UI string is a **Transloco** key from day one (we build custom, so there are no Fastkart hard-coded strings to retro-fit); ship **`en` + `bn`** (drop `fr`). Target 100% chrome coverage.
2. **Localize DB content** — the API returns content for the active locale (from our i18n content objects in Mongo). On language switch, set Transloco's active lang **and** refetch/select localized content. Result: **every letter switches** — chrome via Transloco, content via the API.
3. Locale-prefixed routes (`/en/...`, `/bn/...`) + hreflang/canonical for SEO (§SEO).

---

## 7. Multi-currency reconciliation

Fastkart ships a currency switcher + `currency.state` (display-side conversion). We replace its math with our backend model: **INR canonical → backend recompute per active currency → PayPal gross-up for non-INR → gateway-by-currency (INR→CCAvenue, else→PayPal)**. Keep Fastkart's switcher UI; drive numbers from the API; never trust client math. Daily FX cron (`@nestjs/schedule`) feeds rates.

---

## 8. SSR / SEO status

- **SSR already works** in Fastkart — big head start. We keep it and ensure product/category routes prerender (`status: published` only) or SSR-with-cache (no Angular ISR — mitigations per KB §06).
- **SEO plumbing is net-new:** Title/Meta per route (Fastkart sets `meta_title`/`meta_description` already — wire to Angular `Meta`), Product/Offer/BreadcrumbList/FAQPage **JSON-LD**, **sitemap.xml** (published only), hreflang/canonical, SEO-safe accordion FAQ (keep content in the DOM — Fastkart's accordions must not `@if`-unmount).
- **PWA net-new:** vite-plugin-pwa/Workbox + offline cart.

---

## 9. ~~Proposed strategy — "Adopt the shell, repoint the data"~~ — SUPERSEDED

> ⚠️ **SUPERSEDED by `fastkart-execution-plan.md`.** This section assumed we'd **fork Fastkart's code** and repoint its data. The owner decided the opposite: **Fastkart is a UI reference only — we build everything custom, admin first.** The phases below are retained only as a record of the discarded approach; **do not execute them.** The live plan is `fastkart-execution-plan.md`.

Each phase: **action → example → outcome.** (Historical — discarded.)

### Phase F0 — Land Fastkart in the monorepo

- **Action:** Copy `vendor/.../fastkart-front` → `apps/storefront`, `fastkart-admin` → `apps/admin` (replacing the deleted Next boilerplate per the Cursor migration prompt). Wire each into pnpm/Turbo: rename packages to `@saha-textile/storefront`/`@saha-textile/admin`, align Angular/TS versions, `turbo.json` outputs → `dist/**`, add `@saha-textile/config` eslint. Keep Fastkart's `angular.json`, SSR `server.ts`.
- **Example:** `pnpm --filter @saha-textile/storefront dev` serves Fastkart's Paris storefront on :3000 with SSR; `@saha-textile/admin` on :3001.
- **Outcome:** Both Fastkart apps build & run inside the monorepo, still on demo JSON data. Baseline visual + features intact.

### Phase F1 — Strip to scope

- **Action:** Remove multi-vendor/store, wallet, points, vendor screens; remove 6 non-Paris themes + grocery demo content; trim unused routes/states/services.
- **Example:** Deleting `store.*`, `wallet.*`, `point.*` states/services and the "vendor" routes; mega-menu reduced to Saha Textile taxonomy.
- **Outcome:** A lean single-store, single-theme app — no marketplace surface area to maintain.

### Phase F2 — Repoint the data layer to the NestJS API

- **Action:** Set `environment.URL` to the API base. For each entity, either reshape the API response to Fastkart's `interface` or add a mapper in the Angular service (§4). Repoint auth to our JWT/OTP endpoints via the existing interceptor.
- **Example:** `product.service.ts` GET `${URL}/products?...` returns our `contracts` product; a `toIProduct()` mapper adapts it; the product-list page renders unchanged.
- **Outcome:** Storefront/admin run on **live data from our API + self-hosted Docker MongoDB 8.3** — Fastkart's demo backend fully discarded.

### Phase F3 — Saha Textile commerce model

- **Action:** Implement design/stitching base + measurement add-ons on product detail; arbitrary multi-parent taxonomy + breadcrumbs; product status/archival; scoped-promotion display.
- **Example:** Selecting "No Blouse" shows "Material Only" price; choosing "Design 2" updates price/swatch; Shoulder/Waist inputs append to the cart line; a category page resolves from a 3-level path.
- **Outcome:** The real Saha Textile product/variation/measurement/discount behavior works end-to-end.

### Phase F4 — Full i18n (en + bn)

- **Action:** Complete ngx-translate keys; add `bn.json`; localize DB content per active locale; locale-prefixed routes.
- **Example:** Toggling EN→BN switches **every** label _and_ product titles/descriptions.
- **Outcome:** 100% translation coverage — meeting the hard requirement.

### Phase F5 — Multi-currency + payments

- **Action:** Drive prices from backend (INR canonical + recompute + gross-up); gateway-by-currency; CCAvenue (INR) + PayPal (foreign) behind `PaymentGatewayPort`; FX cron.
- **Example:** Switch to USD → prices recompute server-side with PayPal gross-up; checkout routes to PayPal; INR routes to CCAvenue.
- **Outcome:** Correct money math + correct gateway per currency.

### Phase F6 — SEO + PWA hardening

- **Action:** Title/Meta + JSON-LD + sitemap + hreflang/canonical + SEO-safe accordions; vite-plugin-pwa/Workbox + offline cart; prerender published routes.
- **Example:** Rich Results Test validates Product/Offer; Lighthouse SEO+PWA pass; offline shell loads; sitemap excludes archived.
- **Outcome:** SEO-rich, installable, offline-capable storefront.

### Phase F7 — Admin Saha Textile screens

- **Action:** On Fastkart admin: variable-product builder (attributes→matrix, base flag, add-on config, status/archive), multi-parent taxonomy manager, currency/gateway/markup controls, scoped-promotion builder, order management with captured measurements, content (blog/FAQ/banners), roles + audit log.
- **Example:** Admin builds a variable saree with 3 designs × 3 colors + measurement fields, sets a category-scoped flash sale, edits the USD PayPal markup.
- **Outcome:** Full WooCommerce-replacement admin on the Fastkart base.

**Possible outcome of the whole approach:** ~70% of storefront/admin UI/UX reused from a working Angular 21 template; effort concentrated on the genuinely-ours 30% (data, commerce model, i18n/currency, SEO/PWA, backend). Faster and lower-risk than a fresh build, with no loss of architectural sophistication.

---

## 10. Decisions — RESOLVED

| #   | Decision            | Resolution                                                                                                                     |
| --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Styling             | **Accept Fastkart's look** (Bootstrap 5 / ng-bootstrap / SCSS) — but replicate, don't fork. Tailwind + spartan-ng **dropped.** |
| 2   | Client state        | **NgRx — hybrid** (SignalStore + Store/Effects/Entity). NGXS rejected.                                                         |
| 3   | i18n                | **Transloco.** ngx-translate rejected.                                                                                         |
| 4   | Server state        | **TanStack Angular Query — kept** (not dropped).                                                                               |
| 5   | Meta-framework      | **AnalogJS.** (Angular CLI rejected once Fastkart-as-code was dropped.)                                                        |
| 6   | PWA                 | **vite-plugin-pwa / Workbox.** @angular/service-worker rejected.                                                               |
| 7   | Forms               | **Reactive + Signal Forms.**                                                                                                   |
| 8   | Tests               | **Vitest** (Analog-native). Karma not used.                                                                                    |
| 9   | Charts (admin)      | **ApexCharts** (accept Fastkart).                                                                                              |
| 10  | Build order         | **Admin first**, storefront second.                                                                                            |
| 11  | Fastkart role       | **UI + behaviour reference only — never forked.**                                                                              |
| 12  | fr locale           | Drop; ship **en + bn**.                                                                                                        |
| 13  | UI package versions | **Pin to Fastkart's exact versions** for visual parity (matrix in `fastkart-execution-plan.md`).                               |

**Resolved catalog direction (2026-07-04):** multi-placement category DAG, all five product patterns, toggle-based option semantics, Fastkart display styles separated from business behavior, named add-ons for saree-attached blouse design, self-hosted Meilisearch, self-hosted Docker MongoDB 8.3. Exact launch field labels/validation values can still be refined during Stage B, but these architecture decisions are locked.

All of the above are reconciled into the KB, roadmap, and Cursor prompt. The concrete build steps live in **`fastkart-execution-plan.md`**.

---

## 11. Risks & caveats

- **Bootstrap↔Tailwind is one-way-ish (decided: Bootstrap):** committing to Bootstrap/ng-bootstrap means a later switch to Tailwind would be costly — accepted, since we replicate Fastkart's Bootstrap look.
- **DTO reconciliation is the real effort sink** — Fastkart's Laravel-shaped interfaces differ from our zod contracts; budget time for mappers and for entities we extend (product/category/promotion).
- **Multi-vendor removal must be thorough** — vendor concepts are threaded through product/order/store states; removing them cleanly takes care to avoid dead refs.
- **SSR + our auth/cookies/currency**: validate guest-cart cookie + locale + currency under SSR hydration (no flicker, correct first paint).
- **Fastkart updates:** future Fastkart releases are reference material only. We may inspect them for UI ideas, but our custom apps do not auto-merge vendor code.
- **License:** confirm the ThemeForest license covers this production use (single end-product) — it does for a standard Regular/Extended license, but verify for your distribution model.
