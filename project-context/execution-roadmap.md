# Execution Roadmap — Saha Textile

> Ordered build plan for the agent. **Work phase by phase; do not skip ahead.** Each phase = **Read → Build → Verify (Definition of Done)**. Open a PR per coherent unit; squash-merge to protected branches with human approval. Re-read the named KB section in `project-context/saha-textile-technical-knowledgebase.md` before building.

---

## Phase 0 — Repo, tooling & MCP environment

**Read:** `AGENTS.md`, `cursor-context-placement-instructions.md`, `project-context/mcp-automation-setup.md`

### 0.1 — Repo & tooling scaffold

**Build:**

- Initialize the pnpm + Turborepo monorepo at repo root: `pnpm-workspace.yaml`, `turbo.json`, root `package.json` (private, `packageManager: pnpm@…`).
- Distribute the staged config files per the placement guide (`.cursor/mcp.json`, `.cursor/rules/mcp-tools.mdc`, `.vscode/`, root `.prettierrc` / `.editorconfig` / `.gitignore` / `.env.mcp.example`, `AGENTS.md` at root, the knowledge docs into `project-context/`).
- Install root dev deps: `prettier`, `prettier-plugin-tailwindcss`, `eslint` (flat config), `typescript`. **Then** add `"plugins": ["prettier-plugin-tailwindcss"]` back to `.prettierrc`.
- Create `.nvmrc` (current Node LTS) and empty `apps/` + `packages/` skeleton with workspace globs.
- Ensure `main` exists; create `dev`, `qa`, `staging`; confirm the two rulesets apply to this repo, squash merging is enabled at repo level, and local commit signing (SSH/GPG) is set up.
- Add a minimal CI skeleton `.github/workflows/ci.yml`: install + `turbo run lint typecheck` on PRs to protected branches.

### 0.2 — MCP environment setup & verification

**This must be working _before_ Phase 1.** `project-context/mcp-automation-setup.md` is the authoritative runbook; execute it. Summary:

- **Human prerequisites (obtain first):**
    - Create the **MongoDB Atlas M0** cluster (shared by LOCAL + TEST-E2E); copy its connection string. (A read-only DB user on the prod cluster is created later, for PROD-E2E.)
    - Get a **Postman API key**; optionally a **Context7 API key** (free tier works without one, 500 req/mo).
    - A **GitHub fine-grained PAT** and **DigitalOcean tokens** (test + prod) are needed only for the E2E blocks later — not for LOCAL.
- **Configure the LOCAL phase:**
    - `cp .env.mcp.example .env.mcp`; fill **only the LOCAL block** (Context7 optional, Postman key, the test-M0 `MDB_MCP_CONNECTION_STRING`, `MDB_MCP_READ_ONLY=false`); leave TEST-E2E / PROD-E2E commented.
    - Restart Cursor so it loads `.cursor/mcp.json` against the LOCAL env.
- **Verify (runbook §9):** confirm **context7, shadcn, mongodb, postman** show green in Cursor → Settings → Tools & MCP, and that **github / digitalocean stay dark** in LOCAL. Confirm the active tool count is **under ~40**. Smoke-test: a version-pinned Context7 query returns current docs; MongoDB lists collections on the M0 cluster; Postman lists workspaces.
- **Defer:** fill the TEST-E2E and PROD-E2E blocks (GitHub PAT + DO tokens + prod read-only Mongo string) only when you reach **Phase 8**.

**Definition of Done (Phase 0):** `pnpm install` clean; `pnpm turbo run lint typecheck` passes on the empty scaffold; branches + rulesets + commit signing verified; CI green on a throwaway PR; **the four LOCAL MCP servers (context7, shadcn, mongodb, postman) verified green in Cursor with the active tool count under ~40.**

## Phase 1 — Shared foundations (contracts + core-domain)

**Read:** KB §data-model, §architecture
**Build:**

