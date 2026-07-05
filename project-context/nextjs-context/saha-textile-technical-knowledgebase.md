# Saha Textile — Custom E-Commerce Rebuild: Technical Knowledge Base

## TL;DR

- Rebuild the WooCommerce store as a PNPM/Turborepo monorepo with 3 apps (Next.js storefront, Next.js admin, **NestJS-on-Fastify** API) using hexagonal/ports-and-adapters architecture so a MongoDB→Postgres (or any provider) swap touches only one adapter; DigitalOcean Spaces ($5/mo) is confirmed viable. **Catalog-scale correction:** MongoDB Atlas M0 (free) is for LOCAL/DEV only — the real store runs **~500–1,000 active products at any time, plus 2,000+ archived/discontinued products (retained but not displayed) and growing**, so production needs a paid tier (**M10+**). Still a single-operator boutique (no marketplace/multi-vendor), but a small-to-mid catalog — not a 40-item shop.
- The site's real product pattern is WooCommerce **variable products** where one attribute ("Blouse Designs"/"Salwaar Designs") carries a **"No Stitching"/"No Blouse" base option** plus "Design 1/2/3" priced variations, optionally crossed with **Color**, plus custom tailoring **measurement fields** (Shoulder/Waist/Sleeve/Chest); model this as JSONB-flexible products with multi-category membership and discounts applicable at category/product/variation/**color** level.
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

**Three deployable apps:** (1) Storefront (Next.js, public, PWA); (2) Admin panel (Next.js, private); (3) API (NestJS-on-Fastify).

---

## 01 — Tech Stack and Rationale

| Layer             | Choice                                      | Verdict                                                 |
| ----------------- | ------------------------------------------- | ------------------------------------------------------- |
| Monorepo          | PNPM workspaces + Turborepo                 | ✅ Correct; `turbo prune` enables per-app Docker builds |
| Storefront        | Next.js 15/16 App Router                    | ✅ Correct                                              |
| Admin             | Next.js (App Router)                        | ✅ Correct                                              |
| API               | **NestJS with Fastify adapter**             | ⚠️ Refined — see below                                  |
| Styling           | Tailwind CSS + shadcn/ui                    | ✅ Correct                                              |
| Client state      | Zustand                                     | ✅ Correct                                              |
| Server state/data | TanStack Query                              | ✅ Correct                                              |
| DB                | MongoDB Atlas M0 (free)                     | ✅ Viable to start; see caveats                         |
| Media             | DigitalOcean Spaces (S3-compatible)         | ✅ $5/mo confirmed                                      |
| i18n              | next-intl                                   | ✅ Recommended                                          |
| Search            | In-DB search (Mongo Atlas Search / `$text`) | ✅ Replaces Algolia at this scale                       |
| PWA               | Serwist                                     | ✅ Current best (next-pwa is abandoned)                 |

### Fastify vs NestJS-on-Fastify — RECOMMENDATION: NestJS with the Fastify adapter

You asked whether to use plain Fastify or NestJS-on-Fastify for a "modular, layered, swappable architecture." **Use NestJS with `@nestjs/platform-fastify`.** Rationale:

- Your #1 architectural requirement is strict modular, layered, swappable design. NestJS is built around exactly this: modules, dependency injection (DI), and adapters. Plain Fastify imposes no architecture — you'd hand-build DI and module boundaries, which is precisely the toil NestJS removes.
- The Fastify adapter gives you NestJS's structure with Fastify's throughput. Per Pravir Raghu (Medium, "Express vs Fastify vs Nest — what to go with and when"): "a simple benchmark showed that a NestJS app using the Fastify adapter achieved about 50k requests/sec at 200 concurrent connections, compared to only ~17k requests/sec using the default Express adapter… That's nearly a 3× improvement just by switching the HTTP engine." For a catalog of this size this raw number is not a bottleneck, but it means you pay no meaningful performance penalty for the structure.
- NestJS's DI container is the cleanest way to implement the ports-and-adapters/repository pattern you require for DB-swappability. Swapping Mongo→Postgres becomes "bind a different provider to the same interface token."
- Plain Fastify is the better pick only when you want a minimal single-purpose service and will assemble structure yourself — which contradicts your stated goals.
- **Caveat:** As confirmed by the DEV Community 2026 backend comparison, "NestJS v11 ships with Express v5 as its default adapter. You can swap to the Fastify adapter using `@nestjs/platform-fastify`…" — so you must explicitly install/configure the Fastify adapter and audit that any middleware you add has Fastify equivalents.

