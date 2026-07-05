# Fastkart Execution Plan (Angular + Analog) — Admin-First, Build-Custom

> **This is the live build plan.** It supersedes the §9 wireframe in `fastkart-assessment-and-plan.md`. It encodes the owner's locked decisions and the **"replicate Fastkart's UI, build everything else to our heightened architecture"** direction. Read alongside the KB (`saha-textile-technical-knowledgebase.md`) and `execution-roadmap.md`.

---

## 1. Operating principles (non-negotiable)

1. **Fastkart = UI + behaviour reference ONLY. Never fork or copy its code.** We open its files to (a) replicate look/feel exactly, and (b) absorb the _intuition_ of normal e-commerce flows so prompts can stay short. The actual implementation is **ours**.
2. **Our architecture is the standard; Fastkart is the _floor_.** For every feature, our implementation must **meet or exceed** what Fastkart ships — never below. State, auth, routing, env, SEO, i18n, SSR, PWA, data: all custom.
3. **Admin first**, storefront second.
4. **UI before data:** build the full admin UI on **dummy data/forms/modals** first; then finalize the DB model (revisit sahatextile.com) and wire each page.
5. **Apply Fastkart's pro-theme polish with our rigor:** highly modular, reusable, lazy-loaded, typed, lint-clean — the same level of structure a paid theme ships, expressed in our conventions.
6. **Pin borrowed UI packages to Fastkart's exact versions** (matrix in §5) for visual parity.
7. **Reuse UI patterns, not Fastkart's product semantics.** Fastkart's Attribute/Classified builder is a strong conditional UI reference, but Saha's domain requires separate option roles and display styles.

## 2. Locked stack (final)

Angular 21 · **AnalogJS** (SSR/SSG) · **Bootstrap 5 + ng-bootstrap + SCSS** (look only) · **NgRx hybrid** (SignalStore + Store/Effects/Entity) · **TanStack Angular Query** · **Transloco** · **vite-plugin-pwa/Workbox** · **Reactive + Signal Forms** · **ApexCharts** (admin) · **angular-eslint** · **Vitest** + Playwright · `HttpClient` + interceptors · runtime config (`config.json` via `APP_INITIALIZER`). Backend/contracts/domain/adapters/DB/infra unchanged.

> **Explicitly NOT used (rejected vs Fastkart):** NGXS, @ngx-translate, @angular/service-worker, Tailwind, spartan-ng, Karma/Jasmine, Fastkart's Express SSR server (Analog's is used instead).

## 3. Our per-feature project structure & conventions

Each admin feature is a self-contained, lazy-loaded module folder. Target shape (example: `product`):

```
apps/admin/src/app/features/product/
├─ product.routes.ts            (lazy route definitions, functional guards/resolvers)
├─ pages/                       (route-level smart components)
│  ├─ product-list/             (list + filters + bulk actions)
│  ├─ product-form/             (create/edit shared form — Reactive/Signal Forms)
│  └─ product-detail/
├─ ui/                          (dumb/presentational components, reused; promote to packages/ui if cross-feature)
├─ state/                       (NgRx: feature SignalStore + classic Store/Effects/Entity for async)
├─ data/                        (TanStack Query options + HttpClient services hitting the NestJS API)
├─ model/                       (TS types derived from @saha-textile/contracts; mappers if API↔view differs)
└─ product.config.ts            (table columns, form schema, i18n key namespace)
```

- **Shared, reusable UI** (buttons, cards, tables, modals, form controls, toasts, breadcrumbs, sidebar, topbar) lives in **`packages/ui`** as our Bootstrap/ng-bootstrap component library — built once, consumed by admin + storefront, styled to replicate Fastkart.
- **State boundary:** TanStack Query = server data (lists, entities, caching, offline persistence); NgRx = app/UI/cart/session state (SignalStore for feature/UI, classic Store+Effects+Entity for cart/orders/offline catalogue).
- **Forms:** typed Reactive Forms now; adopt Signal Forms as they stabilise. One reusable `*-form` component per entity (create+edit share it).
- **i18n:** every string is a Transloco key from day one (no hard-coded copy) — `en` + `bn`; scope keys per feature.
- **Routing:** lazy `loadChildren` per feature; functional guards (`authGuard`, `roleGuard`); resolvers for prefetch.
- **Lint/format:** angular-eslint + Prettier; no `any`; OnPush/zoneless-friendly.

## 4. Admin page inventory — REPLICATE / DROP / FUTURE

Source: `vendor/.../fastkart-admin/src/app/components/*` (enumerated). "Replicate" = build the UI to our architecture on dummy data.

### ✅ REPLICATE (UI now, wire later)

