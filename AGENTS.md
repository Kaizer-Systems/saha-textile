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
- Payments: **`PaymentGatewayPort`** — INR online gateway slot + PayPal for foreign; **no COD** at launch. Ops preference for the INR adapter is CCAvenue now / Razorpay later; **swap = adapter + DI only** (core/UI never vendor-specific). FX: **ExchangeRate-API** (daily cron, rates persisted) + PayPal gross-up for non-INR. Shipping: **Shiprocket** (domestic + international) behind `ShippingPort`. Notifications: **MSG91** (SMS/WhatsApp/Email) behind `NotificationPort` with split transactional/marketing kill-switches.
- Tooling: **angular-eslint** + ESLint flat config, Prettier (tabs/4), **Vitest** (unit) + Playwright (e2e).
- Node: pin via `.nvmrc` (root engines require Node ≥24).
- Use **Context7** (MCP) for version-correct docs of any library — always pin the version in the query.

## 3. Architecture — non-negotiable: hexagonal / ports & adapters

- **`packages/core-domain` depends on NOTHING external.** It holds entities, value objects, use-cases, and **PORT interfaces**: repositories (`CatalogRepository`, `OrderRepository`, `CartRepository`, `CustomerRepository`, `AdminUserRepository`, `CurrencyRepository`, `PromotionRepository`) plus `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `SearchPort`, `AuthPort`, `NotificationPort` (MSG91), **`YouTubePort`** (channel-feed discovery), and **`VideoTranscodePort`** (HLS encode; ffmpeg worker via BullMQ at the edge — see owner-decisions-log 2026-07-18 video pipeline).
- **Adapters** implement ports at the edges (`adapters-db-mongo`, `adapters-notifications-msg91`, `adapters-storage-spaces`, `adapters-payments`, `adapters-shipping`, `adapters-fx`, `adapters-search`, `adapters-auth`, plus YouTube / video-transcode adapters as built). Wire them to ports via **NestJS DI** at composition time in the API. The Angular apps never touch adapters — they consume the API over HTTP.
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
             adapters-db-mongo · adapters-notifications-msg91 · adapters-storage-spaces · adapters-payments ·
             adapters-shipping · adapters-fx · adapters-search · adapters-auth
vendor/      Fastkart (Angular storefront + admin reference — UI/behaviour only, never forked)
docs/        developer-portal content, including engineering-live-context/ (canonical live KB)
project-context/   nextjs-context/ (superseded — ignore)
.cursor/  .vscode/  .github/workflows/
```

## 5. Coding standards

