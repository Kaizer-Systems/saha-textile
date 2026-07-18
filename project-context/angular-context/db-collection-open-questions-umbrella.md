# DB Collection Design — Open Questions (single umbrella to answer in one shot)

**Purpose.** Before we finalize the MongoDB collection structures, these are the decisions that still need your input. I've **consolidated every scattered/unanswered question I could find across the KB** (catalog explainer, codex catalog/auth plans, owner-decisions-log) into this one file, plus added the modeling questions I need answered as the implementer. Resolved items are marked **LOCKED** so future reviews can see why they disappeared from the open queue.

**How to use:** answer inline under each item (a one-word pick is fine where a recommendation is given). Grouped by domain. ⭐ = my recommendation.

> Sources folded in: `catalog-search-db-decisions-explainer.md` (Q3–Q8), `codex-catalog-db-architecture-assessment-and-plan.md` (§7 collections + QUERY sections), `owner-decisions-log.md` (PENDING items). If you've answered any of these elsewhere and I missed it, just say "already answered — see X."

---

## A. Catalog core — RESOLVED 2026-07-04

These 5 were explicitly left **PENDING your call** and are now locked:

- **A1 — Categories (Q3): LOCKED.** Multi-placement DAG via `categoryPlacements` + one-time Woo cleanup on import. Do not force a strict single-parent tree.

- **A2 — "Multi-level compound product" (Q4): LOCKED.** Build model/contracts for all 5 patterns: simple, variation/SKU, tailoring/customization, product relations, and true bundle/composite.

- **A3 — Color / option axes (Q5): LOCKED.** Color and every other potential option axis is per-product toggle-based. Default is filter/descriptive; mark `variation_axis` only when it changes SKU/stock/price row/image/base identity/purchasability.

- **A4 — Archived product retention (Q7): LOCKED.** Keep archived products fully in Mongo at launch; design the Spaces cold-archive stub seam now; build/run cold archive only later at real disk pressure. Mongo cannot query Spaces directly.

- **A5 — Search dictionary depth (Q8): LOCKED.** Self-host Meilisearch. Full Level 1-4 feature surface exists day one: typo tolerance, aliases, Bengali/transliteration, suggestions, no-result analytics, and admin dictionary tuning. Seed may start small; curation grows over time.

Additional 2026-07-04 option-model lock:

