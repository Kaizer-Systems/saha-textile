# AGENTS.md — Saha Textile

> Project constitution for AI coding agents (Cursor / Opus). This file is always in context. **Read it fully before acting.** Detailed blueprints live in `project-context/`; read the relevant section there before building each area.

## 1. What this is

- A full custom rebuild of **sahatextile.com** (Kolkata saree/textile retailer, ~23 live products / ~40 SKUs) off WooCommerce.
- **Three product apps + a docs portal in one monorepo:** storefront (public Angular PWA), admin panel (Angular), API (NestJS), and a private developer portal (Docusaurus).
- **Scope discipline:** boutique e-commerce. Do **not** build Amazon/Flipkart-scale complexity (no marketplace, multi-vendor, warehouse mgmt, recommendation ML). Favour clean, maintainable, secure.

## 2. Stack (pinned — never silently upgrade a major)

- Monorepo: **pnpm** workspaces + **Turborepo** (pnpm only — no npm/yarn).
- Storefront: **Angular 21 + AnalogJS** (SSR/SSG, file-based routing under `apps/storefront/src/app/pages`). PWA (offline catalogue + offline cart) via **`vite-plugin-pwa` / Workbox**.
- Admin: **Angular 21** (Fastkart-style UI).
- API: **NestJS 11 on Fastify 5** (`@nestjs/platform-fastify`).
- UI/styling: **Bootstrap 5 + ng-bootstrap + SCSS**. **Fastkart** (Angular) is a UI/behaviour **reference only — never fork it.** Forms: Angular reactive/signal forms. Charts: ApexCharts.
- Client state: **NgRx hybrid** — `@ngrx/signals` (SignalStore) for feature/UI state + classic `@ngrx/store`/`effects`/`entity` where heavy client mutation warrants it (e.g. cart). Server state/data: **TanStack Angular Query**.
- DB: **self-hosted Docker MongoDB 8.3** (single-node replica set for multi-document transactions) — **not Atlas**. Same Docker profile locally and in prod for parity. Media: **DigitalOcean Spaces** (S3-compatible, SGP).
- Search: **self-hosted Meilisearch behind `SearchPort`** (Mongo is source of truth; Meili is a derived, rebuildable index). Do **not** use Mongo regex/`$text` for storefront typeahead.
- i18n: **Transloco** (runtime en↔bn). Validation: **zod** at every boundary.
- Payments: **CCAvenue** (INR) + **PayPal** (foreign currencies). FX: **ExchangeRate-API** (daily cron, rates persisted). Shipping: **Shiprocket** (domestic + international) behind `ShippingPort`. Notifications: **MSG91** (SMS/WhatsApp/Email) behind `NotificationPort` with split transactional/marketing kill-switches.
- Tooling: **angular-eslint** + ESLint flat config, Prettier (tabs/4), **Vitest** (unit) + Playwright (e2e).
- Node: pin via `.nvmrc` (root engines require Node ≥24).
- Use **Context7** (MCP) for version-correct docs of any library — always pin the version in the query.

## 3. Architecture — non-negotiable: hexagonal / ports & adapters

- **`packages/core-domain` depends on NOTHING external.** It holds entities, value objects, use-cases, and **PORT interfaces**: repositories (`CatalogRepository`, `OrderRepository`, `CartRepository`, `UserRepository`, `CurrencyRepository`, `PromotionRepository`) plus `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort` (and `NotificationPort` for MSG91).
- **Adapters** implement ports at the edges (`adapters-db-mongo`, `adapters-storage-spaces`, `adapters-payments`, `adapters-shipping`, `adapters-fx`, `adapters-search`, `adapters-auth`). Wire them to ports via **NestJS DI** at composition time in the API. The Angular apps never touch adapters — they consume the API over HTTP.
- **Dependency rule:** all imports point inward. Core never imports an adapter.
- **Swappability test:** replacing MongoDB with PostgreSQL must touch only a new db adapter + one DI binding — never core, use-cases, or UI. If a task forces edits across layers to swap an edge concern, the layering is wrong: **stop and flag it.**
- Adapters map persistence shapes ↔ domain entities (DTOs). **Never leak Mongoose docs / SQL rows into core.**
- **`packages/contracts`** (zod schemas) is the single source of truth for API request/response shapes, shared by all apps.
- **Canonical product price is ALWAYS INR.** All other currencies are derived at request time in the backend (conversion + PayPal gross-up; see KB §multi-currency). Never store per-currency prices.

## 4. Repo layout

```
apps/        storefront (Angular + AnalogJS PWA) · admin (Angular) ·
             api (NestJS + Fastify) · developer-portal (Docusaurus)
packages/    core-domain · contracts · config · ui ·
             adapters-db-mongo · adapters-storage-spaces · adapters-payments ·
             adapters-shipping · adapters-fx · adapters-search · adapters-auth
vendor/      Fastkart (Angular storefront + admin reference — UI/behaviour only, never forked)
docs/        Markdown source rendered by the developer portal (apps/developer-portal → ../../docs)
project-context/   angular-context/ (live KB + roadmap) · nextjs-context/ (superseded — ignore)
.cursor/  .vscode/  .github/workflows/
```