- `packages/contracts`: zod schemas + inferred types for Product, Variation, Category, Promotion, Currency, Order, User, Cart, ShippingQuote (per the KB schemas). This is the cross-app source of truth.
- `packages/core-domain`: entities/value objects + the PORT interfaces (`ProductRepository`, `OrderRepository`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort`). **Zero infra dependencies.**
- `packages/config`: shared eslint / tsconfig / tailwind presets.
  **Definition of Done:** packages build & typecheck; zod schemas covered by unit tests; an ESLint boundary rule forbids infra imports inside `core-domain` and passes.

## Phase 2 — Data layer (MongoDB adapter)

**Read:** KB §data-model (collections, indexes), §architecture (repository pattern)
**Build:**

- `packages/adapters-db-mongo`: models + repository implementations of the core ports; map docs ↔ entities (DTOs, no leakage).
- Atlas connection module (reads `MDB_MCP_CONNECTION_STRING`-style env). Indexes: `slug`, `categoryIds`, `sku`, taxonomy `path`/`ancestors`.
- Seed script: load the real taxonomy tree + a few representative variable products including the **"No Stitching" base → Design 1-3 + Color** pattern with per-variation prices.
  **Definition of Done:** repositories pass integration tests against the test M0 cluster; seed populates taxonomy + sample products; the adapter is swap-isolated (a hypothetical Postgres adapter would need no core changes).

## Phase 3 — API (NestJS on Fastify)

**Read:** KB §architecture, §auth-and-security
**Build:**

- `apps/api`: NestJS with `@nestjs/platform-fastify`; wire adapters → ports via DI in a composition module.
- Modules: catalog (products/categories/search), cart, orders, currency/fx, promotions, auth. Controllers validate with `contracts` (zod).
- OpenAPI generation (`@nestjs/swagger`); health-check endpoint; `@fastify/rate-limit`; CORS allowlist; security headers.
- Auth: email+password (argon2id), email-OTP (Brevo free tier), JWT access + rotating refresh; Google/Facebook OAuth stubs. (Phone-OTP/SMS deferred — only paid method.)
  **Definition of Done:** API boots; catalog CRUD + search return seeded data; OpenAPI served; invalid input rejected; health-check green; unit/integration tests pass.

## Phase 4 — Storefront (Next.js PWA)

**Read:** KB §storefront-spec, §seo-i18n-currency; `vendor/storefront` (NextMerce) for components
**Build:**

- `apps/storefront`: Next.js 16 App Router. Cherry-pick presentational components from `vendor/storefront` into `packages/ui`. Clean localized routes (`/{locale}/product/{slug}`, `/{locale}/c/{path}`); real breadcrumbs from the taxonomy path.
- Product + category pages (SSG/ISR); variation selector (design + color + measurement add-ons); cart (Zustand + server-persistent, guest→login merge) with TanStack Query.
- i18n (next-intl, en + bn); currency switch (backend price recompute + gateway switch); SEO (`generateMetadata`, Product/Offer/BreadcrumbList/FAQPage JSON-LD, `sitemap.ts`, **SEO-safe accordion FAQ** kept in the DOM); global cookie consent; PWA (Serwist, offline shell).
  **Definition of Done:** browse taxonomy → product → add to cart → cart survives reload + login merge; currency switch recomputes prices and flips the active gateway; Lighthouse SEO + PWA pass; offline shell loads.

## Phase 5 — Admin panel

**Read:** KB §admin-panel-spec; `vendor/admin` (TailAdmin) for components
**Build:**

- `apps/admin`: variable-product builder (attributes → variation matrix, base-flag, add-on measurement fields); category/collection manager (arbitrary nesting, multi-parent); currency controls (rates, gateway-per-currency, editable PayPal markup %); promotions at any scope (category/product/variation/color/tag/cart, flash/clearance/coupon); order management; content (blog/FAQ/banners); roles + audit log.
  **Definition of Done:** full product+variation CRUD; category-tree management with multi-parent; edit a currency rate + PayPal markup; create a flash-sale promo; process an order end to end.

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

- Multi-stage Dockerfiles (`turbo prune --docker`) for storefront/admin/api; non-root users; healthchecks; resource limits (≈1.2 GiB storefront / 0.6 GiB admin / 1.0 GiB api / Caddy).
- `docker-compose` + Caddy reverse proxy (auto-HTTPS); runtime secrets via compose secrets / root-owned files; **no secrets in images or build args**.
- GitHub Actions: test → build → push to GHCR (`Kaizer-Systems`, commit-SHA tags) → deploy (TEST-E2E droplet first, then PROD-E2E); rollback via previous SHA tag.
- Final OWASP review; rate limits; CSP; dependency scan.
  **Definition of Done:** three images build & push to GHCR; a short-lived TEST-E2E droplet deploys end to end (then destroyed); rollback verified; security checklist passes.

---

## Continuous (every phase)

- Grow the **Docusaurus developer portal** incrementally per `private-developer-portal-documentation-plan.md` (OpenAPI→Redoc, generated DB-schema docs, Storybook, Mermaid diagrams, Pagefind search).
- Keep tests green; keep docs in sync with code; one PR per coherent unit; squash-merge into protected branches with human approval.
- Use the phase-appropriate MCP environment (Phases 0-7 mostly **LOCAL**; Phase 8 uses **TEST-E2E** then **PROD-E2E**).