- **TypeScript strict.** No `any` (use `unknown` + narrowing). No unjustified non-null `!`.
- **Validate all external input with zod** at every boundary (API DTOs, env, webhooks, search params).
- Prettier (tabs/4 — see `.prettierrc`) + ESLint flat config. Format/lint before every commit.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`).
- Small, focused modules. Co-locate tests. Cover use-cases and adapters.
- **No secrets in code, logs, or the browser bundle.** Secrets live in server-side runtime env only; the Angular apps get non-secret config at runtime (not build-time inlining).
- **Brand naming law (owner lock 2026-07-24): never bare `saha`.** Every identifier — containers, volumes, DB names, env values, service names, paths, mock-data strings — and all prose uses the full brand: `saha-textile` / `saha_textile` / "Saha Textile". Enforced by `scripts/check-naming.sh` in `pnpm lint`. Exceptions: geography data (Sahara/Saharsa/the town "Saha"), the 6-char TRAI DLT sender `SAHATX`, and compact `st_*` cookie names. See owner-decisions-log §2026-07-24. <!-- naming-law:allow -->

## 5a. UI work — reuse first, and brief before building (owner lock 2026-08-11)

**Never invent a UI element or CSS class when the repo already has one.** Assemble screens from
what exists: the app's own `shared/ui` and feature templates first, then pruned/deleted pages
(recoverable from git), then `vendor/` Fastkart — which still holds elements no live page uses.
Three reuse modes are all allowed, chosen by fit: use as-is · copy under a new name prefix and
modify the copy (when one shared component would serve neither caller well) · promote to a
shared component (when several callers need it identically).

**Before writing anything custom — proactively, every time, whether the custom work was
requested or just follows from some other task — stop and hand the owner a brief:**

- crisp bullets of what changes;
- a wireframe (SVG / image / rendered mockup) of the layout;
- the conditional logic the screen applies;
- the inventory of existing elements and CSS classes being reused;
- an explicit statement of what is genuinely custom — and "nothing is custom" said plainly when
  that is the case, because it is exactly the claim being approved;
- anything already in the codebase that this makes redundant.

Then **wait for approval.** If custom work proves unavoidable mid-build, stop again and show it
in the browser pane before it lands. A silently added class, element or component is the failure
this rule exists to prevent. Full text: `owner-decisions-log.mdx` § `DEC-UI-REUSE`.

## 6. Security baseline (OWASP Top 10:2025)

- Object-level authorization on every order/cart/user endpoint (BOLA is the #1 API risk).
- Rate-limit auth/OTP/checkout/search; strict CORS allowlist; CSP + security headers via the **Nginx reverse proxy** (Cloudflare-fronted edge).
- **API-set httpOnly/Secure/SameSite cookie sessions** with double-submit CSRF; argon2id password hashing; short-lived access + rotating refresh tokens; email OTP (via MSG91) rate-limited + short TTL with anti-enumeration; **6-digit admin PIN** (optional onboarding + Security Settings; preferred login method `password` | `pin`; lockout after failed attempts — see owner-decisions-log 2026-07-23).
- `pnpm audit` + Dependabot/Renovate; pin Docker base images; fail closed and never leak internals.
- PCI: card data never touches our servers (hosted/iframe INR gateway adapter + PayPal; vendor SDKs stay in `adapters-payments` only).

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

## 9. Knowledge base — READ BEFORE BUILDING (in `docs/engineering-live-context/`)

The live KB is `docs/engineering-live-context/`. `project-context/nextjs-context/` is the superseded pre-migration KB — **ignore it.**

- **`owner-decisions-log.mdx`** — authoritative running record of locked owner decisions. Check here first; it overrides older docs on conflict.
- **`project-progress.mdx`** — **cross-tool living checkpoint** (Cursor / Claude Code / Codex / parallel agents). Read before work; append a dated status bullet after every small task. Maintained until end of project — see that file’s header for format rules.
- **`api-db-development-roadmap-with-pending-decision-gates.mdx`** — API+DB chunk plan (SAFE NOW / SEAM NOW / BLOCKED), env/secrets sync, often-missed deploy concerns, detailed deploy-script requirements, and the Claude/Codex **context pack** file list.
- **`api-db-local-environment-bootstrap.mdx`** — local Mongo/tooling handoff before API+DB chunks.
- **`environment-variables.mdx`** — env catalogue (names/purpose only; never real secrets).
- **`saha-textile-technical-knowledgebase.mdx`** — master: architecture, data model, taxonomy, the variable-product / "No Stitching → Design 1-3 + Color" pattern, currency/PayPal math, payments, shipping, auth, infra.
- **`execution-roadmap.mdx`** — the ordered build plan. **Follow it.**
- **`codex-catalog-db-architecture-assessment-and-plan.mdx`** — the target catalog/category/product/search/commerce/reporting DB model (placements, first-class variants, semantic option roles, bundles, badges, insight sets, SEO routes).
- **`codex-auth-architecture-db-and-request-plan.mdx`** — cookie-session auth, OAuth, OTP, and auth collections.
- **`pending-decisions.mdx`** — the sole open owner-question inbox; implementation gates reference stable `DEC-*` ids.
- **`environment-variables.mdx`** + **`api-db-local-environment-bootstrap.mdx`** — configuration catalogue and local handoff.
- **`.cursor/rules/mcp-tools.mdc`** — MCP environment/tool-budget setup and switching.

## 10. Operating rules for you (the agent)

- Before each phase/task: **read the relevant KB section, state your plan, and confirm any destructive/irreversible action.** Also read **`project-progress.mdx`** for continuity across tools.
- After each small completed task: **append** a dated `[DONE|PARTIAL|BLOCKED|…]` bullet to the matching section of `project-progress.mdx` (never store secrets there).
- Keep every change inside its layer. If a task seems to require crossing layer boundaries, surface it instead of doing it quietly.
- Prefer editing over rewriting; keep diffs small and reviewable; one PR per coherent unit.
- When a requirement is ambiguous — especially data model, pricing, auth, or security — **ask, don't assume.**
- Build tests and Docusaurus docs **as you go**, not after.
- **Developer-portal release gate:** do not deploy the portal until whole-host private access, origin protection, and unauthorized asset/origin tests are implemented and verified. `noindex` is not access control.
- Never invent credentials, endpoints, or data. Never weaken a security control to make something pass.
- Ignore `project-context/nextjs-context/` (superseded).