## 5. Coding standards

- **TypeScript strict.** No `any` (use `unknown` + narrowing). No unjustified non-null `!`.
- **Validate all external input with zod** at every boundary (API DTOs, env, webhooks, search params).
- Prettier (tabs/4 — see `.prettierrc`) + ESLint flat config. Format/lint before every commit.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- Small, focused modules. Co-locate tests. Cover use-cases and adapters.
- **No secrets in code, logs, or the browser bundle.** Secrets live in server-side runtime env only; the Angular apps get non-secret config at runtime (not build-time inlining).

## 6. Security baseline (OWASP Top 10:2025)

- Object-level authorization on every order/cart/user endpoint (BOLA is the #1 API risk).
- Rate-limit auth/OTP/checkout/search; strict CORS allowlist; CSP + security headers via the **Nginx reverse proxy** (Cloudflare-fronted edge).
- **API-set httpOnly/Secure/SameSite cookie sessions** with double-submit CSRF; argon2id password hashing; short-lived access + rotating refresh tokens; email OTP (via MSG91) rate-limited + short TTL with anti-enumeration; 6-digit admin PIN.
- `pnpm audit` + Dependabot/Renovate; pin Docker base images; fail closed and never leak internals.
- PCI: card data never touches our servers (CCAvenue hosted/iframe + PayPal).

## 7. Git & PR workflow (rulesets are ACTIVE — see project-context for details)

- **Repo visibility:** the GitHub repo is **public** (required to keep branch rulesets on the org Free plan; also gives unlimited Actions minutes). Deployment images are published as **private GHCR packages** (package visibility is independent of repo visibility). Because the source is public, secret hygiene is non-negotiable: never commit secrets, never ship them to the browser bundle.
- **Protected branches:** `main`, `dev`, `qa`, `staging`. **Never push directly — always via PR.**
- **`main` + `staging`:** linear history + signed commits ⇒ **merge via SQUASH only** (UI). Merge-commits and rebase-merge are blocked there.
- **`dev` + `qa`:** PR + 1 approval; any merge method.
- Branch naming: `feat/<scope>`, `fix/<scope>`, `chore/<scope>`.
- **Open PRs; never merge to a protected branch without explicit human approval.** The human is the sole reviewer/admin.
- Local commit signing (SSH/GPG) must be configured.

## 8. MCP tools & environment phases

- See `.cursor/rules/mcp-tools.mdc`. Three phases — **LOCAL / TEST-E2E / PROD-E2E** — switched by uncommenting one block in `.env.mcp`. Respect the **~40 active-tool budget** and the on-demand activation protocol. **Production MongoDB is read-only.**

## 9. Knowledge base — READ BEFORE BUILDING (in `project-context/angular-context/`)

The live KB is `project-context/angular-context/`. `project-context/nextjs-context/` is the superseded pre-migration KB — **ignore it.**

- **`owner-decisions-log.md`** — authoritative running record of locked owner decisions. Check here first; it overrides older docs on conflict.
- **`saha-textile-technical-knowledgebase.md`** — master: architecture, data model, taxonomy, the variable-product / "No Stitching → Design 1-3 + Color" pattern, currency/PayPal math, payments, shipping, auth, infra.
- **`execution-roadmap.md`** — the ordered build plan. **Follow it.**
- **`codex-catalog-db-architecture-assessment-and-plan.md`** — the target catalog/category/product/search/commerce/reporting DB model (placements, first-class variants, semantic option roles, bundles, badges, insight sets, SEO routes).
- **`codex-auth-architecture-db-and-request-plan.md`** — cookie-session auth, OAuth, OTP, and auth collections.
- **`codex-api-app-build-instructional-prompt.md`** — how to build/refactor `apps/api` within hexagonal boundaries.
- **`fastkart-execution-plan.md`** + **`fastkart-assessment-and-plan.md`** — admin-first, build-custom plan using Fastkart as UI reference.
- **`private-developer-portal-documentation-plan.md`** — the Docusaurus portal (`apps/developer-portal` → `docs/`) to build alongside the code.
- **`mcp-automation-setup.md`** + `.cursor/rules/mcp-tools.mdc` — MCP environment setup and switching.

## 10. Operating rules for you (the agent)

- Before each phase/task: **read the relevant KB section, state your plan, and confirm any destructive/irreversible action.**
- Keep every change inside its layer. If a task seems to require crossing layer boundaries, surface it instead of doing it quietly.
- Prefer editing over rewriting; keep diffs small and reviewable; one PR per coherent unit.
- When a requirement is ambiguous — especially data model, pricing, auth, or security — **ask, don't assume.**
- Build tests and Docusaurus docs **as you go**, not after.
- Never invent credentials, endpoints, or data. Never weaken a security control to make something pass.