- Fastkart's "Attribute" master maps to our reusable `attributeDefinitions` / option definitions.
- Product upload chooses semantic role per option group: `filter_only`, `variation_axis`, `named_add_on`, or `bundle_component_option`.
- Product upload chooses visual `displayStyle` separately: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`.
- `displayStyle` is visual only; it never decides business meaning.
- Standalone blouse design may be a variation axis; saree-attached blouse design is a named add-on group with default `No Design` and optional measurement requirements.

---

## B. Products & variants — modeling decisions I still need

- **B1 — Which attributes are variation-driving vs filter-only vs descriptive, beyond Color?**
  **Decision rule is LOCKED:** choose per product during upload. `Size`, `Fabric`, `Design`, `Waist`, `Liter`, `Color`, etc. are not globally variation-driving. They become variation axes only when they create separate SKU/stock/price/image/purchasability rows. Public sidebar visibility/order is governed by category facet config, not by the option role alone.

- **B2 — SKU strategy.** Auto-generate per variant, or admin-entered? Format/prefix rules? Must SKUs be globally unique or per-product? → ⭐ _auto-generate `{productCode}-{axisValues}` with admin override, globally unique._

- **B3 — Per-variant overrides.** Which fields can a variant override vs inherit from the parent product: price, sale price, stock, images, weight, dimensions, barcode? → ⭐ _price/sale/stock/image/weight overridable; rest inherited._

- **B4 — Pricing display & storage.** Tax-inclusive is LOCKED (Q6). But: **do you show a "strike-through MRP + sale price"**, and is MRP stored per variant? Any per-product min/max price ranges shown on cards? → _Confirm MRP model._

- **B5 — Multi-currency.** Single currency (INR) at launch, or show converted prices? (KB has `currencies` + `currencyExchangeRates` collections.) Store prices in INR only + display-convert, or store per-currency? → ⭐ _store INR canonical, display-convert via rates; no per-currency storage._

- **B6 — Add-ons / named option groups (`addonTemplates`).** **LOCKED base case:** saree-attached blouse design is a named add-on group with default `No Design`; future groups like `Aachol/Churni Design` are allowed. Add-on options may carry price delta, media, measurements, status, default selection, and sorting. Remaining open work: exact launch price deltas and measurement validation ranges.

- **B7 — Product relations.** Related / cross-sell / up-sell / "frequently bought" — admin-curated, algorithmic (from analytics insight sets), or both? → ⭐ _both: curated overrides + analytics fallback._

---

## C. Inventory & costing

- **C1 — Stock reservation.** When is stock decremented/held — on **add-to-cart, checkout start, or order placement**? Reservation TTL for abandoned carts? → ⭐ _soft-reserve at checkout start with TTL; hard-decrement on order placement._
- **C2 — Backorder / oversell policy.** Allow backorders (sell past 0) per product, or hard-block at 0? Low-stock threshold for badges? → _Confirm per-product backorder toggle default._
- **C3 — FIFO cost layers (Q9 LOCKED).** Confirm: cost layers are **admin-invisible to customers**, feed COGS/margin reports only, and are written from **purchase invoices** (`purchaseInvoiceLines` → `inventoryCostLayers`). Any manual stock adjustments (damage, correction) — do they need a reason code taxonomy? → _List adjustment reason codes you want._

---

## D. Orders, checkout & customers

- **D1 — Guest checkout and guest cart. LOCKED 2026-07-07.** Guest checkout is **not** available at launch. Guests may use the guest cart, but `Proceed to checkout` forces login/signup, then resumes checkout after guest-cart merge. Guest carts are server-authoritative in the `carts` collection, keyed by an httpOnly guest token hash, with a **30-day sliding TTL** from last activity. Browser IndexedDB may queue offline cart edits, but server cart is source of truth on reconnect. Keep cart/order ownership fields and contracts compatible with adding guest checkout later without a rewrite.
- **D2 — Order number scheme.** Format (e.g. `ST-2026-000123`), per-year reset, or continuous? → _Pick a format._
- **D3 — Cart→order line snapshots.** LOCKED that order lines are immutable snapshots. Confirm which fields snapshot (name, image, SKU, price, tax, attributes chosen) so post-hoc catalog edits don't mutate historical orders. → _Confirm snapshot field set._
- **D4 — Addresses.** Multiple saved addresses per user, default shipping/billing, address validation? Phone captured at checkout (LOCKED optional) — required for shipping though? → _Confirm address model + phone requirement at checkout._
- **D5 — Coupons/promotions stacking.** Can multiple coupons stack? Coupon + automatic promotion together? Per-user usage limits (LOCKED fields exist)? Exclusions (sale items)? → _State stacking rules._
- **D6 — Wishlist / saved-for-later. LOCKED 2026-07-07.** Wishlist and Save for Later are distinct account-bound concepts. Wishlist is a discovery/favorites list across product surfaces. Save for Later is cart-adjacent and moves a cart line out of the active cart without treating it as a general wishlist item.

---

## E. Payments, shipping, tax, returns

- **E1 — Payment methods at launch.** COD? Online (CCAvenue/PayPal seams LOCKED)? UPI? Partial/split payments? → _List launch methods + whether COD needs order-value caps._
- **E2 — Shipping model.** Zone-based rates, weight-based, flat, or provider-quoted (Shiprocket seam)? Free-shipping threshold? Multiple packages per order? → ⭐ _zone + weight tiers with free-shipping threshold; provider-quote seam later._
- **E3 — Tax rules granularity.** Tax-inclusive LOCKED. Do you need per-category or per-product tax classes (e.g. different GST slabs for fabric vs stitched garments)? HSN codes stored? → _Confirm tax-class granularity + HSN need._
- **E4 — Returns/refunds windows.** Return window (days), which products are non-returnable, refund method (original / store credit / wallet), restocking? Ties to the `customer-ledger` we built. → _State the policy._
- **E5 — Customer ledger / store credit / wallet.** The admin has a `customer-ledger` page (renamed from wallet). Is store credit / wallet a real launch feature (balance, top-up, spend on orders), or ledger-only (record of transactions)? Points/loyalty? → _Confirm ledger vs active-wallet, and whether points/loyalty ship at launch._

---

## F. Content, search, reviews, Q&A, analytics

- **F1 — Reviews.** Moderated (admin approve before publish) or auto-publish? Verified-purchase only? Star + text + images? → ⭐ _moderated, verified-purchase badge, star+text+optional images._
- **F2 — Q&A (new spec per the FAQ/Q&A correction).** **LOCKED:** customer-submitted product questions, admin-only answers, public after admin answer, email-on-answer, guest or logged-in identity capture, editable display name/email, and anonymous public display flag. No community answers at launch.
- **F3 — FAQ / content blocks.** **LOCKED:** FAQ is admin-curated editorial content, separate from Q&A, targetable globally, by category, by product, or by mixed category+product union with dedupe/preview. Rich localized content is required.
- **F4 — Search/category facets. LOCKED:** category/collection/sidebar filters are backed by Meilisearch facets through `SearchPort`. Use category/placement-level facet config to decide public visibility, order, display style, count visibility, translation labels, and whether a facet is desktop/sidebar/mobile-offcanvas eligible. Launch candidates include category, price, color, fabric, tag, sale/featured badges, rating bucket, stock availability, and coarse shipping eligibility; exact enabled facets vary per category path.
- **F5 — Analytics-driven badges/rails (LOCKED weekly insight sets).** Confirm the badge taxonomy you want on product cards (Bestseller, New, Trending, Low-stock, "X sold this week"…) and which storefront rails they feed. → _List badges + rails._

---

## G. Cross-cutting

- **G1 — Soft-delete vs hard-delete** across collections (products, categories, users, orders). ⭐ _soft-delete (status + deletedAt) everywhere except truly transient data._ → _Confirm._
- **G2 — Audit logging scope.** `auditLogs` LOCKED. Which mutations must be audited (all admin writes, or a subset)? Retention? → _Confirm scope + retention._
- **G3 — i18n content.** **LOCKED:** product, category, FAQ, Q&A, option labels, add-on labels, SEO metadata, content pages, and admin-visible reporting labels must be translation-ready (`en` + `bn` with explicit fallback approval where incomplete). Search transliteration is additive, not a substitute for localized content fields.
- **G4 — ID strategy.** Mongo `ObjectId` everywhere, or human-friendly slugs/codes as primary business keys (products, categories, orders)? SEO routes/redirects collections exist — confirm slug immutability + redirect-on-change policy. → ⭐ _ObjectId `_id` + immutable slug/code business keys + auto-redirect on slug change._

---

## H. Anything I still don't know I don't know

If there are product types, business rules, or flows on `sahatextile.com` (or planned) that aren't reflected in the scraped data or the KB — **stitching/tailoring services, wholesale/bulk pricing tiers, made-to-order lead times, subscription/repeat orders, B2B vs B2C, gift cards** — tell me now, because each can add or reshape collections. → _List any._

---

### Reminder for the storefront build

Per the migration checklist, the storefront will re-raise the **platform/SSR, auth-cookie, routing, and cart/order-classic-NgRx** questions (they differ from admin). Those are UI-architecture questions, tracked separately in `admin-ngxs-to-ngrx-tanstack-migration-checklist.md` §6 — **not** part of this DB umbrella, but flagged so nothing is lost.
