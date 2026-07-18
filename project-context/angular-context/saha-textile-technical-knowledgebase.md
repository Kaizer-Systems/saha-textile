# Saha Textile — Custom E-Commerce Rebuild: Technical Knowledge Base

## TL;DR

- Rebuild the WooCommerce store as a PNPM/Turborepo monorepo with 3 apps (**Angular storefront, Angular admin**, **NestJS-on-Fastify** API) using hexagonal/ports-and-adapters architecture so a MongoDB→Postgres (or any provider) swap touches only one adapter; DigitalOcean Spaces ($5/mo) is confirmed viable. **Database decision:** production uses self-hosted Docker MongoDB 8.3 on the DigitalOcean droplet with a single-node replica set, not MongoDB Atlas. The real store runs **~500–1,000 active products at any time, plus 2,000+ archived/discontinued products (retained but not displayed) and growing**. Still a single-operator boutique (no marketplace/multi-vendor), but a small-to-mid catalog — not a 40-item shop.
- The site's real product pattern is WooCommerce **variable products** where one attribute ("Blouse Designs"/"Salwaar Designs") carries a **"No Stitching"/"No Blouse" base option** plus "Design 1/2/3" priced variations, with Color often acting as filter-only, plus custom tailoring **measurement fields** (Shoulder/Waist/Sleeve/Chest). Model this with product option semantic roles (`filter_only`, `variation_axis`, `named_add_on`, `bundle_component_option`) and Fastkart-style display styles separated from business behavior.
- Infra cost claims mostly hold: GitHub private repos are free, GHCR is free for private images, Actions gives 2,000 free Linux min/mo for private repos; the $24/mo 4 GB droplet is the correct call; use **CCAvenue (not BillDesk)** for INR + **PayPal** for foreign currency, **ExchangeRate-API** for FX, **Shiprocket** for domestic + international shipping.

## Key Findings

### Live site analysis (verified by fetching sahatextile.com)

- The site is a WooCommerce store on the Porto theme (porto47), with a deep multi-level product taxonomy already in place.
- The taxonomy is 3 levels deep: super-category → category → sub-category. Confirmed top-levels: **Saree** and **Dress Materials**.
- Under **Saree**: Pure Silk, Jamdani, Pure Cotton, Semi Silk, Party Wear, Budget Range, Printed — each with 6–11 sub-categories (e.g., Pure Silk → Katan Banarasi, Tussar Banarasi, Kanchipuram, Gadwal, Paithani, Khaddi, Wedding Banarasi, Shehnai Collection, Arni, Georgette).
- Under **Dress Materials**: Cotton Chikankari, Georgette Chikankari, Printed, Banarasi, Embroidered, Party Wear Suits.
- **Critical data observation:** products are assigned to MULTIPLE categories simultaneously already (e.g., "Demo Saree 3" appears under Printed Silks, Pure Silk, Pure Silk-printed, and Semi Silk). This confirms the multi-category requirement is real and in active use.
- The taxonomy has cross-tree inconsistencies (e.g., "Semi Silk" is parented under "pure-cotton" in one URL but has its sub-cats under "semi-silk"), so the new model must NOT hardcode hierarchy depth or parentage — it needs arbitrary nesting.
- Multi-currency is ALREADY present on product pages: a switcher offering USD, INR, EUR, GBP. Prices currently display in USD on the demo.
- The site already uses tags (e.g., "black saree", "red saree", "Wedding Collection") and has a coupon system (VALENTINE25), flash-sale timers, and a newsletter popup ("SUBSCRIBE TO OUR NEWSLETTER … Don't show this popup again").

### The critical product/variation pattern (verified on 2 product pages)

On **Test Product Tailoring** (SKU HSN452756, category Cotton Jamdani):

- One variable product with attribute **"Blouse Designs"**: Blouse Design 1, Blouse Design 2, Blouse Design 3, **No Blouse** (each design has its own swatch image; "No Blouse" = the base cloth/material-only option).
- Price range shown: $21.60 – $27.60 (each design variation has a different price).
- Custom tailoring measurement input fields: **Shoulder, Waist, Sleeve** (free-text/numeric inputs, not variations).
- Tags: black saree, red saree, Wedding Collection.

On **Salwaar 002** (SKU SKU75789-1, category Dress Materials):

- Attribute **"Salwaar Designs"**: No Stitching, Salwaar Design 1–4 (each with swatch image; "No Stitching" = base/material-only).
- Second attribute **"Color"**: Black, Red, White.
- Price range: $12.00 – $21.00.
- Custom tailoring fields: Shoulder, Waist, Sleeve, Chest.

This is the exact "No Design / Material Only" + "Design 1/2/3 at different prices" pattern. In WooCommerce this is a **variable product** with a "design" attribute whose terms include a base ("No Stitching"/"No Blouse") and several designs, each generating a variation row with its own price/SKU/image, optionally crossed with Color, plus add-on measurement fields (from a product-add-ons plugin, stored separately from variations). WooCommerce serializes all variation rows into the `data-product_variations` attribute on `form.variations_form`; our schema below mirrors that shape natively.

## Details

---

## 00 — Project Overview

**Business:** Saha Textile (sahatextile.com) — a Kolkata/West Bengal saree & textile retailer specializing in Bengali weaves (Jamdani, Banarasi, Muslin), plus dress materials/salwaar. Single-operator boutique.

**Catalog scale (corrected — do not design for "40 products"):** The live demo shows ~30–40 SKUs, but the production store will hold, at steady state (6–8 months post-launch), **~500–1,000 _active_ products at any given time**, plus **2,000+ _archived/disabled_ products that grow continuously**. "Archived/disabled" = discontinued items that **do not display on the storefront** but are **retained in the database** (needed for historical order integrity, analytics, and possible re-listing); a bulk-purge policy is deferred to after launch. This means: design every storefront query, search index, sitemap, and pagination path to filter on product `status` from day one, and size the DB/search/infra for low-thousands of documents — not for 40.

**Goal:** Replace the WooCommerce/WordPress stack with a fully custom, modern, fast, SEO-rich, multi-currency, multi-language, PWA storefront + custom admin + API, preserving the existing taxonomy and the design/stitching variation pattern, and making discounts/offers applicable at any level.

**Scope discipline:** This is a single-operator boutique with a **small-to-mid catalog (hundreds–low-thousands of active SKUs, thousands more archived)**. Build a clean, complete feature set (cart, wishlist, search, filtering, reviews, orders, offers) but deliberately avoid Amazon/Flipkart-scale complexity (no marketplace, no multi-vendor, no warehouse management, no recommendation ML). Favor simplicity and maintainability — but **do not under-build search, pagination, indexing, or DB sizing on a "40 products" assumption**; those must hold for low-thousands of documents.

**Three deployable apps:** (1) Storefront (**Angular + Analog SSR/SSG**, public, PWA); (2) Admin panel (**Angular + Analog**, private — **built first**); (3) API (NestJS-on-Fastify). The owned **Fastkart Angular 21 template** is a **UI + behaviour reference only** (never forked) for apps (1) and (2) — see the Fastkart assessment + execution plan in `angular-context/` and §04/§05.

---

## 01 — Tech Stack and Rationale

> **STACK SWITCH — React/Next.js → Angular (FINAL, decisions locked).** The original plan (kept verbatim in `nextjs-context/`) used React 19 + Next.js 16. This `angular-context/` version replaces the **two frontend apps only** with Angular; the backend, contracts, domain, adapters, DB, infra, payments, shipping, FX, auth and the whole hexagonal architecture are **unchanged**. NestJS (the API) is itself Angular-architected (modules + DI + decorators), so Angular front + NestJS back is a _tighter_ pairing than React + NestJS.
>
> **Fastkart's role (decided):** Fastkart is a **UI + behaviour reference ONLY — not a codebase, not an architectural baseline.** We do **not** fork its code. We build fresh Angular apps to our own architecture and **replicate Fastkart's look/feel, pages, modals, notifications** faithfully. Fastkart sets a **minimum** bar for both visuals and feature-completeness that **we never drop below** — for every feature, our implementation must meet or exceed what Fastkart already ships. Borrowed **UI packages are pinned to Fastkart's exact versions** for visual parity (see the Fastkart execution plan).