---

## 02 — Monorepo and Layered/Swappable Architecture

### Repo layout

```
saha/  (pnpm workspace, Turborepo)
├─ apps/
│  ├─ storefront/    (Next.js PWA)
│  ├─ admin/         (Next.js)
│  └─ api/           (NestJS-on-Fastify)
├─ packages/
│  ├─ core-domain/        (entities, value objects, use-cases, PORT interfaces — zero infra deps)
│  ├─ adapters-db-mongo/  (Mongoose/native driver implementing repository ports)
│  ├─ adapters-storage-spaces/  (S3 client implementing StoragePort)
│  ├─ adapters-payments/  (CCAvenuePort impl, PayPalPort impl)
│  ├─ adapters-shipping/  (ShiprocketPort impl)
│  ├─ adapters-fx/        (ExchangeRateApiPort impl)
│  ├─ ui/                 (shared shadcn/ui components cherry-picked from themes)
│  ├─ config/             (eslint, tsconfig, tailwind preset)
│  └─ contracts/          (shared DTOs / zod schemas / OpenAPI types)
├─ vendor/
│  ├─ storefront/    (purchased NextMerce source — reference only)
│  └─ admin/         (purchased TailAdmin source — reference only)
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

### Taxonomy (arbitrary nesting + multi-membership)

Adjacency-list with materialized path for fast subtree queries and breadcrumbs:

```jsonc
// categories collection
{
	"_id": "cat_pure_silk",
	"name": { "en": "Pure Silk", "bn": "..." }, // i18n object
	"slug": "pure-silk",
	"parentId": "cat_saree", // null for top level — arbitrary depth
	"path": ["cat_saree", "cat_pure_silk"], // materialized path
	"ancestors": ["cat_saree"],
	"depth": 1,
	"isBannerCollection": false, // collections vs strict taxonomy
	"displayOrder": 10,
	"seo": { "title": {}, "description": {} },
	"media": { "bannerImage": "spaces://..." },
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
			"usedForVariations": true,
			"terms": [
				{ "code": "no-stitching", "label": { "en": "No Stitching" }, "isBase": true, "swatch": "spaces://..." },
				{ "code": "design-1", "label": { "en": "Salwaar Design 1" }, "swatch": "spaces://salwaar1.webp" },
				{ "code": "design-2", "label": { "en": "Salwaar Design 2" }, "swatch": "spaces://salwaar2.jpg" },
			],
		},
		{
			"code": "color",
			"label": { "en": "Color" },
			"usedForVariations": true,
			"terms": [
				{ "code": "black", "label": { "en": "Black" }, "hex": "#000000" },
				{ "code": "red", "label": { "en": "Red" }, "hex": "#cc0000" },
				{ "code": "white", "label": { "en": "White" }, "hex": "#ffffff" },
			],
		},
	],

	"variations": [
		{
			"id": "var_1",
			"attributes": { "design": "no-stitching", "color": "black" },
			"priceINR": 1200,
			"salePriceINR": null,
			"sku": "SKU75789-1-NS-BLK",
			"stock": 5,
			"image": "spaces://saree-12-6.jpg",
		},
		{
			"id": "var_2",
			"attributes": { "design": "design-1", "color": "black" },
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
- Measurement fields are `addons`, captured per cart-line, NOT variations (otherwise the combination matrix explodes).
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

---

## 04 — Storefront Spec (NextMerce cherry-pick + PWA + state + analytics)

**Approach:** Treat purchased NextMerce (demo.nextmerce.com) source in `vendor/storefront` as a reference/parts bin. Cherry-pick presentational components (product cards, gallery, mega-menu, mini-cart) into `packages/ui` and a fresh, shorter `apps/storefront`. Do NOT adopt wholesale.

**Mandatory changes vs the theme:**

- URL structure: clean, localized, SEO-driven routes — `/{locale}/product/{slug}`, `/{locale}/c/{category-path}`. Real breadcrumbs from the materialized path.
- **Remove Algolia.** **Catalog-scale + requirements correction:** with **~500–1,000 active SKUs** (not 40) and a hard requirement for rigorous fuzzy search — predictions, spelling-mistake tolerance, commonly/most-searched, placeholder searches, on-the-go typing (typeahead), and **translatory + transliteral search across English/Bengali** — plain `$text`/regex is no longer adequate, and Algolia/paid tiers are off the table (zero search budget). **Recommended primary: a self-hosted open-source engine — Meilisearch _or_ Typesense — on the droplet (both free, both excel at typo-tolerance + instant typeahead + multilingual/transliteration).** Keep it behind a `SearchPort` so the engine is swappable. **MongoDB Atlas Search** remains a viable zero-extra-infra fallback (its `$search` supports fuzzy + autocomplete) and a fine starting point, but the demanding transliteration/typo UX is more directly served by Meilisearch/Typesense — plan for them. Note: self-hosting search adds RAM pressure on the droplet (see infra sizing). Index **only `status: published`** products; reindex on product create/update/status-change.
- Add multi-language (next-intl) and multi-currency (section 06).
- Add GDPR/UK/EU + global cookie consent (sections 06/08).

**Cart state (persistence across sessions AND devices, guest→merge):**

- Client: Zustand store for instant UI, hydrated from server.
- Server: persistent `carts` collection. Guest carts keyed by an httpOnly cookie token; on login, merge guest cart into the user cart (sum quantities, dedupe by variation+addons signature), then delete the guest cart — giving cross-browser/cross-device continuity.
- TanStack Query mutations sync line changes to the API with optimistic updates.

**PWA (fully offline-capable, installable):**

- Use **Serwist** (`@serwist/next`) — next-pwa is unmaintained; Serwist is the Next.js-recommended successor (Workbox fork).
- App manifest via `app/manifest.ts`; precache shell; runtime caching: network-first for product/data, cache-first for static assets; offline fallback page at `/offline`.
- Use IndexedDB (via `idb`) for offline cart and browsing cache. Set `reloadOnOnline: false` (avoids wiping in-progress forms) and `disable: NODE_ENV==='development'` (avoids dev cache-hell).

**Analytics instrumentation (events to emit):**

- Abandoned cart (items, no checkout within N hours) and "still-not-purchased" reminders — driven by cart timestamps + a scheduled job.
- Guest-cart-attach-after-login event.
- Newsletter subscribe popup (with "don't show again" suppression, mirroring current site).
- Funnel: view_item, add_to_cart, begin_checkout, purchase. Pipe to a privacy-respecting endpoint (self-hosted Plausible/Umami recommended for GDPR simplicity, gated behind consent).

**Feature set (appropriately scoped):** cart, wishlist, search + filters (category, color, price, tag, fabric), reviews/ratings, order history, address book, offers/coupons, flash-sale countdowns, related/cross-sell, newsletter. NOT building: marketplace, multi-vendor, loyalty-points engine, complex returns RMA portal (keep returns as a simple email/manual workflow).

---

## 05 — Admin Panel Spec (TailAdmin cherry-pick + WooCommerce replacement)

**Approach:** Cherry-pick from purchased TailAdmin (nextjs-demo.tailadmin.com) in `vendor/admin` — dashboard layout, tables, forms, charts — into a fresh `apps/admin`.

**Must replace WooCommerce admin functions:**

- Product CRUD with the variable-product builder: define attributes (design/color), auto-generate the variation matrix, per-variation price/SKU/stock/image, base ("No Stitching") flag, add-on measurement-field config.
- Category/collection manager: drag-reorder, arbitrary nesting, multi-parent assignment, banner images, SEO + i18n fields.
- **Currency controls:** add/remove currencies, toggle enabled, manually edit a rate, set which gateway each currency uses (INR→CCAvenue, others→PayPal), and edit the **PayPal commission % + fixed fee** used in markup math (per-currency).
- **Pricing/offers:** create promotions at any scope (global/category/product/variation/color/tag/cart), flash sales with UTC start/end, clearance, coupons, cross-sell/upsell linking.
- Order management: status workflow, view captured measurements, shipping label/quote, refunds.
- Content: saree blog editor, FAQ manager (feeds SEO-safe accordions), homepage banners.
- Roles: admin + staff; audit log of changes.

---

## 06 — SEO, i18n, and Multi-Currency Architecture

### SEO (2026 best practices for Next.js e-commerce)

- **Rendering strategy:** Use SSG/ISR for product and category pages (they change rarely) via `generateStaticParams` + revalidation; SSR for cart/account/search. With **~500–1,000 active product pages** (archived products get no page), `generateStaticParams` should enumerate only `status: published` slugs; ISR's on-demand revalidation (`revalidatePath`/tag) refreshes a single edited product without a full rebuild — this is exactly the scale where ISR earns its keep, maximizing Core Web Vitals while keeping freshness.
- **Metadata:** Next.js Metadata API + `generateMetadata` per route for titles/descriptions/OG/Twitter, localized.
- **Structured data (JSON-LD):** Emit `Product` + `Offer` (price, priceCurrency, availability), `BreadcrumbList`, `Organization`, and `FAQPage`. Note: Google added the FAQ-rich-result deprecation notice on **May 7, 2026** (Search Engine Land: "Google will no longer support FAQ rich results as of May 7, 2026… dropping the FAQ search appearance, rich result report, and support in the Rich Results Test in June 2026… support in the Search Console API removed in August 2026"). Keep FAQPage schema anyway — it still aids AI Overviews/AEO and costs nothing — but don't expect the legacy snippet.
- **hreflang + canonical:** For each localized route emit `<link rel="alternate" hreflang="...">` for every locale + `x-default`, plus a self-referencing canonical. Use `localePrefix: 'always'` for clean, unambiguous URLs (best for SEO).
- **Sitemaps:** Generate `sitemap.xml` (`app/sitemap.ts`) including all products, categories, blog posts, with locale alternates. Submit to Search Console.
- **SEO-safe accordion FAQ pattern (critical):** Content MUST be in the initial server-rendered HTML/DOM even when collapsed — Google indexes collapsed accordion content at full weight under mobile-first indexing, but ONLY if it's in the DOM on first load (not fetched via JS/AJAX on click). Implementation: render all answers server-side; collapse visually with CSS (you may use the `hidden` attribute / height animation) using real `<button>` toggles with proper ARIA (`aria-expanded`, `aria-controls`); do NOT conditionally render (don't unmount answers from the React tree) and do NOT lazy-fetch on expand. This satisfies both accessibility and crawlability.
- Separate saree **blog** section for content SEO; use tags; internal-link blog→products.

### i18n architecture

- **Library:** next-intl (best fit for App Router, Server Component support, ~2 KB, native routing). Built-in Next.js i18n routing was removed in App Router, so a library is required.
- **Routing:** `app/[locale]/...` segment, `localePrefix: 'always'`, middleware for locale detection, `generateStaticParams` to prebuild all locale variants.
- **Translation storage:** Per-locale JSON message files for UI strings (`messages/en.json`, `messages/bn.json`); product/category content translations stored as i18n objects in the DB (as in the schemas). Fallback to default locale for missing keys.
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
- **email OTP CAN be done for free programmatically** — confirmed. Use a transactional email free tier: **Brevo** (300 emails/day ≈ 9,000/mo, SMTP + API), Resend (3,000/mo), or MailerSend (3,000/mo). Recommendation: **Brevo** for the generous forever-free 300/day and simple SMTP/API. So keep email OTP — it's free. (Self-hosting SMTP is possible but deliverability/IP-reputation makes a transactional provider far safer.)
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
    - CSP: strict Content-Security-Policy + HSTS, X-Content-Type-Options, Referrer-Policy (Caddy can inject these).
    - Secrets: never in images/`NEXT_PUBLIC_*`; inject at runtime (section 09).
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

### Reverse proxy: RECOMMENDATION — Caddy (over Nginx/Traefik)

You have Nginx experience, but for this exact use case (3 long-running containers, multi-domain storefront+admin+api, automatic HTTPS, infrequent topology changes) **Caddy is the best fit**:

- **Automatic HTTPS** out of the box (Let's Encrypt/ZeroSSL, auto-renew) with zero ACME config — eliminates an entire class of cert toil Nginx forces you to manage (Certbot).
- The **Caddyfile is tiny and readable**: a few lines map each domain to a container (`reverse_proxy storefront:3000`), and you can inject security headers (HSTS, CSP) inline.
- Lowest memory footprint (~30 MB), HTTP/3 out of the box, config lives cleanly in version control.
- **Why not the others:** Traefik's Docker-label auto-discovery shines when services churn frequently (Swarm/K8s) — overkill here and noisier config. Nginx is the most battle-tested and you know it, but you'd hand-manage Certbot renewals and verbose configs for no benefit at this scale. Your Nginx experience transfers conceptually; Caddy will save you time. If you strongly prefer familiarity, Nginx is an acceptable second choice.

### Single DigitalOcean Droplet via Docker Compose

- All three containers + Caddy on one droplet, joined by a Docker network. MongoDB Atlas + Spaces are external (not on the droplet).
- **Droplet sizing — the $24/mo 4 GB tier holds for the 3 app containers + Caddy, but self-hosted search changes the math.** Per Better Stack's DigitalOcean Review 2026, a Basic Droplet of "2 vCPU / 4 GB RAM / 80 GB SSD" costs **$24/month** (per Fluence 2026, ~4,000 GiB outbound). Three Node SSR/API containers + Caddy fit in 4 GiB. **But** if you run **self-hosted Meilisearch/Typesense on the same droplet** (the recommended search path for ~1,000 SKUs, §04), it wants ~0.3–1 GiB more RAM than the 4 GiB budget below leaves free. Options: **(a) upgrade to the 8 GB / 4 vCPU droplet (~$48/mo)** — cleanest; **(b)** run search on a **separate small droplet**; or **(c)** use **Atlas Search** (no extra droplet RAM, at the cost of the richer typo/transliteration UX). Pick (a) unless budget forbids.
- **Suggested resource limits across 4 GiB** (leave headroom for OS + Docker + Caddy):
    - storefront (Next SSR): ~1.2 GiB
    - admin (Next SSR, low traffic): ~0.6 GiB
    - api (NestJS/Fastify): ~1.0 GiB
    - Caddy: ~128 MiB
    - Reserve ~1 GiB for OS/overhead/burst. Set `deploy.resources.limits`/`mem_limit` accordingly; let the OOM killer act per-container.
    - **If self-hosting search on this droplet, move to 8 GiB and add `search (Meilisearch/Typesense): ~0.5–1.0 GiB`.**

### Secrets handling

- Do NOT bake secrets into images, Dockerfiles, or build args. Do NOT expose via `NEXT_PUBLIC_*` (those are public to the browser).
- Inject at runtime via **Docker Compose secrets** (mounted as files) or root-owned `/etc/saha/*.env` referenced by Compose `env_file`/`secrets`. Keep production config out of source control.

### CI/CD (GitHub Actions)

- Workflow: lint/test → `turbo prune` per app → build multi-stage images → tag with SHA + `latest` → push to GHCR → SSH/deploy to droplet (pull new SHA images, `docker compose up -d`).
- Health checks gate the deploy; **rollback** = re-deploy the previous commit-SHA tag.

### VERIFIED cost claims

- **(a) Private repo storage on GitHub: FREE.** GitHub Free includes unlimited private repositories.
- **(b) GitHub Actions for private repos: 2,000 free Linux minutes/month + 500 MB artifact storage** on the Free plan; beyond that billed (~$0.006/Linux min after the Jan 2026 rate cut). Your 3-app build-and-deploy fits comfortably within 2,000 min with caching (Turbo remote cache + Docker layer cache). Public repos = unlimited free.
- **(c) GHCR storage for PRIVATE images: currently FREE.** GitHub explicitly states "container image storage and bandwidth for the Container registry is currently free" — it does NOT fall under the GitHub Packages tiered storage billing. Unlimited private image repos. Gotcha: this is a "currently free / soft-billing" status; GitHub has promised 30-day notice before charging — keep a Plan B (mirror to another registry) for the long term.
- **(d) Pulling images to the droplet: FREE.** GHCR imposes no Docker-Hub-style pull rate limits on your private images tied to your account. (Pulls via Actions are guaranteed free.)
- **Other monthly costs (revised for real catalog size):** Droplet $24 (**or $48 if self-hosting search on an 8 GB droplet**), Spaces $5 (250 GiB storage + 1 TiB egress + built-in CDN; overage $0.02/GiB storage, $0.01/GiB transfer), **MongoDB Atlas paid tier for prod — ~$9–$25/mo (M2/M5 shared) bridging to ~$57/mo (M10 dedicated)** (M0 free only for dev/test), ExchangeRate-API free, Brevo free, self-hosted Meilisearch/Typesense $0 (runs on the droplet), domain/registrar separate. **Approx fixed infra ≈ $38–$45/mo early (shared Mongo, 4 GB droplet) rising to ~$110/mo at M10 + 8 GB droplet** + payment/shipping per-transaction fees. (The old "$29/mo" figure assumed M0 + 40 products and no longer holds.)

**MongoDB Atlas tier (corrected for real catalog size):** M0 is free but limited (512 MB storage, shared CPU, no SLA, connection limits, and Atlas Search availability varies by region). At the real catalog size — **~500–1,000 active + 2,000+ archived rich product docs (i18n objects, attribute/variation/addon arrays, SEO blocks) plus orders, carts, reviews, FX history, analytics** — 512 MB will be exhausted, so **M0 is for LOCAL/DEV and TEST-E2E only**. **Production should launch on a paid tier — M10 dedicated (≈$57/mo on-demand, less reserved) is the safe target**; an M2/M5 shared cluster (~$9–$25/mo) is an acceptable short bridge but watch storage/connection limits. Provision the paid tier from launch, not "later." If you rely on Atlas Search, confirm it's available on the chosen tier/region; otherwise the self-hosted Meilisearch/Typesense path (§04) behind `SearchPort` is the primary plan anyway.

---

## 10 — Documentation Plan

Produce these `.md` files (this report maps 1:1):

- `00-project-overview.md` — business, scope, three apps, non-goals.
- `01-tech-stack-and-rationale.md` — stack table + NestJS-on-Fastify decision.
- `02-monorepo-and-architecture.md` — repo layout, hexagonal/ports-adapters, DB-swap example, JSONB↔Mongo mapping.
- `03-data-model.md` — taxonomy, product/variation schema, promotions, currencies, orders, users, carts, shipping.
- `04-storefront-spec.md` — NextMerce cherry-pick, PWA (Serwist), cart state, analytics events, feature set.
- `05-admin-panel-spec.md` — TailAdmin cherry-pick, product/category/currency/offer controls, orders, roles.
- `06-seo-i18n-currency.md` — SEO/rendering/JSON-LD/accordion pattern, next-intl, FX cron + markup math + currency-switch flow.
- `07-payments-and-shipping.md` — CCAvenue vs BillDesk, PayPal, Shiprocket domestic + international, cost+currency handling.
- `08-auth-and-security.md` — auth method cost matrix, OAuth setup, OWASP 2025, controls, GDPR/cookie consent.
- `09-infrastructure-deployment.md` — Docker/Compose/GHCR/Actions/droplet/Caddy + verified cost facts.
- `10-documentation-plan.md` — this index + contribution/versioning conventions, ADR log, runbooks (deploy, rollback, secret rotation, FX-cron failure).

Add to the docs repo: a root `README.md` (quickstart), `CONTRIBUTING.md`, an `adr/` folder for decision records, `.env.example` files per app (no real secrets), and runbooks.

## Recommendations

**Stage 1 — Foundations (weeks 1–3):** Stand up the monorepo (PNPM+Turbo), define `core-domain` ports and `contracts` (zod), implement `adapters-db-mongo` + MongoDB Atlas M0, scaffold the NestJS-on-Fastify API and the two Next.js apps. Migrate the real taxonomy (from the scrape) and the variable-product schema first — they're the riskiest modeling work.

**Stage 2 — Commerce core (weeks 4–7):** Product/category/variation rendering, cart (server-persistent + guest merge), checkout, CCAvenue (INR) + PayPal (foreign) behind `PaymentGatewayPort`, FX cron + currency switch + gross-up math, Shiprocket domestic.

**Stage 3 — Polish & launch (weeks 8–11):** SEO (metadata/JSON-LD/sitemaps/accordion FAQ), i18n (en+bn), PWA (Serwist), admin pricing/offer controls, auth (email+password, email OTP, Google/Facebook), GDPR consent, analytics. Add international shipping.

**Stage 4 — Hardening:** OWASP 2025 review, rate limiting, CSP/headers via Caddy, CI/CD with SHA tags + rollback, healthchecks, resource limits.

**Thresholds that change recommendations:**

- ~~Catalog >~1,000 SKUs or slow search~~ **Already true at launch (≈500–1,000 active SKUs + heavy fuzzy/multilingual/transliteration UX)** → ship Meilisearch/Typesense behind `SearchPort` from the start, not as a later threshold.
- ~~Orders/traffic growth → migrate Atlas M0 → M10+~~ **Provision a paid Atlas tier (M2/M5 → M10) at launch** — the catalog already exceeds what M0's 512 MB comfortably holds (this is when the repository-pattern investment pays off; even a switch to Postgres+JSONB is a one-adapter change).
- SMS phone-OTP conversion matters and budget allows → add an SMS gateway (only paid auth method).
- GHCR begins charging (30-day notice) → mirror images to an alternate registry.
- PayPal FX-markup erodes margins → reconsider grossing-up the 3–4% conversion markup or switch foreign settlement to cheaper rails (Wise/Skydo) than PayPal's 5–8% all-in.

## Caveats

- All cost/free-tier facts are current as of June 2026 and several (GHCR free status, X API pricing, PayPal fees, Actions minutes, CCAvenue Privilege setup fee) are subject to vendor change; GHCR's free private-image status is explicitly "currently free" with a promised 30-day notice before billing.
- The live site currently shows DEMO products and prices in USD; treat the scraped taxonomy and variation structures as authoritative for modeling, but verify final category parentage and exact attribute/term names with the client (the live tree has some inconsistent parent paths).
- BillDesk's pricing is unpublished/quote-based; any specific BillDesk % would be speculation. The community `billdeskjs` npm package targets BillDesk's legacy checksum API, not the current JWS-HMAC API — verify which API version your account is provisioned on before using it.
- MongoDB Atlas M0 free-tier limits (512 MB, shared, no SLA) mean it is a **dev/test-only** cluster; the production catalog (~500–1,000 active + 2,000+ archived docs) needs a paid tier **from launch** (M2/M5 shared → M10 dedicated).
- PayPal India's effective cost (5–8% all-in including FX markup + GST) is higher than the headline 4.4% + fixed fee used in the gross-up formula; decide policy on absorbing vs grossing-up the FX-conversion markup.
- Google's FAQ rich results are being deprecated (notice May 7, 2026; dropped from search appearance June 2026); keep FAQPage schema for AEO/AI-Overview value but don't expect the legacy rich snippet.