- **Dashboard** (ApexCharts widgets, stats cards).
- **Product** — list, create/edit (shared `form-product`), option/variant builder (extended for Saha: semantic role selector, display style selector, design/stitching base, named add-ons, measurement add-ons, bundle component options, status/archive).
- **Category** — list, tree view, create/edit (extended: arbitrary multi-parent + materialized path).
- **Attribute** (create/edit/form), **Tag** (create/edit/form), **Tax** (create/edit/form).
- **Coupon** (create/edit/form), **Currency** (create/edit/form) — extended for INR-canonical + gateway-per-currency + PayPal markup.
- **Order** — list, details, create-order, checkout, **Order-Status**; **Refund**; capture measurement add-ons in order lines.
- **Review**, **Questions-Answers** (+ answers modal), **Notification**.
- **Blog** (+ blog category, blog tag, create/edit/form), **FAQ** (create/edit/form), **Page** (CMS create/edit/form), **Media** (library/uploads via ngx-dropzone).
- **Shipping** (+ shipping-country, modal) — later wired to Shiprocket.
- **Role** (+ permissions, create/edit/form), **User** (create/edit/form), **Account/Profile**, **Auth** (login/forgot/otp/update-password).
- **Setting** (store-wide single-store settings) + **Theme-Option** (the customizer/options page — KEPT).

### 🗑️ DROP

- **Wallet** (customer wallet) — owner-excluded.
- **Theme** demo pages (Paris/Tokyo/Osaka/Rome/Madrid/Berlin/Denver under the "Store Front" menu) — keep **Theme-Options** only.
- **Marketplace/vendor cluster:** **Store/Vendor** management, **Commission**, **Payout-Details**, **Withdrawal**, **Vendor-Wallet** — out of single-store scope. (Single-store config is covered by **Setting** + **Theme-Option**.)

### 🔮 FUTURE ADD-ON (replicate UI now, mark as deferred)

- **Points** (loyalty/reward points) — **kept as a planned future add-on.** Replicate the admin UI on dummy data, and **factor loyalty points into the data model and API design** (a `points`/loyalty concept on users + earn/redeem rules) so it can be switched on later without rework. Flagged in the KB data-model and roadmap.

## 5. UI package version matrix (PIN to Fastkart's versions)

Use these exact versions for visual/behavioural parity, adjusting only where Analog/Angular 21 compatibility requires (note any bump):

