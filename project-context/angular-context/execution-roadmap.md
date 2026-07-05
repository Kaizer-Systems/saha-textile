# Execution Roadmap — Saha Textile

> Ordered build plan for the agent. **Work phase by phase; do not skip ahead.** Each phase = **Read → Build → Verify (Definition of Done)**. Open a PR per coherent unit; squash-merge to protected branches with human approval. Re-read the named KB section in `project-context/saha-textile-technical-knowledgebase.md` before building.

---

## Phase 0 — Repo, tooling & MCP environment

**Read:** `AGENTS.md`, `cursor-context-placement-instructions.md`, `project-context/mcp-automation-setup.md`

### 0.1 — Repo & tooling scaffold

**Build:**

- Initialize the pnpm + Turborepo monorepo at repo root: `pnpm-workspace.yaml`, `turbo.json`, root `package.json` (private, `packageManager: pnpm@…`).
- Distribute the staged config files per the placement guide (`.cursor/mcp.json`, `.cursor/rules/mcp-tools.mdc`, `.vscode/`, root `.prettierrc` / `.editorconfig` / `.gitignore` / `.env.mcp.example`, `AGENTS.md` at root, the knowledge docs into `project-context/`).
- Install root dev deps: `prettier`, `eslint` (flat config), `typescript`. (**No `prettier-plugin-tailwindcss`** — Tailwind is not used on this stack; styling is Bootstrap 5 + ng-bootstrap + SCSS.)
- Create `.nvmrc` (current Node LTS) and empty `apps/` + `packages/` skeleton with workspace globs.
- Ensure `main` exists; create `dev`, `qa`, `staging`; confirm the two rulesets apply to this repo, squash merging is enabled at repo level, and local commit signing (SSH/GPG) is set up.
- Add a minimal CI skeleton `.github/workflows/ci.yml`: install + `turbo run lint typecheck` on PRs to protected branches.

### 0.2 — MCP environment setup & verification

**This must be working _before_ Phase 1.** `project-context/mcp-automation-setup.md` is the authoritative runbook; execute it. Summary:

- **Human prerequisites (obtain first):**
    - Start the **Docker MongoDB 8.3 single-node replica-set** profile for LOCAL. TEST-E2E/PROD-E2E use the deployed self-hosted Mongo container on the droplet, with read-only production access only for inspection tooling.
    - Get a **Postman API key**; optionally a **Context7 API key** (free tier works without one, 500 req/mo).
    - A **GitHub fine-grained PAT** and **DigitalOcean tokens** (test + prod) are needed only for the E2E blocks later — not for LOCAL.
- **Configure the LOCAL phase:**
    - `cp .env.mcp.example .env.mcp`; fill **only the LOCAL block** (Context7 optional, Postman key, the local Docker Mongo `MDB_MCP_CONNECTION_STRING`, `MDB_MCP_READ_ONLY=false`); leave TEST-E2E / PROD-E2E commented.
    - Restart Cursor so it loads `.cursor/mcp.json` against the LOCAL env.
- **Verify (runbook §9):** confirm **context7, mongodb, postman** show green in Cursor → Settings → Tools & MCP, and that **github / digitalocean stay dark** in LOCAL. Confirm the active tool count is **under ~40**. Smoke-test: a version-pinned Context7 query returns current docs (it covers Angular / ng-bootstrap / Transloco); MongoDB lists collections; Postman lists workspaces. **(Angular change: the `shadcn` MCP server from the Next plan is dropped — it served React shadcn/ui components; the Angular UI is Bootstrap 5 + ng-bootstrap (plain npm installs), and Context7 covers the docs.)**
- **Defer:** fill the TEST-E2E and PROD-E2E blocks (GitHub PAT + DO tokens + prod read-only Mongo string) only when you reach **Phase 8**.

**Definition of Done (Phase 0):** `pnpm install` clean; `pnpm turbo run lint typecheck` passes on the empty scaffold; branches + rulesets + commit signing verified; CI green on a throwaway PR; **the three LOCAL MCP servers (context7, mongodb, postman) verified green in Cursor with the active tool count under ~40** (shadcn MCP dropped for the Angular stack — see above).

## Phase 1 — Shared foundations (contracts + core-domain)

**Read:** KB §data-model, §architecture
**Build:**