| Layer             | Choice (Angular stack — FINAL)                                                                       | Note                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Monorepo          | PNPM workspaces + Turborepo                                                                          | ✅ Unchanged; `turbo prune` enables per-app Docker builds                           |
| Meta-framework    | **AnalogJS** (Angular-on-Vite) — both apps                                                           | ✅ Native Vitest, vite-plugin-pwa/Workbox, file-routing + server routes             |
| Storefront        | **Angular (latest) + Analog SSR/SSG**                                                                | ✅ SSR + hydration + prerender for SEO; built custom, Fastkart UI as ref            |
| Admin             | **Angular (latest) + Analog** (SPA; SSR optional)                                                    | ✅ Private app; built custom, Fastkart `fastkart-admin` UI as ref — **BUILT FIRST** |
| API               | **NestJS with Fastify adapter**                                                                      | ✅ Unchanged — see below                                                            |
| Styling           | **Bootstrap 5 + ng-bootstrap + SCSS** (Fastkart's UI idiom)                                          | ✅ Accept Fastkart look/feel; Tailwind/spartan-ng **dropped** from frontend         |
| Client state      | **NgRx — hybrid**: SignalStore (feature/UI) + Store/Effects/Entity (cart, orders, offline catalogue) | ✅ Non-negotiable; powers offline catalogue + PWA                                   |
| Server state/data | **`@tanstack/angular-query-experimental`** (ours)                                                    | ✅ Owns server fetch/cache + offline persistence (`persistQueryClient`+idb)         |
| DB                | Self-hosted Docker MongoDB 8.3, single-node replica set                                              | ✅ Engine retained; Atlas removed from launch plan                                  |
| Media             | DigitalOcean Spaces (S3-compatible)                                                                  | ✅ Unchanged                                                                        |
| i18n              | **Transloco** (runtime, full per-key en↔bn)                                                          | ✅ FINAL — every string switches; not ngx-translate (see §06)                       |
| Search            | **Self-hosted Meilisearch** behind `SearchPort`                                                      | ✅ Typesense remains a future swappable adapter                                     |
| PWA               | **vite-plugin-pwa / Workbox** + `idb`                                                                | ✅ Best feature set (offline catalogue + offline cart); Analog-native               |
| Forms             | **Angular Reactive Forms + Signal Forms** (typed)                                                    | ✅ Reactive typed forms now; adopt Signal Forms as they stabilise (v21+)            |
| HTTP              | **Angular `HttpClient`** + interceptors                                                              | ✅ Auth-token refresh interceptor                                                   |
| Charts (admin)    | **ApexCharts** (`ng-apexcharts`)                                                                     | ✅ Accept Fastkart's choice; pin to Fastkart's version                              |
| Lint              | **angular-eslint** + typescript-eslint + Prettier                                                    | ✅ Accept Fastkart's config style; in `packages/config` flat config                 |
| Test              | **Vitest** (Analog-native) + Playwright E2E                                                          | ✅ FINAL — Analog ships Vitest natively                                             |

### Fastify vs NestJS-on-Fastify — RECOMMENDATION: NestJS with the Fastify adapter

You asked whether to use plain Fastify or NestJS-on-Fastify for a "modular, layered, swappable architecture." **Use NestJS with `@nestjs/platform-fastify`.** Rationale:

- Your #1 architectural requirement is strict modular, layered, swappable design. NestJS is built around exactly this: modules, dependency injection (DI), and adapters. Plain Fastify imposes no architecture — you'd hand-build DI and module boundaries, which is precisely the toil NestJS removes.
- The Fastify adapter gives you NestJS's structure with Fastify's throughput. Per Pravir Raghu (Medium, "Express vs Fastify vs Nest — what to go with and when"): "a simple benchmark showed that a NestJS app using the Fastify adapter achieved about 50k requests/sec at 200 concurrent connections, compared to only ~17k requests/sec using the default Express adapter… That's nearly a 3× improvement just by switching the HTTP engine." For a catalog of this size this raw number is not a bottleneck, but it means you pay no meaningful performance penalty for the structure.
- NestJS's DI container is the cleanest way to implement the ports-and-adapters/repository pattern you require for DB-swappability. Swapping Mongo→Postgres becomes "bind a different provider to the same interface token."
- Plain Fastify is the better pick only when you want a minimal single-purpose service and will assemble structure yourself — which contradicts your stated goals.
- **Caveat:** As confirmed by the DEV Community 2026 backend comparison, "NestJS v11 ships with Express v5 as its default adapter. You can swap to the Fastify adapter using `@nestjs/platform-fastify`…" — so you must explicitly install/configure the Fastify adapter and audit that any middleware you add has Fastify equivalents.

### Angular meta-framework — DECISION (FINAL): AnalogJS

The storefront needs the same capabilities Next gave us: **SSR, static prerendering, SEO control, clean localized routes**. Two paths exist: **Angular CLI + `@angular/ssr`** (official, config-routing, esbuild builder) vs **AnalogJS** (Angular-on-Vite: file-based routing, server API routes, native Vitest, first-class `vite-plugin-pwa`).

**Decision: AnalogJS, both apps.** The earlier draft of this doc chose Angular CLI **for the single reason of forking Fastkart's CLL codebase**. That reason is gone — **Fastkart is now a UI reference only, not a codebase**, so we build custom and are free to pick the best meta-framework. Three independently-locked choices now point straight at Analog:

1. **Vitest is locked** as the test runner → **native in Analog**; only experimental on Angular CLI.
2. **PWA = vite-plugin-pwa/Workbox is locked** (best feature set for offline catalogue + offline cart) → **first-class in Analog's Vite pipeline**; on Angular CLI it must be hand-wired (custom Workbox `injectManifest`).
3. **SEO/SSG + server routes for a ~500–1,000-page catalogue** → Analog gives **file-based routing + server API routes** out of the box (sitemap, SEO endpoints, webhook re-prerender).

Everything else we locked — NgRx (hybrid), Transloco, TanStack Angular Query, Reactive/Signal Forms, **Bootstrap 5 + ng-bootstrap**, ApexCharts, angular-eslint — is **plain Angular and runs identically under Analog** (Analog _is_ Angular, on Vite).

**Honest costs / verification items:**

- **Maturity:** Analog has a smaller community than Angular CLI. Accepted, given the locked Vitest/Workbox choices and our "heightened standards" stance.
- **Angular 21 + Analog compatibility — CONFIRMED.** Official AnalogJS compatibility table: **Angular `^21.0.0` · AnalogJS latest · Vite `^7.0.0`.** Pin to that triple (matches Fastkart's Angular-21 UI libs).
- **SSR-safety of borrowed UI libs:** `ngx-owl-carousel-o`, `ngx-image-zoom`, `swiper` must be guarded for SSR under Vite (defer to client where they touch `window`). This is true under _any_ SSR setup.
- **ISR gap vs Next** is unchanged (Angular has none); mitigation for ~500–1,000 product pages is in §06 (SSG prerender of published slugs + SSR-with-cache + webhook re-prerender via Analog server routes).

---

## 02 — Monorepo and Layered/Swappable Architecture

### Repo layout

```
saha/  (pnpm workspace, Turborepo)
├─ apps/
│  ├─ admin/         (Angular + Analog — BUILT FIRST; custom, Fastkart admin UI as reference)
│  ├─ storefront/    (Angular + Analog SSR/SSG, PWA — custom, Fastkart front UI as reference)
│  └─ api/           (NestJS-on-Fastify)
├─ packages/
│  ├─ core-domain/        (entities, value objects, use-cases, PORT interfaces — zero infra deps)
│  ├─ adapters-db-mongo/  (Mongoose/native driver implementing repository ports)
│  ├─ adapters-storage-spaces/  (S3 client implementing StoragePort)
│  ├─ adapters-payments/  (CCAvenuePort impl, PayPalPort impl)
│  ├─ adapters-shipping/  (ShiprocketPort impl)
│  ├─ adapters-fx/        (ExchangeRateApiPort impl)
│  ├─ ui/                 (shared Angular library: our reusable Bootstrap 5 + ng-bootstrap components, built to replicate Fastkart's look)
│  ├─ config/             (eslint+angular-eslint, tsconfig, SCSS/Bootstrap preset — no Tailwind)
│  └─ contracts/          (shared DTOs / zod schemas / OpenAPI types — consumed by Angular too)
├─ vendor/
│  └─ fastkart-responsive-angular-21-ecommerce-template/
│     ├─ fastkart-front/   (Angular 21 storefront — UI + behaviour REFERENCE ONLY, never forked)
│     ├─ fastkart-admin/   (Angular 21 admin — UI + behaviour REFERENCE ONLY, never forked)
│     └─ documentation/    (Fastkart's own docs)
└─ turbo.json
```

### Hexagonal / ports & adapters (the swappability mechanism)

- **Core (`core-domain`)** holds business logic and depends on NOTHING external. It defines **ports** (TypeScript interfaces): `ProductRepository`, `OrderRepository`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort`.
- **Adapters** are concrete implementations at the edges (`adapters-db-mongo`, `adapters-payments`, etc.). Each implements a port.
- The dependency rule: all arrows point inward. The core never imports an adapter; NestJS DI injects the chosen adapter at composition time.
- **Concrete swap example (MongoDB → PostgreSQL):** Write a new `adapters-db-postgres` package implementing the same `ProductRepository`/`OrderRepository` interfaces. Change one DI binding in the API's composition module. The core domain, use-cases, controllers, storefront, and admin are untouched — switching DB is "a repository adapter rewrite, not an application rewrite."
- **DTOs / mapping:** Adapters map between the persistence shape and domain entities. Never leak Mongoose documents or SQL rows into the core. Use `contracts` (zod schemas) as the single source of truth for API request/response shapes, shared by all three apps.
- **JSONB mapping note:** Your flexible product structure is stored as native sub-documents in MongoDB. If swapped to PostgreSQL, the same nested object maps cleanly to a `JSONB` column. Keep relational-worthy fields (id, slug, price, status, category refs) as indexed first-class columns and keep the variable/attribute blob in the JSON document/JSONB column. This is why the **domain entity — not the DB shape — must be the contract.**

---

## 03 — Data Model

### Taxonomy (arbitrary nesting + multi-placement)

Use a category node collection plus a `categoryPlacements` model. The node stores category identity; placements store one canonical path plus optional extra merchandising placements. This is a multi-placement DAG, not a strict single-parent-only tree. It matches the live Woo reality while letting us clean junk terms on import.

Category node shape:

```jsonc
// categories collection
{
	"_id": "cat_pure_silk",
	"name": { "en": "Pure Silk", "bn": "..." }, // i18n object
	"slug": "pure-silk",
	"status": "active",
	"isBannerCollection": false, // collections vs strict taxonomy
	"displayOrder": 10,
	"seo": { "title": {}, "description": {} },
	"media": { "bannerImage": "spaces://..." },
}
```

Placement shape:

```jsonc
// categoryPlacements collection
{
	"_id": "place_pure_silk_main",
	"categoryId": "cat_pure_silk",
	"parentPlacementId": "place_saree",
	"pathSlugs": ["saree", "pure-silk"],
	"ancestorCategoryIds": ["cat_saree"],
	"isCanonical": true,
	"sortOrder": 10,
	"status": "active",
}
```

- Products reference categories via an array (`categoryIds: [...]`) so one product can live under many categories/collections simultaneously — matching the live site's behavior.
- Support both strict taxonomy nodes and "collections" (Wedding Collection, Best Sellers, New Arrivals) via a `type`/`isBannerCollection` flag, or a separate `collections` collection for clean separation.

### Product + variation schema (JSONB-style, models the design/stitching pattern)

```jsonc
// products collection
{
	"_id": "prod_5557",
	"type": "variable", // simple | variable
	"sku": "SKU75789-1",
	"title": { "en": "Salwaar 002" },
	"slug": "salwaar-002",
	"description": { "en": "..." },
	"categoryIds": ["cat_dress_materials"],
	"tags": ["black-salwaar", "red-salwaar"],
	"basePriceINR": 1200, // canonical price always in INR
	"media": { "gallery": ["spaces://saree-12-2.jpg"] },

	"attributes": [
		{
			"code": "design",
			"label": { "en": "Salwaar Designs" },
			"semanticRole": "variation_axis",
			"displayStyle": "image_swatch",
			"terms": [
				{ "code": "no-stitching", "label": { "en": "No Stitching" }, "isBase": true, "swatch": "spaces://..." },
				{ "code": "design-1", "label": { "en": "Salwaar Design 1" }, "swatch": "spaces://salwaar1.webp" },
				{ "code": "design-2", "label": { "en": "Salwaar Design 2" }, "swatch": "spaces://salwaar2.jpg" },
			],
		},
		{
			"code": "color",
			"label": { "en": "Color" },
			"semanticRole": "filter_only",
			"displayStyle": "color_swatch",
			"terms": [
				{ "code": "black", "label": { "en": "Black" }, "hex": "#000000" },
				{ "code": "red", "label": { "en": "Red" }, "hex": "#cc0000" },
				{ "code": "white", "label": { "en": "White" }, "hex": "#ffffff" },
			],
		},
	],

	"namedAddonGroups": [
		{
			"code": "blouse-design",
			"label": { "en": "Blouse Design" },
			"displayStyle": "image_swatch",
			"requiredSelection": true,
			"defaultTermCode": "no-design",
			"terms": [
				{ "code": "no-design", "label": { "en": "No Design" }, "priceDeltaINR": 0 },
				{
					"code": "design-1",
					"label": { "en": "Design 1" },
					"priceDeltaINR": 500,
					"requiresMeasurements": true,
				},
			],
		},
	],

	"variations": [
		{
			"id": "var_1",
			"attributes": { "design": "no-stitching" },
			"priceINR": 1200,
			"salePriceINR": null,
			"sku": "SKU75789-1-NS-BLK",
			"stock": 5,
			"image": "spaces://saree-12-6.jpg",
		},
		{
			"id": "var_2",
			"attributes": { "design": "design-1" },
			"priceINR": 2100,
			"sku": "SKU75789-1-D1-BLK",
			"stock": 3,
			"image": "spaces://salwaar1.webp",
		},
	],

	"addons": [
		{ "code": "shoulder", "label": { "en": "Shoulder" }, "type": "number", "unit": "in", "required": false },
		{ "code": "waist", "label": { "en": "Waist" }, "type": "number", "unit": "in" },
		{ "code": "sleeve", "label": { "en": "Sleeve" }, "type": "number", "unit": "in" },
		{ "code": "chest", "label": { "en": "Chest" }, "type": "number", "unit": "in" },
	],

	"relatedProductIds": [],
	"crossSellIds": [],
	"upsellIds": [],
	"seo": { "title": {}, "description": {}, "jsonLd": "auto" },
	"ratingsSummary": { "avg": 0, "count": 0 },
	"status": "published", // published | draft | archived | disabled | discontinued — see lifecycle note
	"archivedAt": null, // set when status flips to archived/discontinued; used by purge policy later
	"createdAt": "...",
	"updatedAt": "...",
}
```

Key decisions:

- **Canonical price is always INR.** All other currencies are derived at request time (section 06). Never store per-currency prices except the INR source of truth.
- The "No Stitching"/"No Blouse" base is a term flagged `isBase: true` — the storefront renders it first/selected by default as "Material Only."
- Product option behavior is chosen per product through `semanticRole`: `filter_only`, `variation_axis`, `named_add_on`, or `bundle_component_option`.
- Fastkart's option UI styles are retained as visual-only `displayStyle` values: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`.
- Color, size, fabric, design, waist, liter, etc. are not globally variation-driving. They create variants only when explicitly marked `variation_axis` for that product.
- Measurement fields are `addons`, captured per cart-line, NOT variations (otherwise the combination matrix explodes).
- A standalone blouse product may use `Blouse Design` as a variation axis. A saree with an attached blouse piece keeps the saree as the base product; `Blouse Design` is a named add-on group with default `No Design`, optional price/media, and required measurements for stitched choices.
- True bundle/composite products are first-class seams for products that consume separate inventory/components as kits; they are not the same as cross-sell/bought-together displays.
- **Product lifecycle / archival (catalog runs to low-thousands of docs).** `status` drives visibility: `published` = live on storefront; `draft` = admin-only WIP; `archived`/`disabled`/`discontinued` = **removed from all storefront surfaces (listing, search index, sitemap, related/cross-sell) but retained in the DB**. Why retain: historical orders snapshot the product but still reference its id for re-display, returns, and analytics; an item may also be re-listed seasonally. Indexing: keep a compound index on `{ status, categoryIds }` and `{ status, updatedAt }` so the ~500–1,000 active set is queried without scanning the 2,000+ archived rows. **A discontinued product's old URL should return HTTP 410 Gone (or 301-redirect to its category)** — not a soft 404 — for SEO hygiene. A bulk-purge/cold-archive policy for very old disabled products is **deferred to post-launch** (e.g., move to a `products_archive` collection or cold storage once order-retention windows expire).

### Discounts / offers (applicable at ANY level)

A single polymorphic `promotions` collection with a `scope` discriminator:

```jsonc
{
	"_id": "promo_flash1",
	"name": "Valentine Flash",
	"type": "percentage",
	"value": 25,
	"scope": "category", // global | category | product | variation | color | tag | cart
	"targetIds": ["cat_saree"], // for color scope: ["red"]
	"couponCode": "VALENTINE25", // null = automatic
	"kind": "flash_sale", // flash_sale | clearance | upsell | cross_sell | offer
	"stackable": false,
	"priority": 10,
	"startsAt": "...UTC",
	"endsAt": "...UTC",
	"conditions": { "minCartINR": 0, "firstOrderOnly": false },
}
```

- The resolution engine runs in the API (backend) at price-calculation time, computed on INR first. A "color-level" discount matches the variation's `attributes.color`.
- Cross-sell/upsell modeled as product relationships (`relatedProductIds`, `crossSellIds`, `upsellIds`).

### Other collections

- **currencies**: `{ code:"USD", symbol:"$", enabled:true, rateFromINR:0.012, paypalActive:true, paypalPct:0.044, paypalFixed:0.30, updatedAt }` — admin-editable.
- **orders**: line items snapshot product+variation+addons+resolved prices in BOTH INR and the paid currency, gateway used, shipping quote (value + currency), promotions applied, status timeline.
- **users**: multiple auth identities, addresses, guestCartId linkage, GDPR consent record + timestamp.
- **carts**: server-side persistent carts keyed by userId or guest token (cross-device + guest→login merge).
- **shippingQuotes** (cached), **fxRateHistory** (audit), **reviews**, **wishlists**, **newsletterSubscribers**.
- **Future add-on seam — loyalty/reward points (design now, build later):** reserve the model for a `points` concept — per-user `pointsBalance`, a `pointsLedger`/`pointsTransactions` collection (earn/redeem entries referencing orders), and earn/redeem rule config (admin-editable). Orders should be able to carry a points-earned and points-redeemed amount. Not built at launch, but the schema, API DTOs (`contracts`), and admin UI should leave clean seams so it switches on without a migration. (Admin Points page is replicated in the UI now — see Fastkart execution plan.)

---

## 04 — Storefront Spec (custom Angular/Analog · Fastkart UI reference · built AFTER admin)

**Approach (Angular — FINAL):** Build `apps/storefront` **fresh, to our architecture** (Analog + SSR/SSG, NgRx hybrid, TanStack Query, Transloco, Bootstrap 5/ng-bootstrap). **Fastkart `fastkart-front` is a UI + behaviour reference ONLY — never forked.** We replicate its look/feel (layout, product cards, gallery, mega-menu, mini-cart, modals) and use its files to understand normal e-commerce flows, then implement the actual functioning to our conventions, structure, and quality — never below Fastkart's standard for any feature. The storefront is built **after** the admin (see §05 / the Fastkart execution plan). Pin any borrowed UI packages to Fastkart's exact versions for visual parity.

**Mandatory changes vs the Fastkart theme:**

- URL structure: clean, localized, SEO-driven routes — `/{locale}/product/{slug}`, `/{locale}/c/{category-path}` via the Angular Router (locale-prefixed). Real breadcrumbs from the materialized path.
- **Remove Algolia.** **Catalog-scale + requirements correction:** with **~500–1,000 active SKUs** (not 40) and a hard requirement for rigorous fuzzy search — predictions, spelling-mistake tolerance, commonly/most-searched, placeholder searches, on-the-go typing (typeahead), and **translatory + transliteral search across English/Bengali** — plain `$text`/regex is no longer adequate, and Algolia/paid tiers are off the table (zero search budget). **Locked primary: self-hosted Meilisearch on the droplet** behind `SearchPort`; Mongo is source of truth and Meilisearch is a rebuildable derived index. Full feature surface exists from day one: typo tolerance, aliases, Bengali/transliteration dictionary, suggestions, no-result analytics, and admin dictionary tuning. Note: self-hosting search adds RAM pressure on the droplet (see infra sizing). Index **only `status: published`** products; reindex on product create/update/status-change.
- **Collection/category filters:** replicate Fastkart's left-sidebar/off-canvas filter UX, but drive it from API facets, not hardcoded UI arrays. Each category/placement has facet config deciding which filters appear, order, labels, display style, count visibility, collapsed state, and mobile/desktop visibility. Listing requests return `items + facets + counts/ranges + SEO` through `SearchPort`/Meilisearch. `filter_only` product data is eligible for filters; it is not automatically public on every sidebar.
- Add **full** multi-language (**Transloco**, section 06) and multi-currency (section 06). **Critical:** Fastkart's demo only translates _part_ of the UI on language switch — for us, **every** visible string must switch en↔bn, so all Fastkart hard-coded strings get extracted into Transloco translation keys.
- Add GDPR/UK/EU + global cookie consent (sections 06/08).

**Cart state (persistence across sessions AND devices, guest→merge):**

- Client: **NgRx hybrid** — cart lives in a classic **NgRx Store + Effects + Entity** slice (instant UI, persisted/rehydrated for offline), while feature/UI state uses **SignalStore**. Hydrated from server.
- Server: persistent `carts` collection. Guest carts keyed by an httpOnly cookie token; on login, merge guest cart into the user cart (sum quantities, dedupe by variation+addons signature), then delete the guest cart — giving cross-browser/cross-device continuity.
- **`@tanstack/angular-query` mutations** sync line changes to the API with optimistic updates. Boundary: **TanStack Query owns server data** (fetch/cache, + offline persistence of fetched public catalogue via `persistQueryClient` + IndexedDB/`idb`); **NgRx owns app/cart/UI state**. IndexedDB is browser-side storage only, not a backend database; MongoDB/server cart remains the source of truth.

**PWA (fully offline-capable, installable — offline _catalogue browsing_ + offline cart):**

- Use **`vite-plugin-pwa` (Workbox)** — Analog-native, full Workbox feature set. Precache the app shell; runtime strategies: network-first for product/data API, cache-first for static assets/images; **background sync** for queued offline cart mutations; offline fallback route at `/offline`.
- Use browser-side storage in two layers: **Cache Storage/service worker** for app shell, static files, images, and cacheable HTTP responses; **IndexedDB** (via **`idb`**) for structured public catalogue data, TanStack Query persisted cache, and pending offline cart mutations. IndexedDB works for normal website visits too; installing the PWA is not required.
- Offline catalogue browsing means showing **previously fetched/cached public catalogue data only**, not downloading or guaranteeing the whole live catalogue offline. Do not store auth tokens, refresh tokens, payment data, admin data, account/order PII, or secrets in IndexedDB/Cache Storage/localStorage/service worker caches.
- Provide a storefront/account privacy action such as **Clear local/offline data on this device**. Browser storage can also be cleared by the user's browser settings, private browsing, quota pressure, or strict privacy settings, so the app must degrade gracefully and refetch when online.
- Enable the SW only in production builds (avoid dev cache-hell). Capability floor: must meet or exceed what Fastkart ships for any offline feature (Fastkart ships no PWA, so this is net-new and unconstrained upward).

**Analytics instrumentation (events to emit):**

- Abandoned cart (items, no checkout within N hours) and "still-not-purchased" reminders — driven by cart timestamps + a scheduled job.
- Guest-cart-attach-after-login event.
- Newsletter subscribe popup (with "don't show again" suppression, mirroring current site).
- Funnel: view_item, add_to_cart, begin_checkout, purchase. Pipe to a privacy-respecting endpoint (self-hosted Plausible/Umami recommended for GDPR simplicity, gated behind consent).

**Feature set (appropriately scoped):** cart, wishlist, search + configurable facets (category, price, color, tag, fabric, sale/featured, rating bucket, stock and coarse shipping eligibility as category-appropriate), reviews/ratings, order history, address book, offers/coupons, flash-sale countdowns, related/cross-sell, newsletter. NOT building (launch): marketplace, multi-vendor, complex returns RMA portal (keep returns as a simple email/manual workflow). **Loyalty/reward points — PLANNED FUTURE ADD-ON (not built at launch):** the admin UI for Points is replicated now, and the **data model + API must reserve seams for it** (a `points`/loyalty concept: per-user balance, earn/redeem rules, points lines on orders) so it can be switched on later without schema churn. Design for it; don't build the engine yet.

---

## 05 — Admin Panel Spec (custom Angular/Analog · Fastkart UI reference · BUILT FIRST)

**Approach (Angular — FINAL):** **The admin is built FIRST.** Build `apps/admin` **fresh, to our architecture** (Analog, NgRx hybrid, TanStack Query, Transloco, Bootstrap 5/ng-bootstrap, ApexCharts, ngx-editor, ngx-dropzone — UI libs pinned to Fastkart's versions). **Fastkart `fastkart-admin` is a UI + behaviour reference ONLY — never forked.** We **replicate every admin page, sub-page, modal, popup, and notification exactly as Fastkart looks** (except **wallet**, and under the "Store Front" menu keep **Theme Options**, drop **Themes**), but implement each with our reusable, highly-structured architecture and conventions — applying the same level of polish Fastkart ships as a pro theme, without inheriting its code. **Phase 1: build the full admin UI with dummy data/forms/modals.** **Phase 2:** revisit sahatextile.com, finalize the DB collections, then wire each page to real data (adding/removing fields per the finalized model). Forms via **Reactive + Signal Forms**. Full detail in the Fastkart execution plan (`angular-context/fastkart-execution-plan.md`).

**Must replace WooCommerce admin functions:**

- Product CRUD with the option builder: define reusable option definitions, choose semantic role (`filter_only`, `variation_axis`, `named_add_on`, `bundle_component_option`), choose visual display style, auto-generate the variation matrix only for `variation_axis`, configure named add-on groups and measurement fields, set base/default terms such as `No Stitching` or `No Design`, edit per-variation price/SKU/stock/image, **and a `status` control (published/draft/archived/disabled/discontinued) with bulk archive** (catalog runs to thousands of rows — see §data-model lifecycle).
- Category/collection manager: drag-reorder, arbitrary nesting, multi-parent assignment, banner images, SEO + i18n fields, and per-category/per-placement facet configuration for public sidebar/off-canvas filters.
- **Currency controls:** add/remove currencies, toggle enabled, manually edit a rate, set which gateway each currency uses (INR→CCAvenue, others→PayPal), and edit the **PayPal commission % + fixed fee** used in markup math (per-currency).
- **Pricing/offers:** create promotions at any scope (global/category/product/variation/color/tag/cart), flash sales with UTC start/end, clearance, coupons, cross-sell/upsell linking.
- Order management: status workflow, view captured measurements, shipping label/quote, refunds.
- Content: saree blog editor, FAQ manager (feeds SEO-safe accordions), homepage banners.
- Roles: admin + staff; audit log of changes.

---

## 06 — SEO, i18n, and Multi-Currency Architecture

### SEO (2026 best practices for Angular e-commerce)

- **Rendering strategy (Angular + Analog):** Use **Analog SSG/prerender** (built on `@angular/ssr`) for product and category pages (they change rarely) — prerender enumerates **only `status: published` slugs** (archived products get no page). Use **SSR** for cart/account/search. **ISR gap:** Angular has no built-in incremental static regeneration, so for ~500–1,000 product pages choose one of: **(a)** SSR for product pages + HTTP caching at **Nginx `proxy_cache`/CDN** (a few minutes' TTL) so repeat hits are instant and edits appear after TTL; **(b)** webhook-triggered **selective re-prerender** of just the changed product — clean with an **Analog server route** receiving the admin-save webhook; or **(c)** full re-prerender on deploy (≈1,000 pages builds in well under a minute — acceptable for a boutique cadence). Recommend **(a) for freshness + (c) on deploy**. All three maximize Core Web Vitals.
- **Metadata:** Angular **`Title` + `Meta` services** (`@angular/platform-browser`) set per route (in a resolver or component `ngOnInit`), rendered server-side by `@angular/ssr`. Localized titles/descriptions/OG/Twitter. (This is the manual-but-equivalent counterpart to Next's `generateMetadata`.)
- **Structured data (JSON-LD):** Emit `Product` + `Offer` (price, priceCurrency, availability), `BreadcrumbList`, `Organization`, and `FAQPage`. Note: Google added the FAQ-rich-result deprecation notice on **May 7, 2026** (Search Engine Land: "Google will no longer support FAQ rich results as of May 7, 2026… dropping the FAQ search appearance, rich result report, and support in the Rich Results Test in June 2026… support in the Search Console API removed in August 2026"). Keep FAQPage schema anyway — it still aids AI Overviews/AEO and costs nothing — but don't expect the legacy snippet.
- **hreflang + canonical:** For each localized route emit `<link rel="alternate" hreflang="...">` for every locale + `x-default`, plus a self-referencing canonical (via the Angular `Meta`/`DOCUMENT` link injection in SSR). Always-prefix locale routes (`/en/…`, `/bn/…`) for clean, unambiguous URLs (best for SEO).
- **Sitemaps:** Generate `sitemap.xml` including all **published** products, categories, blog posts, with locale alternates — via a **build-time Node script** or a **NestJS API route** (Angular has no `app/sitemap.ts` equivalent). Exclude archived/discontinued URLs. Submit to Search Console.
- **SEO-safe accordion FAQ pattern (critical):** Content MUST be in the initial server-rendered HTML/DOM even when collapsed — Google indexes collapsed accordion content at full weight under mobile-first indexing, but ONLY if it's in the DOM on first load (not fetched via JS/AJAX on click). Implementation (Angular): render all answers server-side; collapse visually with CSS (`hidden` attribute / height animation) using real `<button>` toggles with proper ARIA (`aria-expanded`, `aria-controls`); do **NOT** use `*ngIf`/`@if` to remove answers from the DOM (that unmounts them, like React conditional render) — keep them in the template and hide with CSS; do NOT lazy-fetch on expand. This satisfies both accessibility and crawlability. (ng-bootstrap's accordion can be used as long as collapsed content stays in the DOM — disable any lazy/destroy-on-collapse option.)
- Separate saree **blog** section for content SEO; use tags; internal-link blog→products.

### i18n architecture

- **Library:** **Transloco** (`@jsverse/transloco`) — runtime i18n with lazy-loaded scopes and SSR support. Chosen over `@angular/localize` because `@angular/localize` compiles a **separate build per locale with no runtime switching**, whereas the store needs an **instant in-page language toggle where _every_ string flips en↔bn** (the explicit gap in Fastkart's partial-translation demo). Transloco also matches next-intl's JSON-message DX.
- **Routing:** locale-prefixed Angular routes (`/:locale/...`), a route guard/resolver for locale detection + Transloco active-lang set, and prerender params covering each locale.
- **Translation storage:** Per-locale JSON message files for UI strings (`assets/i18n/en.json`, `assets/i18n/bn.json`) — **every Fastkart hard-coded string must be migrated into these keys**; product/category content translations stored as i18n objects in the DB (as in the schemas). Fallback to default locale for missing keys.
- Start with English + Bengali (the business's home language); add others via admin/JSON as needed.

### Multi-currency mechanics (precise)

**Currencies in DB, admin-editable. Canonical price = INR.**

**FX cron job:**

- **Recommended API: ExchangeRate-API (exchangerate-api.com)** — has a genuinely free "open" tier (no key) that updates once per day, returns INR-based rates, and is widely used for exactly this e-commerce localized-pricing use case. The once-daily update is fine because you refresh once per day.
- **Fallback strategy:** (1) If the primary API fails, retain yesterday's stored rates (never overwrite with nulls). (2) Configure a secondary provider behind the same `FxRatePort` (e.g., frankfurter.app / exchangerate.host) and try it on primary failure. (3) Alert admin if rates are >48 h stale.
- **Schedule:** Run once daily at a low-traffic UTC time, e.g., **00:30 UTC** (06:00 IST), via `@nestjs/schedule` cron (`30 0 * * *`). Fetch INR→{enabled currencies}, write `rateFromINR` for each, overwriting the prior day's value. Keep optional history for audit.

**Currency switch flow (storefront):**

1. User selects a currency; persisted (cookie) and sent to the backend.
2. **Backend recalculates prices before data is returned** (never trust client math): INR canonical → × `rateFromINR` → if currency ≠ INR, add the PayPal commission gross-up (below) → return display prices. For INR, factor = 1, no markup.
3. Active gateway selected by currency: **INR → CCAvenue; any other currency → PayPal.**
4. Page reloads/refetches with new prices.

**PayPal gross-up markup math (so the seller nets the intended INR after PayPal's cut):**
PayPal charges a percentage `p` + fixed fee `f` per international transaction (both admin-editable). To net target `N` (the INR price converted to the foreign currency) after PayPal deducts `p% + f`, charge gross `G`:

```
G = (N + f) / (1 - p)
```

Derivation: PayPal keeps `p·G + f`, leaving `G(1−p) − f`. Set `G(1−p) − f = N` → `G = (N + f)/(1 − p)`.

- Worked example: `N` = $100.00; `p` = 4.4% (0.044); `f` = $0.30 (USD fixed fee). `G = (100 + 0.30)/(1 − 0.044) = 100.30/0.956 = $104.92`. After PayPal's 4.4% + $0.30, the seller nets ≈ $100.00.
- The % and fixed fee MUST be admin-editable per currency (PayPal's fixed fee differs by currency — e.g., $0.30 USD). Note PayPal India's real all-in cost is higher (4.4% + fixed + 3–4% FX-conversion markup + 18% GST on fees); decide in admin whether to also gross-up for the FX-conversion markup or absorb it, and document the policy.

**Shipping + currency interaction:** When a shipping provider returns a cost, capture BOTH the value AND its currency. Convert to display currency via stored rates. Apply the PayPal gross-up to the shipping cost ONLY when the shipment is international (non-INR/PayPal path); for domestic INR shipments (CCAvenue), no markup.

---

## 07 — Payments and Shipping

### Indian gateway: use CCAvenue (not BillDesk) — corrected recommendation

You weren't sure whether the client has BillDesk or CCAvenue. **Recommendation: CCAvenue**, and confirm the client's existing account.

- **Ownership correction (your earlier assumption):** BillDesk is NOT part of PayU — the $4.7 B PayU/Prosus acquisition was **terminated on 3 October 2022**; BillDesk (legal entity IndiaIdeas.com Ltd) remains independent. (Juspay merely supports BillDesk as one routing connector; BillDesk is not "branded under" Juspay.)
- **CCAvenue (Infibeam Avenues):** redirect/hosted billing page, iFrame, or seamless API. Security = **AES-CBC encryption** of the request string with a **Working Key**, plus **Merchant ID + Access Code** (16-byte key → AES-128-CBC, 32-byte → AES-256-CBC). Test endpoint `test.ccavenue.com`, prod `secure.ccavenue.com`. Community npm package **`node-ccavenue`** (encrypt/decrypt helpers) exists; encryption is also reproducible with Node's native `crypto`. Onboarding is self-serve, PAN-based, ~24–48 h after approval; documents: PAN, GSTIN, bank proof/cancelled cheque, business registration, website evaluation.
- **CCAvenue fees (per Techjockey, CCAvenue Pricing & Reviews 2026):** "The Startup Pro plan has no setup fee, while the Privilege plan requires a INR 30,000 setup fee. Transaction fees range from 2.00% for domestic cards to 4.99% for international cards." Per CCAvenue's own press release, the Startup Pro setup fee is zero and the "ASUC (Annual Software Upgradation Charge) amounting to Rs 1,200/- p.a. has been waived off for the 1st year" — i.e., a recurring **₹1,200/yr from year two** (corroborated by Sprintzeal 2026). UPI typically carries nil MDR.
- **BillDesk:** current docs (docs.billdesk.io) use **JWS-HMAC (HS256)** signing with clientid + secretkey; offers Neo (redirect), Ace (SDK), CX+ Deep API (S2S). Onboarding is **RM-mediated (not self-serve), days-to-weeks**, pricing is opaque/quote-based and enterprise-oriented, **requires static public IP whitelisting** (problematic for serverless), and the only Node package (`billdeskjs`) targets the legacy checksum API, not the current JWS API.
- **Why CCAvenue wins for a boutique of this scale on custom Node:** zero setup cost, transparent 2% pricing, fast PAN onboarding, a maintained npm helper, simple AES (no cert exchange), URL (not static-IP) whitelisting. BillDesk is over-engineered (enterprise/BFSI/bill-pay focus).
- **Implementation:** Do all encryption/signing and redirect-response handling in server-side API routes behind a `PaymentGatewayPort`. Never expose the Working Key client-side. Whitelist your redirect/cancel URLs (incl. localhost:port for testing).

### Foreign gateway: PayPal

- Use PayPal for all non-INR currencies. PayPal India is **receive-only for international payments** (domestic INR discontinued April 2021), which fits perfectly: INR→CCAvenue, foreign→PayPal.
- **Fees (for the markup math):** 4.4% + fixed fee per international transaction (fixed fee varies by currency, e.g., $0.30 USD), plus a 3–4% currency-conversion markup and 18% GST on fees; effective all-in cost commonly 5–8% of invoice. Make the % and fixed fee admin-editable.
- **Credentials:** PayPal Business account (KYC: PAN, Aadhaar, business proof, GSTIN if applicable) → developer.paypal.com app → Client ID + Secret → sandbox for testing. Integrate via PayPal REST SDK / Orders v2 behind the same `PaymentGatewayPort`. From Feb 2026, PayPal India provides free automated weekly Digital FIRA (GST/FEMA compliance).

### Shipping

- **Domestic (India): Shiprocket** aggregator. REST API, token-based auth (`apiv2.shiprocket.in/v1/external/auth/login` → bearer token). Serviceability/rate endpoint returns available couriers, cost, and ETD by pincode (`/courier/serviceability`). Set pickup pincode = store; query on customer pincode entry. An npm React widget (`shiprocket-pincode-react`) exists for reference. Provide a flat-rate fallback if no courier is serviceable.
- **International:** Shiprocket has an international serviceability/rate endpoint (Shiprocket X / cross-border). Recommendation: **start with Shiprocket's international API** for a single integration surface; add Delhivery cross-border / DHL / Aramex / FedEx later behind the same `ShippingPort` if rates/coverage demand it.
- **Cost+currency handling:** read the returned cost value AND its currency, convert via stored FX, apply the PayPal gross-up only for international (non-INR) shipments (section 06).
- Put both domestic and international behind one `ShippingPort` with two adapters; choose adapter by destination country.

---

## 08 — Auth and Security

### Auth methods — which cost money (2026)

| Method                  | Cost                         | Notes                                      |
| ----------------------- | ---------------------------- | ------------------------------------------ |
| Email + password        | **Free**                     | argon2id/bcrypt hashing                    |
| Email + email OTP       | **Free**                     | OTP via transactional email free tier      |
| Phone + password        | **Free**                     | Phone is just an identifier; no SMS needed |
| Phone + phone OTP (SMS) | **Costs money**              | SMS gateway required (only paid method)    |
| Google login            | **Free**                     | OAuth app registration                     |
| Facebook login          | **Free**                     | OAuth app registration                     |
| X/Twitter login         | **Effectively paid / avoid** | See below                                  |

- **Your assumption confirmed with one correction:** Only **phone OTP (SMS)** has an unavoidable per-message cost (SMS gateways like MSG91/Twilio charge per SMS; no free programmatic SMS at production scale).
- **email OTP CAN be done for free programmatically** — confirmed. Use a transactional email free tier behind our `EmailPort`: **Resend** (3,000/mo·100/day, API+SMTP) or **MailerSend** (3,000/mo). **LOCKED 2026-07-02: primary = Resend, adapter-swappable, no Brevo** (see `owner-decisions-log.md`). Inbound `@sahatextile.com` mail = **Cloudflare Email Routing (free)**. So keep email OTP — it's free. (Self-hosting SMTP on the droplet is rejected: DO blocks port 25 + poor IP reputation.)
- **Social logins are free to implement** (you pay nothing to Google/Facebook for OAuth login), EXCEPT **X/Twitter**: X removed its free API tier; 2026 pricing is pay-per-use/paid tiers with no real free tier for API access. **Recommendation: drop X/Twitter login** (low ROI for a saree boutique) and offer Google + Facebook. If X login is truly required, note it may incur API costs and added compliance.

**OAuth app registration steps (free ones):**

- **Google:** Google Cloud Console → create project → OAuth consent screen → Credentials → OAuth 2.0 Client ID (web) → authorized redirect URIs → Client ID + Secret.
- **Facebook:** Meta for Developers → create app (Consumer) → add Facebook Login product → Valid OAuth redirect URIs → App Review for `email`/`public_profile` (basic auto-approved) → App ID + Secret.

**Recommendation:** Consider a self-hostable auth layer (Better Auth / Lucia / Auth.js) behind an `AuthPort` so the method set is swappable; store multiple identities per user for the merge-on-login + guest-cart-attach flow.

### Security standards (June 2026)

- **OWASP Top 10:2025** (current as of June 2026; released late 2025, final Jan 2026). Design for:
    - **A01 Broken Access Control** (now includes SSRF) — enforce object-level authorization on every order/cart/user endpoint (BOLA is the #1 API risk).
    - **A02 Security Misconfiguration** (now #2) — harden headers, disable debug endpoints, no default creds.
    - **A03 Software Supply Chain Failures** (new) — lockfiles, `pnpm audit`, Dependabot/Renovate, package verification, pinned base images.
    - **A10 Mishandling of Exceptional Conditions** (new) — fail closed, handle errors without leaking internals.
- **OWASP API Security Top 10** (separate list) — design for BOLA/BOPLA protection, rate limiting, property-level authorization.
- **Concrete controls:**
    - Auth/session: short-lived access tokens + rotating refresh tokens (httpOnly, Secure, SameSite cookies); argon2id hashing; OTP rate-limited + short TTL; lockout/backoff.
    - Input validation: zod schemas at every API boundary (Fastify schema validation doubles as serialization).
    - Rate limiting: `@fastify/rate-limit` on auth, OTP, search, checkout.
    - CORS: allowlist storefront + admin origins only.
    - CSP: strict Content-Security-Policy + HSTS, X-Content-Type-Options, Referrer-Policy (Nginx `add_header` injects these).
    - Secrets: never in images or in browser-exposed config (Angular's `environment.ts` / any `NG_APP_*`-style build var is baked into the client bundle, exactly like Next's `NEXT_PUBLIC_*`); inject at runtime (section 09).
    - Dependency security: automated scanning in CI.
    - PCI scope minimization: CCAvenue hosted/iFrame + PayPal so card data never touches your servers.
- **Cookie consent / GDPR / UK / EU:** global consent banner (granular: necessary/analytics/marketing), block non-essential scripts until consent, store consent + timestamp, provide data export & delete (right to erasure), publish a privacy policy. Use self-hosted/consent-mode-aware analytics (Plausible/Umami) to minimize PII.

---

## 09 — Infrastructure & Deployment (verified cost claims)

### Docker / build

- Three multi-stage Dockerfiles (storefront, admin, api). Use `turbo prune --scope=<app> --docker` to produce a minimal pruned subtree per app, then build — keeps images small and layer-cached.
- Run containers as **non-root** users; set `restart: unless-stopped`; add **healthchecks** per container; set memory/CPU limits.
- Tag images with the **Git commit SHA** (not only `latest`) for deterministic deploys + rollback. `docker/metadata-action` `type=sha` does this automatically.

### Registry: GHCR under org `Kaizer-Systems`

- Push **private** images to `ghcr.io/kaizer-systems/<app>:<sha>`.
- In Actions, authenticate with the built-in **`GITHUB_TOKEN`** + `permissions: { packages: write }` (no PAT needed for pushing).
- On the droplet, pull with a **read-only `read:packages` PAT**. Gotcha: if packages inherit visibility from a private repo, the token may also need `repo` scope — avoid this by setting package visibility independently and granting only `read:packages`.

### Reverse proxy: DECISION — Nginx (owner choice, 2026-06-29)

**Decision: Nginx** (containerized, on the droplet) reverse-proxies the three apps (`sahatextile.com` → storefront, `admin.sahatextile.com` → admin, `api.sahatextile.com` → api), terminates TLS, injects security headers, and fronts static media/CDN origin.

> **Honest framing (the owner asked "is Nginx better no matter the size?"):** No — Nginx is **not** universally better than Caddy. For this exact use case (3 long-running containers, infrequent topology changes) Caddy's **automatic HTTPS** + tiny config is a genuine convenience advantage. The reasons to choose **Nginx anyway** are real and defensible: it's the **most battle-tested, highest-performance, most widely-documented** proxy; it gives **finer control** over caching, rate-limiting, buffering, and header rules; and **the owner already has Nginx experience**, so operational familiarity wins. The trade is more config and **manual cert management**. Net: Nginx is the chosen tool here on the strength of control + familiarity, not because it beats Caddy "at any size."

Nginx setup notes for this stack:

- **TLS / certs:** use **Certbot (Let's Encrypt) with auto-renew** (systemd timer or a `certbot`/`nginx-certbot` companion container) — this is the one piece Caddy would have automated. Wildcard or per-subdomain certs for `sahatextile.com`, `admin.`, `api.`.
- **Config:** one `server {}` block per subdomain, each `proxy_pass` to the container (`proxy_pass http://storefront:3000;` on the Docker network). Set `proxy_set_header Host/X-Forwarded-Proto/X-Forwarded-For`, and `proxy_pass` upgrade headers for any websockets.
- **Security headers:** HSTS, CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` via `add_header` (with the provider CSP allowances for Google/Meta where the OAuth buttons load — see §08).
- **Caching:** Nginx `proxy_cache` can serve the SSR HTML cache layer for product/category pages (the freshness mitigation in §06), and long-cache static assets.
- **Admin app served statically** (if SSR off) directly via Nginx `root`/`try_files`, saving a Node container.
- **HTTP/2** on; HTTP/3 optional (newer Nginx builds).
- **Footprint** ~a few tens of MB; fits the droplet budget.
- Config lives in version control; reload with `nginx -s reload` on deploy.

### Single DigitalOcean Droplet via Docker Compose

- All three app containers + **Nginx** + **self-hosted MongoDB** + **self-hosted Meilisearch** on one droplet, joined by a Docker network (Mongo/Meilisearch bound to the private network only). **Spaces (SGP region) is external** for media/CDN. _(Owner decision 2026-06-29 — Mongo is no longer on Atlas; see owner-decisions-log.)_
- **Droplet sizing — the $24/mo 4 GB tier can launch the 3 app containers + Nginx + MongoDB + Meilisearch, but resource caps and monitoring are mandatory.** Per Better Stack's DigitalOcean Review 2026, a Basic Droplet of "2 vCPU / 4 GB RAM / 80 GB SSD" costs **$24/month** (per Fluence 2026, ~4,000 GiB outbound). The owner decision is to start with this single droplet and keep MongoDB/Meilisearch private on the Docker network. If memory pressure appears, the clean upgrade path is the **8 GB / 4 vCPU droplet (~$48/mo)**; a separate small search/API droplet is a later option. **Atlas Search is not a fallback** because Atlas is no longer part of the production plan.
- **Suggested resource limits across 4 GiB** (leave headroom for OS + Docker + Nginx):
    - storefront (Angular SSR): ~1.2 GiB
    - admin (Angular SPA — can instead be served as **static files by Nginx** (no Node container) if SSR isn't enabled, freeing ~0.6 GiB): ~0.6 GiB
    - api (NestJS/Fastify): ~1.0 GiB
    - Nginx: ~64 MiB
    - **mongo (self-hosted, single-node RS): ~1.0–1.5 GiB** — set a `--wiredTigerCacheSizeGB` cap so it doesn't starve the API/search
    - Reserve ~1 GiB for OS/overhead/burst. Set `deploy.resources.limits`/`mem_limit` accordingly; let the OOM killer act per-container.
    - **If search load grows, move to 8 GiB and budget `search (Meilisearch): ~0.5–1.0 GiB`.**

### Secrets handling

- Do NOT bake secrets into images, Dockerfiles, or build args. Do NOT expose via any browser-bundled config — Angular `environment.*.ts` and build-time vars are compiled into the client JS (the Angular analogue of `NEXT_PUBLIC_*`), so they are public to the browser. Server-only secrets stay in the API container's runtime env.
- Inject at runtime via **Docker Compose secrets** (mounted as files) or root-owned `/etc/saha/*.env` referenced by Compose `env_file`/`secrets`. Keep production config out of source control.

### CI/CD (GitHub Actions)

- Workflow: lint/test → `turbo prune` per app → build multi-stage images → tag with SHA + `latest` → push to GHCR → SSH/deploy to droplet (pull new SHA images, `docker compose up -d`).
- Health checks gate the deploy; **rollback** = re-deploy the previous commit-SHA tag.

### VERIFIED cost claims

- **(a) Private repo storage on GitHub: FREE.** GitHub Free includes unlimited private repositories.
- **(b) GitHub Actions for private repos: 2,000 free Linux minutes/month + 500 MB artifact storage** on the Free plan; beyond that billed (~$0.006/Linux min after the Jan 2026 rate cut). Your 3-app build-and-deploy fits comfortably within 2,000 min with caching (Turbo remote cache + Docker layer cache). Public repos = unlimited free.
- **(c) GHCR storage for PRIVATE images: currently FREE.** GitHub explicitly states "container image storage and bandwidth for the Container registry is currently free" — it does NOT fall under the GitHub Packages tiered storage billing. Unlimited private image repos. Gotcha: this is a "currently free / soft-billing" status; GitHub has promised 30-day notice before charging — keep a Plan B (mirror to another registry) for the long term.
- **(d) Pulling images to the droplet: FREE.** GHCR imposes no Docker-Hub-style pull rate limits on your private images tied to your account. (Pulls via Actions are guaranteed free.)
- **Other monthly costs (revised for the owner decision):** Droplet $24 at launch (2 vCPU / 4 GB / 80 GB SSD) or $48 when upgraded to 4 vCPU / 8 GB / 160 GB, Spaces $5 (250 GiB storage + 1 TiB egress + built-in CDN; overage $0.02/GiB storage, $0.01/GiB transfer), MongoDB Atlas $0 because Atlas is not used, ExchangeRate-API free, Resend/MailerSend/MSG91-email free/low-tier depending provider, Cloudflare free (edge + DNS; team mailboxes separately via Google Workspace if used), self-hosted Meilisearch $0 (runs on the droplet), domain/registrar separate. **Approx fixed infra ≈ $29/mo at launch ($24 droplet + $5 Spaces) plus email/team-mailbox choices and payment/shipping per-transaction fees; upgrade to ≈$53/mo when the 8 GB droplet is needed.**

**MongoDB self-hosted tier (owner decision):** MongoDB runs in Docker on the droplet, with a single-node replica set for transactions, private Docker networking only, no public `27017`, a persistent volume/bind mount on the droplet SSD, memory/WiredTiger caps, health checks, restart policy, and scheduled backups. Local development must run the same MongoDB 8.3 replica-set profile through Docker Desktop. Archived products stay fully in Mongo at launch; a compressed JSON-to-Spaces cold archive seam is designed now but only built/run later when droplet disk pressure is real.

---

## 10 — Documentation Plan

Produce these `.md` files (this report maps 1:1):

- `00-project-overview.md` — business, scope, three apps, non-goals.
- `01-tech-stack-and-rationale.md` — stack table + NestJS-on-Fastify decision.
- `02-monorepo-and-architecture.md` — repo layout, hexagonal/ports-adapters, DB-swap example, JSONB↔Mongo mapping.
- `03-data-model.md` — taxonomy, product/variation schema, promotions, currencies, orders, users, carts, shipping.
- `04-storefront-spec.md` — custom Analog storefront (Fastkart UI reference), SSR/SSG, PWA (vite-plugin-pwa/Workbox), cart state (NgRx hybrid), analytics events, feature set.
- `05-admin-panel-spec.md` — Fastkart `fastkart-admin` base, product/category/currency/offer controls, orders, roles.
- `06-seo-i18n-currency.md` — SEO/rendering/JSON-LD/accordion pattern, Transloco i18n, FX cron + markup math + currency-switch flow.
- `07-payments-and-shipping.md` — CCAvenue vs BillDesk, PayPal, Shiprocket domestic + international, cost+currency handling.
- `08-auth-and-security.md` — auth method cost matrix, OAuth setup, OWASP 2025, controls, GDPR/cookie consent.
- `09-infrastructure-deployment.md` — Docker/Compose/GHCR/Actions/droplet/Nginx + verified cost facts.
- `10-documentation-plan.md` — this index + contribution/versioning conventions, ADR log, runbooks (deploy, rollback, secret rotation, FX-cron failure).

Add to the docs repo: a root `README.md` (quickstart), `CONTRIBUTING.md`, an `adr/` folder for decision records, `.env.example` files per app (no real secrets), and runbooks.

## Recommendations

**Stage 1 — Foundations (weeks 1–3):** Stand up the monorepo (PNPM+Turbo), define `core-domain` ports and `contracts` (zod), implement `adapters-db-mongo` against Docker MongoDB 8.3 single-node replica set, scaffold the NestJS-on-Fastify API and the **two custom Angular + Analog apps (admin first), using Fastkart only as a UI reference** (Bootstrap 5/ng-bootstrap, NgRx hybrid, TanStack Query, Transloco, vite-plugin-pwa, angular-eslint; UI packages pinned to Fastkart versions). Migrate the real taxonomy (from the scrape) and the product option/variation/named-add-on schema first — they're the riskiest modeling work.

**Stage 2 — Commerce core (weeks 4–7):** Product/category/variation rendering, cart (server-persistent + guest merge), checkout, CCAvenue (INR) + PayPal (foreign) behind `PaymentGatewayPort`, FX cron + currency switch + gross-up math, Shiprocket domestic.

**Stage 3 — Polish & launch (weeks 8–11):** SEO (Title/Meta + JSON-LD/sitemaps/accordion FAQ), full i18n (Transloco, en+bn — every string), PWA (vite-plugin-pwa/Workbox), admin pricing/offer controls, auth (email+password, email OTP, Google/Facebook), GDPR consent, analytics. Add international shipping.

**Stage 4 — Hardening:** OWASP 2025 review, rate limiting, CSP/headers via Nginx, CI/CD with SHA tags + rollback, healthchecks, resource limits.

**Thresholds that change recommendations:**

- ~~Catalog >~1,000 SKUs or slow search~~ **Already true at launch (≈500–1,000 active SKUs + heavy fuzzy/multilingual/transliteration UX)** → ship Meilisearch behind `SearchPort` from the start, not as a later threshold.
- Droplet memory pressure from Mongo + Meilisearch + API/frontends → move from the $24 4 GB droplet to the $48 8 GB droplet before the services fight for memory.
- SMS phone-OTP conversion matters and budget allows → add an SMS gateway (only paid auth method).
- GHCR begins charging (30-day notice) → mirror images to an alternate registry.
- PayPal FX-markup erodes margins → reconsider grossing-up the 3–4% conversion markup or switch foreign settlement to cheaper rails (Wise/Skydo) than PayPal's 5–8% all-in.

## Caveats

- All cost/free-tier facts are current as of June 2026 and several (GHCR free status, X API pricing, PayPal fees, Actions minutes, CCAvenue Privilege setup fee) are subject to vendor change; GHCR's free private-image status is explicitly "currently free" with a promised 30-day notice before billing.
- The live site currently shows DEMO products and prices in USD; treat the scraped taxonomy and variation structures as authoritative for modeling, but verify final category parentage and exact attribute/term names with the client (the live tree has some inconsistent parent paths).
- BillDesk's pricing is unpublished/quote-based; any specific BillDesk % would be speculation. The community `billdeskjs` npm package targets BillDesk's legacy checksum API, not the current JWS-HMAC API — verify which API version your account is provisioned on before using it.
- Self-hosted single-droplet MongoDB gives transactions but not failover; backups, restore drills, resource caps, and a later standby/replica plan matter once revenue justifies it.
- PayPal India's effective cost (5–8% all-in including FX markup + GST) is higher than the headline 4.4% + fixed fee used in the gross-up formula; decide policy on absorbing vs grossing-up the FX-conversion markup.
- Google's FAQ rich results are being deprecated (notice May 7, 2026; dropped from search appearance June 2026); keep FAQPage schema for AEO/AI-Overview value but don't expect the legacy rich snippet.