| Package                      | Fastkart version                    | Used in | Notes                                                            |
| ---------------------------- | ----------------------------------- | ------- | ---------------------------------------------------------------- |
| `bootstrap`                  | `5.3.3`                             | both    | core CSS framework                                               |
| `@ng-bootstrap/ng-bootstrap` | `20.0.0`                            | both    | **verify Angular-21 compat; raise to ng-bootstrap 21 if needed** |
| `@angular/cdk`               | `21.0.0`                            | both    | overlays, a11y, drag-drop (category tree)                        |
| `swiper`                     | `11.2.10`                           | front   | sliders                                                          |
| `ngx-owl-carousel-o`         | `21.0.0`                            | both    | carousels — **SSR-guard**                                        |
| `ngx-image-zoom`             | `2.1.0`                             | front   | product zoom — **SSR-guard**                                     |
| `ng-select2-component`       | `16.0.0` (front) / `10.0.0` (admin) | both    | **version mismatch in Fastkart — standardize on one**            |
| `ngx-toastr`                 | `19.0.0`                            | both    | toasts                                                           |
| `feather-icons`              | `4.29.2`                            | both    | icon set                                                         |
| `@ngx-loading-bar/*`         | `7.0.0`                             | both    | route/http progress bar                                          |
| `apexcharts`                 | `4.5.0`                             | admin   | charts                                                           |
| `ng-apexcharts`              | `1.17.0`                            | admin   | charts wrapper (note Fastkart's `overrides`)                     |
| `ngx-dropzone`               | `3.1.0`                             | admin   | media uploads                                                    |
| `ngx-editor`                 | `18.0.0`                            | admin   | rich-text (blog/pages)                                           |

**Our own stack packages** (NgRx, TanStack Angular Query, Transloco, vite-plugin-pwa, Analog, Vitest, idb) are pinned to **their** latest stable compatible with Angular 21 + Analog — independent of Fastkart.

## 6. Phased execution (admin first) — action → example → outcome

### Phase A — Admin scaffold + shell

- **Action:** Run the Cursor migration prompt (clean node_modules → strip Next → scaffold `apps/admin` as a custom Analog app with the locked stack). Build the **app shell**: sidebar nav, topbar, breadcrumbs, layout, dark mode, toasts, loading bar — as reusable `packages/ui` components replicating Fastkart's chrome. Runtime config + Transloco (en/bn) + NgRx providers + TanStack Query client + angular-eslint + Vitest wired.
- **Example:** `pnpm --filter @saha-textile/admin dev` serves the admin shell; the sidebar matches Fastkart's IA (minus dropped items); toggling en↔bn switches all chrome strings.
- **Outcome:** A running admin shell on our architecture, visually Fastkart, zero Fastkart code.

### Phase B — Replicate admin pages on dummy data

- **Action:** Build each REPLICATE-list page (§4) as a feature module per §3, with dummy data, full forms, modals, popups, notifications — pixel-faithful to Fastkart. Tables, filters, pagination, create/edit forms, detail views, confirm modals.
- **Example:** Product → list with filters + bulk actions; `form-product` create/edit with tabs; category tree with drag-reorder (Angular CDK); order details with line items; ApexCharts dashboard — all on mock data.
- **Outcome:** Complete, navigable admin UI on dummy data — every required page/modal/notification present, in our structure.

### Phase C — Finalize the data model (revisit sahatextile.com)

- **Action:** Re-scrape/confirm the live taxonomy, product/variation patterns, attributes, and the design/stitching + measurement reality; finalize the **DB collections** and the zod **`contracts`** (products with i18n content objects, variable variations + `isBase`, toggle-based option roles, Fastkart-compatible display styles, named add-on groups, bundle/composite seams, multi-parent taxonomy, scoped promotions, currencies, orders capturing measurements, users incl. **future points hooks**, carts, reviews, etc.).
- **Example:** Lock the `products`, `categories`, `promotions`, `currencies`, `orders`, `users` schemas; decide DTO mapping per entity.
- **Outcome:** Final data model + contracts — the source of truth for wiring.

### Phase D — Wire admin pages to the real API + Saha builders

- **Action:** Replace dummy data with **NestJS API + `contracts`** via TanStack Query + HttpClient. Modify each page to the finalized model (add/remove fields). Build the Saha-specific extensions: option builder with `filter_only` / `variation_axis` / `named_add_on` / `bundle_component_option`, Fastkart display style dropdown, variant matrix only for `variation_axis`, named add-on panels, bundle component panels, base/default flags, measurement add-ons, status/archive, multi-parent taxonomy manager, category/sidebar facet configuration, currency/gateway/markup controls, scoped-promotion builder, order management with captured measurements, roles + audit log.
- **Example:** Admin creates a real variable salwaar where `Design` is the variation axis and `Color` is filter-only, configures the Salwaar category sidebar to show Design/Color/Price facets, creates a saree where `Blouse Design` is a required named add-on with default `No Design`, a true bundle seam fixture, a category-scoped flash sale, and edits the USD PayPal markup — persisted to MongoDB.
- **Outcome:** Fully functional admin on real data, our architecture, meeting/exceeding Fastkart.

### Phase E — Storefront (after admin)

- **Action:** Repeat A–D for `apps/storefront` (Analog SSR/SSG + vite-plugin-pwa). Replicate Fastkart `fastkart-front` look; build custom: product/category (SSG published-only + SSR dynamic), option selector renderer using `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`, variation selection only for `variation_axis`, named add-on and measurement forms, cart (NgRx hybrid + guest-merge) with TanStack Query, full Transloco i18n, multi-currency, SEO (JSON-LD/sitemap/hreflang/accordion), PWA (offline catalogue + cart).
- **Outcome:** SEO-rich, installable, offline-capable storefront meeting/exceeding Fastkart.

## 7. Compatibility & verification (do these before scaffolding)

- **Analog ⇄ Angular 21 — CONFIRMED compatible.** Per the official AnalogJS compatibility table: **Angular `^21.0.0` · AnalogJS latest · Vite `^7.0.0`.** Pin to that triple. (No fallback needed; the earlier Angular-CLL + custom-Workbox fallback is retired.)
- **SSR-safety:** guard `ngx-owl-carousel-o`, `ngx-image-zoom`, `swiper`, and any `window`/`document` access for SSR/Vite (defer to client, `afterNextRender`/platform checks).
- **ng-bootstrap version:** raise to the build matching Angular 21 if `20.0.0` warns.
- **ng-select2 mismatch:** Fastkart uses different versions front (16) vs admin (10) — standardize on one across both apps.
- **Zoneless:** prefer Angular zoneless if all chosen libs support it; otherwise keep `zone.js` ~0.15 (Fastkart's).

## 8. Loyalty points — future add-on (kept)

Points is **deferred, not dropped.** Now: replicate its admin UI on dummy data. Design-time: reserve a `points`/loyalty concept in the data model (earn/redeem rules, balance on users, points lines on orders) and leave API/DTO seams so it can be enabled later without schema churn. Tracked in the KB data-model note and the roadmap.