- `packages/contracts`: zod schemas + inferred types for Product, Variation, Category, Promotion, Currency, Order, User, Cart, ShippingQuote (per the KB schemas). This is the cross-app source of truth.
- `packages/core-domain`: entities/value objects + the PORT interfaces (`ProductRepository`, `OrderRepository`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort`). **Zero infra dependencies.**
- `packages/config`: shared eslint (+ angular-eslint) / tsconfig / **SCSS+Bootstrap** presets (no Tailwind).
  **Definition of Done:** packages build & typecheck; zod schemas covered by unit tests; an ESLint boundary rule forbids infra imports inside `core-domain` and passes.

## Phase 2 — Data layer (MongoDB adapter)

**Read:** KB §data-model (collections, indexes), §architecture (repository pattern)
**Build:**

- `packages/adapters-db-mongo`: models + repository implementations of the core ports; map docs ↔ entities (DTOs, no leakage).
- Self-hosted Mongo connection module (Docker MongoDB 8.3, single-node replica set, transaction-ready). Indexes: `slug`, `categoryIds`, `sku`, category placement paths, **plus compound `{ status, categoryIds }` and `{ status, updatedAt }`** so storefront queries hit only `published` rows and never scan archived docs (see KB §data-model lifecycle note).
- Seed script: load the real taxonomy tree + representative products including the **"No Stitching" base → Design 1-3 with Color as filter-only** pattern, a saree with `Blouse Design` as a named add-on defaulting to `No Design`, a bundle/composite seam fixture, product option `displayStyle` examples, and sample `categoryFacetConfigs` for Fastkart-style collection sidebars. **Also provide a `--bulk N` mode that generates a few hundred–1,000 synthetic published products + a batch of `archived` ones**, so search, pagination, faceting, and listing performance are exercised at realistic catalog size (~500–1,000 active + 2,000+ archived), not just a handful.
  **Definition of Done:** repositories pass integration tests against the local Docker replica-set profile; seed populates taxonomy + sample products **and bulk/archived fixtures**; transactions work through `withTransaction`; status-filtered queries return only active products; the adapter is swap-isolated (a hypothetical Postgres adapter would need no core changes).

## Phase 3 — API (NestJS on Fastify)

**Read:** KB §architecture, §auth-and-security
**Build:**

- `apps/api`: NestJS with `@nestjs/platform-fastify`; wire adapters → ports via DI in a composition module.
- Modules: catalog (products/categories/search/facets), cart, orders, currency/fx, promotions, auth. Controllers validate with `contracts` (zod). **Search and listing facets live behind `SearchPort`; at ~500–1,000 active SKUs with heavy fuzzy/multilingual/transliteration needs, implement a self-hosted Meilisearch adapter — see KB §04. Index only `status: published`; reindex on product/category/facet/product-status changes.**
- OpenAPI generation (`@nestjs/swagger`); health-check endpoint; `@fastify/rate-limit`; CORS allowlist; security headers.
- Auth: email+password (argon2id), email-OTP seam through `EmailPort` if free provider is available, API-set httpOnly cookie sessions + double-submit CSRF + opaque rotating refresh with reuse detection; Google/Facebook OAuth stubs. (Phone-OTP/SMS deferred — paid method seam only.)
  **Definition of Done:** API boots; catalog CRUD + search return seeded data; OpenAPI served; invalid input rejected; health-check green; unit/integration tests pass.

## Phase 4 — Admin panel (Angular + Analog) — **BUILT FIRST**

> **Order change:** the **admin is built before the storefront.** See `angular-context/fastkart-execution-plan.md` for the page-by-page plan.

**Read:** KB §admin-panel-spec; the Fastkart assessment + execution plan in `angular-context/`; `vendor/…/fastkart-admin` as **UI reference only** (never forked)
**Build:**

- **Stage A (UI on dummy data):** `apps/admin` — a **custom Angular + Analog** app (NgRx hybrid, TanStack Query, Transloco, Bootstrap 5/ng-bootstrap, ApexCharts, ngx-editor, ngx-dropzone — UI libs pinned to Fastkart versions). **Replicate every Fastkart admin page/sub-page/modal/popup/notification in look/feel** using **our** reusable component architecture + conventions — no Fastkart code copied. Dummy forms/data throughout. **Drop:** wallet, the demo Themes (keep Theme-Options), and the marketplace/vendor cluster (Store/Vendor, Commission, Payout-Details, Withdrawal, Vendor-Wallet) — single-store config stays via Setting + Theme-Options. **Keep loyalty Points** (replicate UI; it's a planned future add-on — reserve model/API seams; see KB §data-model + Fastkart execution plan). Full inventory in `fastkart-execution-plan.md`.
- **Stage B (wire to real data):** after the UI is complete, revisit sahatextile.com, finalize the **DB collections/data model**, then modify each page (add/remove fields) to our finalized model and repoint to the **NestJS API + `contracts`**. Then layer the Saha-specific builders: option builder with semantic role + display style, variant matrix for `variation_axis` only, named add-on groups, bundle/composite panels, base/default flags, measurement add-ons, **status/archive**, arbitrary multi-parent taxonomy, per-category/per-placement facet configuration, currency/gateway/markup controls, scoped promotions, order management, content (blog/FAQ/banners), roles + audit log. Forms via **Reactive + Signal Forms**.
  **Definition of Done:** Stage A — full admin UI replicated, navigable, on dummy data, in our architecture. Stage B — product/variation CRUD, multi-parent taxonomy, currency rate + PayPal markup edit, flash-sale promo, end-to-end order — all on real data.

## Phase 5 — Storefront (Angular + Analog SSR/SSG, PWA)

**Read:** KB §storefront-spec, §seo-i18n-currency; the Fastkart assessment + execution plan; `vendor/…/fastkart-front` as **UI reference only**
**Build:**

- `apps/storefront`: a **custom Angular + Analog** app (SSR/SSG) — **replicate Fastkart `fastkart-front` look/feel**, build custom. Locale-prefixed routes (`/{locale}/product/{slug}`, `/{locale}/c/{path}`); breadcrumbs from the taxonomy path. Shared reusable components in `packages/ui`.
- Product + category pages (**SSG prerender of `status: published` slugs + SSR for dynamic**); category/listing pages render Fastkart-style sidebar/off-canvas filters from API facets (`items + facets + counts/ranges + SEO`); option selector renderer using `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`; variation selection only for `variation_axis`; named add-on and measurement forms via Reactive/Signal Forms; cart (**NgRx hybrid** + server-persistent, guest→login merge) with **`@tanstack/angular-query`**.
- **Full** i18n (**Transloco**, en + bn — every string); currency switch (backend price recompute + gateway switch); SEO (Angular `Title`/`Meta`, Product/Offer/BreadcrumbList/FAQPage JSON-LD, sitemap via Analog server route, **SEO-safe accordion FAQ** kept in the DOM); global cookie consent; PWA (**vite-plugin-pwa/Workbox**, offline catalogue + offline cart).
  **Definition of Done:** browse taxonomy → product → add to cart → cart survives reload + login merge; **language toggle switches 100% of visible strings**; currency switch recomputes prices and flips the active gateway; Lighthouse SEO + PWA pass; **offline catalogue browsing + offline cart** work.

## Phase 6 — Payments & shipping

**Read:** KB §payments-and-shipping
**Build:**

- `adapters-payments`: CCAvenue (INR, AES encryption) + PayPal (foreign) behind `PaymentGatewayPort`; currency-driven gateway selection (INR→CCAvenue, else→PayPal).
- `adapters-shipping`: Shiprocket domestic + international behind `ShippingPort`; pincode-based rate lookup; capture returned value **and its currency**; apply PayPal gross-up to shipping **only when international**.
- Wire the full checkout; test every provider in sandbox.
  **Definition of Done:** INR checkout via CCAvenue sandbox; foreign checkout via PayPal sandbox with correct gross-up; domestic + international shipping quotes resolve and apply correctly with currency handled.

## Phase 7 — SEO/i18n/currency polish + analytics + FX cron

**Read:** KB §seo-i18n-currency
**Build:**

- FX cron (`@nestjs/schedule`, daily ~00:30 UTC) → ExchangeRate-API → DB, with fallback + staleness alert. Validate the PayPal gross-up nets the intended INR. Complete hreflang/canonical/x-default. Saree blog. Analytics events (abandoned cart, still-not-purchased, guest-cart-attach-after-login, newsletter popup).
  **Definition of Done:** rates refresh daily and persist; gross-up math verified with a worked example; analytics events fire on the right actions; structured data validates in the Rich Results Test.

## Phase 8 — Security hardening + Docker + CI/CD + deploy

**Read:** KB §security, §infrastructure-deployment; `mcp-automation-setup.md`
**Build:**

- Multi-stage Dockerfiles (`turbo prune --docker`) for storefront/admin/api; non-root users; healthchecks; resource limits (≈1.2 GiB storefront / 0.6 GiB admin / 1.0 GiB api / Nginx / **self-hosted mongo ~1.0–1.5 GiB** / search).
- `docker-compose` + **Nginx reverse proxy (TLS via Certbot/Let's Encrypt auto-renew)** + **self-hosted dockerized MongoDB (single-node replica set, private network only)**; runtime secrets via compose secrets / root-owned files; **no secrets in images or build args**.
- GitHub Actions: test → build → push to GHCR (`Kaizer-Systems`, commit-SHA tags) → deploy (TEST-E2E droplet first, then PROD-E2E); rollback via previous SHA tag.
- Final OWASP review; rate limits; CSP; dependency scan.
  **Definition of Done:** three images build & push to GHCR; a short-lived TEST-E2E droplet deploys end to end (then destroyed); rollback verified; security checklist passes.

---

## Continuous (every phase)

- Grow the **Docusaurus developer portal** incrementally per `private-developer-portal-documentation-plan.md` (OpenAPI→Redoc, generated DB-schema docs, Storybook, Mermaid diagrams, Pagefind search).
- Keep tests green; keep docs in sync with code; one PR per coherent unit; squash-merge into protected branches with human approval.
- Use the phase-appropriate MCP environment (Phases 0-7 mostly **LOCAL**; Phase 8 uses **TEST-E2E** then **PROD-E2E**).
