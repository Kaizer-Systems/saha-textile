# API + DB Development Roadmap (with pending-decision gates)

**Status:** Working plan for agents/humans.  
**Date:** 2026-07-24 (rev: env/secrets sync + infra scripts + progress checkpoint)  
**Verdict:** Open items in `pending-decision-worksheet-2026-07-10.md` and `db-collection-open-questions-umbrella.md` do **not** block starting API/DB foundations. General structure, ports, security, Mongo replica-set infra, auth, catalog core, search seams, and most collection scaffolds can proceed while the owner confirms remaining business rules.

**Authoritative precedence (on conflict):**

1. `owner-decisions-log.md`
2. `AGENTS.md` + `codex-api-app-build-instructional-prompt.md`
3. Catalog / auth architecture plans
4. Technical KB
5. Pending worksheet + DB umbrella (working queues — not locks until folded into #1)

**Cadence:** Follow API prompt Phases **A → J**, one phase per run/session, with §21 test gates and owner review between phases. Do not attempt A–J in one pass.

**Cross-tool progress (mandatory):** After every small task, update  
`project-context/angular-context/project-progress.md`  
(see that file’s header for format and rules). Read it at the start of every session.

**Do not touch:** `project-context/nextjs-context/` (superseded).

---

## Required reading / context pack (Claude Code, Codex, Cursor, parallel agents)

Attach or open these **before coding**. Prefer this ordered pack over “whole repo” dumps.

### Always (every API/DB session)

| # | Path | Why |
| --- | --- | --- |
| 1 | `AGENTS.md` | Constitution, stack pins, hexagonal rules |
| 2 | `project-context/angular-context/project-progress.md` | What is already DONE/PARTIAL/BLOCKED |
| 3 | `project-context/angular-context/api-db-development-roadmap-with-pending-decision-gates.md` | This file — chunks + gates |
| 4 | `project-context/angular-context/owner-decisions-log.md` | Locked decisions (overrides older docs) |
| 5 | `project-context/angular-context/api-db-local-environment-bootstrap.md` | Local Mongo / tooling handoff |
| 6 | `project-context/angular-context/environment-variables.md` | Env catalogue (names only; no secret values) |

### Phase / chunk dependent (add when relevant)

| When | Paths |
| --- | --- |
| Any API refactor | `codex-api-app-build-instructional-prompt.md` |
| Catalog / collections | `codex-catalog-db-architecture-assessment-and-plan.md` |
| Auth / cookies / OTP / PIN | `codex-auth-architecture-db-and-request-plan.md` (note superseded Brevo banner → MSG91) |
| Messaging | `msg91-notifications-provider-and-pricing.md` |
| Open gates | `pending-decision-worksheet-2026-07-10.md`, `db-collection-open-questions-umbrella.md` |
| Whole-product order | `execution-roadmap.md` |
| Tech overview | `saha-textile-technical-knowledgebase.md` (§09 infra/secrets) |
| MCP phases | `mcp-automation-setup.md`, `.cursor/rules/mcp-tools.mdc` |

### Code surfaces to inspect for env/secrets sync (stale today — fix early)

| Path | Expected vs likely stale |
| --- | --- |
| `apps/api/.env.example` | Must be Docker Mongo RS + MSG91 + Spaces `sgp1` — scrub Atlas / Brevo / `blr1` |
| `apps/api/src/config/app-config.ts` | Must validate locked vars (MSG91/Notification, Mongo parts, CORS 4200/4300, trust proxy) — scrub Brevo-only OTP |
| `packages/adapters-db-mongo/src/config.ts` | Self-hosted `mongodb://` + replicaSet; Atlas optional legacy only if documented |
| `apps/storefront/public/config.json` + `config.example.json` | Runtime public config; localhost OK in git |
| `apps/admin/public/config.json` + `config.example.json` | Same |
| `apps/storefront/src/app/core/config/runtime-config.ts` | `APP_INITIALIZER` load — recreate if missing |
| `apps/admin/src/app/core/config/runtime-config.ts` | Same |
| `apps/*/src/app/core/interceptors/auth.interceptor.ts` | `withCredentials: true`; bearer transitional until Chunk D |
| `docker/mongo/docker-compose.yml` + `scripts/mongo-*.sh` | Recreate if missing (SAFE NOW) |
| `.env.mcp.example` | LOCAL URI → local Docker RS |
| Root `README.md` | Angular + Docker Mongo + MSG91 + SGP — not Next/Atlas |

**Claude Code tip:** `@`-mention the Always table + the chunk’s code surfaces + `project-progress.md`. Do not `@` `nextjs-context`.

---

## How to read chunk markers

| Marker | Meaning |
| --- | --- |
| **SAFE NOW** | Can build to production-quality for that seam using already-locked decisions. |
| **SEAM NOW** | Scaffold contracts, collections, ports, indexes, stub adapters, and policy interfaces now; leave final behaviour behind config/flags until owner lock. |
| **BLOCKED** | Do **not** implement final behaviour / allocate irreversible business numbers until the listed owner decision is locked. Structure around it may still be prepared as a seam. |

---

## 0. What is already locked enough to start (invariants)

These are **not** waiting on the open worksheet/umbrella items:

- Hexagonal NestJS/Fastify API; Angular never talks to Mongo/Meili/Spaces/providers directly.
- `core-domain` ports + `contracts` (zod) + adapters at the edge; swappability test.
- Self-hosted Docker MongoDB 8.3, single-node replica set, private network, transactions via `withTransaction()`.
- Cookie sessions + CSRF + rotating refresh + audience split (admin vs storefront).
- Admin PIN UX (setup/onboarding/lockout), channel-direct OTP via `NotificationPort` (MSG91), OAuth seams.
- Catalog taxonomy = multi-placement DAG; option `semanticRole` ≠ `displayStyle`; INR canonical prices.
- Meilisearch behind `SearchPort` (no Mongo regex/`$text` typeahead).
- Spaces SGP + `mediaAssets`; payments/shipping = ports + stubs until credentials.
- Launch payments: online only; INR gateway role; non-INR PayPal; no COD.
- Reviews moderation; audit retention tiers; track-order deferred; FIFO cost layers + manual stock reason codes.
- **Config injection:** server secrets → API runtime only; public runtime config → Angular `/config.json` at container start (never bake secrets into Vite/Angular builds).

**Architecture reconciliation (RESOLVED 2026-07-25 — owner log §G-CORE-CONTRACTS):** `core-domain` may reference contract shapes via **`import type` only** (runtime-erased; zero runtime dep on contracts/zod — verified in dist). Value imports of contracts, and any import of Nest/Mongoose/Fastify/provider SDKs/adapters, are forbidden and ESLint-enforced (Chunk B). Contracts stay the single shape source of truth.

---

## 0a. Environment & tools bootstrap (before coding chunks)

**Handoff doc:** `api-db-local-environment-bootstrap.md` (Cursor vs Claude Code, who connects to Mongo, checklist).

### Already expected on the machine

| Item | LOCAL need |
| --- | --- |
| Node ≥24 + pnpm | Required |
| Docker engine (`docker ps` works) | Required for Mongo |
| Git | Required |
| Postman Desktop | Optional (manual API checks) |
| Cursor MCP: context7, mongodb, postman | Optional for Claude Code; useful in Cursor |

### Repo deliverables for Mongo (SAFE NOW)

| Path | Role |
| --- | --- |
| `docker/mongo/docker-compose.yml` | Mongo 8.3 single-node `rs0`, volume `saha_textile_mongo_data`, loopback publish |
| `pnpm mongo:up` / `mongo:down` / `mongo:status` / `mongo:wipe` | Lifecycle scripts |
| `apps/api/.env.example` | Self-hosted `MONGODB_*` (not Atlas) |
| `.env.mcp.example` | LOCAL MCP URI → local Docker RS |

### Bring Mongo up

```bash
docker ps          # must succeed first
pnpm mongo:up
pnpm mongo:status
```

URI: `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`  
**API-only** access path in architecture; Angular apps never hold this URI.

### Not required to start Phases A–E

Live MSG91, Spaces, OAuth, CCAvenue/PayPal/Shiprocket credentials, Meilisearch (needed from Phase F), GitHub/DO MCP (E2E only).

---

## 0b. Env / secrets architecture sync (SAFE NOW — do early; codebase is partially stale)

Owner-locked model (2026-07-24):

| Bucket | Examples | Store | Consumed by |
| --- | --- | --- | --- |
| **Server secrets** | Mongo password, JWT/CSRF, MSG91, Spaces, payment/shipping keys | Local gitignored `apps/api/.env`; deploy = GitHub Actions encrypted secrets → droplet root-owned env / Compose secrets | **API only** |
| **Public runtime config** | `apiUrl`, `siteUrl`, locales, OAuth **client** ids | Localhost `public/config.json` may be committed; staging/prod **never** committed — written at deploy | Storefront + admin at runtime |
| **Dev tooling** | Postman, MCP Mongo string | `.env.mcp` (gitignored) | Cursor MCP — not product containers |

**Agents must correct stale wiring** (treat as Chunk C prerequisites / first PRs):

1. Rewrite `apps/api/.env.example` for Docker Mongo RS, `NOTIFICATION_PROVIDER` / `MSG91_*`, Spaces `sgp1`, CORS `http://localhost:4200,http://localhost:4300`, cookie/CSRF placeholder names, `TRUST_PROXY` / `CLIENT_IP_HEADER`.
2. Update `apps/api/src/config/app-config.ts` (zod) to match; remove Brevo-as-primary; MSG91 primary + optional email fallback adapters only.
3. Ensure Angular runtime config loaders exist (`runtime-config.ts` + `provideAppInitializer`) for storefront and admin; mutable `environment` filled after fetch — **no** `fileReplacements` for deploy URLs.
4. Auth interceptors: always `withCredentials: true`; document Bearer as transitional until Chunk D.
5. Scrub Atlas Search / `blr1` / Resend-as-primary / Brevo from **angular-context** docs and examples (not nextjs-context).
6. Recreate `docker/mongo` + `pnpm mongo:*` if absent from the tree.
7. Align `environment-variables.md` with the same model (MSG91 primary, SGP, runtime `config.json` path under `public/`).
8. After each fix: append bullets to `project-progress.md` (API, Storefront, Admin, Infra, DB as appropriate).

**Do not** commit real secrets, prod `config.json`, or a personal markdown of live keys.

---

## 0c. Often-missed env / deploy concerns (checklist — wire when feature lands)

Include these in `.env.example`, Compose, Actions, and Nest config **when the related chunk lands**. Do not invent values; leave empty with comments until credentials exist.

| Concern | Vars / artifacts | Why it bites if missed | Wire in |
| --- | --- | --- | --- |
| CORS allowlist | `CORS_ALLOWED_ORIGINS` | Browser blocks API if storefront/admin origins wrong | Chunk C; update on every domain change |
| Cookie domain / Secure / SameSite | cookie names + domain attrs in config | Cross-subdomain auth (`api.` / `admin.` / apex) fails | Chunk D |
| Real client IP | `TRUST_PROXY=true`, `CLIENT_IP_HEADER=cf-connecting-ip` | Rate-limit/audit see Nginx IP instead of user | Chunk C + Infra |
| Separate test vs prod secrets | distinct GitHub Environments | Test burns prod MSG91/payment keys | Infra |
| GHCR pull on droplet | `read:packages` PAT / deploy identity | Compose cannot pull private images | Infra |
| Actions → droplet SSH | deploy key / SSH secret | Auto-deploy cannot reach host | Infra |
| Meilisearch key | `MEILISEARCH_HOST`, `MEILISEARCH_API_KEY` | Search adapter cannot talk to Meili | Chunk F |
| Webhook verify secrets | PayPal/CCAvenue/Shiprocket webhook secrets | Forged callbacks | Chunk G when live |
| OAuth split | client id in `config.json`; **secret** only in API env | Leaking client secret to browser | Chunk D |
| `.env.mcp` ≠ runtime | keep MCP keys out of Docker | Confusion / accidental leak | always |
| Public config mount | deploy writes `config.json` into SF/admin containers | Wrong `apiUrl` in prod if baked at build | Infra |
| CSRF double-submit cookie | CSRF secret + cookie name | Cookie session without CSRF is incomplete | Chunk D |

---

## 0d. Infra: detailed deploy scripts & secret injection (SAFE NOW to design; implement when droplet/CI ready)

**Policy:** Do **not** ship “minimal one-liner” deploy hacks. Write **detailed, stack-faithful scripts and workflows** matching: pnpm + Turborepo, multi-stage Docker via `turbo prune`, GHCR private packages, Cloudflare → Nginx on droplet, Compose network with API + Mongo + Meili + storefront + admin, Spaces SGP external.

### What to create (agents: implement as full files, not stubs)

| Artifact | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | PR: install, lint, typecheck, unit tests (no secrets required) |
| `.github/workflows/deploy-<env>.yml` | Build images (secret-free), push GHCR with git SHA tags, SSH to droplet, run remote deploy script |
| `docker/compose/docker-compose.yml` (or env-specific overlays) | Services: nginx, storefront, admin, api, mongo (`rs0`), meilisearch; private network; **no public 27017** |
| `docker/nginx/` configs | TLS (Certbot/LE or Cloudflare origin), proxy to apps, security headers, `cf-connecting-ip` forwarding awareness |
| `scripts/deploy/render-api-env.sh` | From CI-injected env, render **root-owned** `/etc/saha-textile/api.env` (or Compose secret files) with **all** API secrets for that environment — validated against expected key list from `.env.example` |
| `scripts/deploy/render-frontend-config.sh` | Render storefront + admin `config.json` from **non-secret** vars (`apiUrl`, `siteUrl`, locales, OAuth client ids only) into mount paths |
| `scripts/deploy/remote-up.sh` | On droplet: pull SHA-tagged images, render env/config, `docker compose up -d`, healthcheck gate, optional rollback to previous SHA |
| `scripts/deploy/backup-mongo.sh` | Scheduled volume-aware Mongo dump + retention (weekly baseline per owner lock) |
| Docs section in `environment-variables.md` + developer-portal | Operator runbook: one-time GitHub Secrets/Variables setup; thereafter zero manual paste per deploy |

### Injection rules (must encode in scripts)

1. **Build stage:** no `ARG`/`ENV` secret bake-in; images are build-once / run-many.
2. **Deploy stage:** GitHub Actions reads encrypted secrets + environment variables → SSH → render scripts → containers start.
3. **API** receives secrets only via env_file / Compose secrets.
4. **Storefront/admin** receive **only** `config.json` (public); never Mongo/JWT/MSG91/Spaces secrets.
5. **Local DX unchanged:** `cp apps/api/.env.example apps/api/.env` once; committed localhost `config.json`.
6. Fail closed: if required secret missing, render script exits non-zero before `compose up`.
7. After implementing: mark Infra bullets in `project-progress.md`; never log secret values there.

### One-time human setup (document in runbook; scripts assume it exists)

- GitHub Environments: `test`, `production` with isolated secrets.
- Secrets: Mongo, JWT/CSRF, MSG91, Spaces, OAuth secrets, payment/shipping when live, droplet SSH key, GHCR pull token if needed.
- Variables (non-secret): public URLs, CORS origins, `SPACES_CDN_URL`, OAuth client ids, feature flags.
- Droplet: Docker Engine, deploy user, `/etc/saha-textile/` permissions, Cloudflare DNS to Nginx.

---

## 1. Hard gates (only these truly stop later chunks)

| Gate | Source | Blocks |
| --- | --- | --- |
| **G-NUM-ORDER** — order / tax-invoice numbering (Mode A FY-reset vs B perpetual; format; gapless; separate sequences) | owner log 2026-07-05; API prompt §14; worksheet §01; umbrella **D2** | Final order placement issuing customer-facing numbers; tax invoice PDFs; `sequences` allocator for those docs |
| **G-NUM-PI** — purchase-invoice numbering (separate sequence, same format rules) | API prompt §16; worksheet §01 | Purchase-invoice **posting** that assigns PI numbers |
| **G-CORE-CONTRACTS** — core ↔ contracts dependency direction — **RESOLVED 2026-07-25 (owner log): Option C — `import type`-only coupling, runtime-pure, ESLint-enforced in Chunk B** | owner log §2026-07-25 | ~~Expanding Phase B~~ Unblocked — Chunk B may expand contracts/ports under the type-only rule |
| **G-I18N-ROUTES** — always-prefixed vs default-unprefixed locales | worksheet **A.6** | Final irreversible SEO route / hreflang canonical policy (provisional `/en`/`/bn` seams OK) |
| **G-IMG-PX** — exact image ladder px + ingest caps | owner log images (deferred) | Sharp derivative enforcement / upload size limits (metadata + presign OK) |

All other open worksheet/umbrella items block **only their own final policy engines**, not Phases A–F foundations.

---

## 2. Chronological chunks (API + DB)

Aligned with `codex-api-app-build-instructional-prompt.md` §22 and catalog plan §16.

### Chunk A — Context / delta / dependency pin  
**Marker: SAFE NOW**

- Inspect current `apps/api`, `packages/contracts`, `packages/core-domain`, `packages/adapters-db-mongo`.
- Delta report: what exists vs must refactor; remove stale Atlas / bearer-token / BillDesk assumptions.
- Pin Nest/Fastify/Mongoose/Meili client/etc. per dependency policy.
- **DoD:** written delta + pinned versions; owner pause only if latest-together conflicts.
- **Progress:** append under API + Meta in `project-progress.md`.

### Chunk B — Contracts + core ports  
**Marker: SAFE NOW** (after **G-CORE-CONTRACTS** rule is stated)

- Expand zod families: auth/session/consent, catalog, search, cart, checkout/order *shapes*, inventory, pricing, FAQ/Q&A, reviews, media, audit.
- Expand ports: `TransactionManagerPort`, auth/session repos, `SearchPort`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `NotificationPort`/`EmailPort`, `YouTubePort`, `VideoTranscodePort`, audit/reporting ports.
- ESLint boundary: core forbids Nest/Mongoose/SDK imports.
- **SEAM NOW** for open policy fields: promotion stacking flags, tax/HSN optional fields, reservation policy config, SKU strategy helpers as interfaces — not hard-coded final engines.
- **DoD:** packages typecheck; boundary lint green; unit tests on contracts/ports.
- **Progress:** Core domain & contracts section.

### Chunk C — API security foundation + Mongo replica-set test profile + env sync  
**Marker: SAFE NOW**

- Fastify cookies bootstrap hooks, CSRF guard scaffolding, CORS allowlist (**include often-missed CORS**), rate-limit, request id, redacted logger, error filter, readiness vs liveness, OpenAPI bootstrap.
- Complete **§0b env/secrets sync** and wire **§0c** items that apply at this stage (`TRUST_PROXY`, `CLIENT_IP_HEADER`, CORS, JWT/CSRF placeholders, MSG91/console).
- Runtime config / `.env.example`: Mongo replica URI, Meili placeholders, Spaces SGP, Cloudflare→Nginx IP/`trustProxy`, cookie names, MSG91/console notification adapters.
- **Hard deliverable:** Docker Compose single-node replica-set profile for local + CI transaction tests (`docker/mongo` + `pnpm mongo:*`).
- **DoD:** API boots; security bootstrap tests; replica-set profile documented and used in CI; stale Atlas/Brevo/`blr1` scrubbed from API examples/config.
- **Progress:** API + DB + Infra (env) sections.

### Chunk D — Cookie-session auth + admin PIN + OTP + OAuth seams  
**Marker: SAFE NOW**

Collections (scaffold + implement):  
`users`, `authIdentities`, `passwordCredentials`, `pinCredentials`, `authSessions`, `otpChallenges`, `oauthStates`, `passwordResetTokens`, `emailVerificationTokens`, `adminInvites`, `roles` / assignments, `authRateLimits`, `consentEvents`, `auditLogs`, notification channel/outbox/template seams.

- Cookie access/refresh + CSRF (**often-missed cookie domain/SameSite/Secure**); admin vs storefront audiences.
- Admin PIN (onboarding optional + Security Settings; preferred method toggle; 5/15 lockout) — already locked.
- Channel-direct OTP via `NotificationPort` (console adapter in test; MSG91 when creds exist).
- Google/Facebook verify seams (**client id public / secret API-only**); phone OTP schema-only.
- Remove transitional localStorage bearer as the happy path.
- **DoD:** login/register/refresh/logout/me + PIN + OTP tests; every admin write audited.
- **Progress:** Auth & security + Notifications.

### Chunk E — Transaction manager + Mongo adapter upgrade  
**Marker: SAFE NOW**

- `withTransaction()` manager; repositories accept session context.
- Integration tests that rollback on injected failure.
- **DoD:** transaction tests green against Chunk C replica-set profile.
- **Progress:** DB section.

### Chunk F — Catalog, SEO, search, merchandising  
**Marker: SAFE NOW** (with noted seams)

**SAFE NOW collections / APIs:**

- `categories`, `categoryPlacements`, `categoryFacetConfigs`, `categoryRedirects`
- `tags`, `attributeDefinitions`, `addonTemplates` (structure)
- `products`, `productVariants` (status lifecycle, published-only public)
- `productBundles`, `productRelations`, `productGroups` (CRUD + filters)
- `seoRoutes`, `seoRedirects` (provisional locale-prefixed paths — see **G-I18N-ROUTES**)
- `searchDictionary`, `searchOutbox`, `searchQueryAggregates`
- Meilisearch adapter behind `SearchPort`; typeahead; facet listing (**MEILISEARCH_*** env)
- Admin status / sale-status switches + audit + search outbox
- Archived/discontinued → 410 / redirect behaviour

**SEAM NOW (do not pretend final owner policy):**

| Open decision | What to build now | What to defer |
| --- | --- | --- |
| Worksheet §11 / umbrella **B2** SKU | Unique SKU field + optional generator hook | Final auto-format as sole truth |
| §12 / **B3** variant overrides | Overridable price/sale/stock/image/weight fields in schema | Claiming non-overridable set is final without lock |
| §13 / **B4** MRP display | Optional `mrpINR` / compare-at fields | Storefront strike-through rules as locked UX |
| §14 / **B6** deltas & ranges | Add-on `priceDeltaINR` + measurement metadata | Hard validation min/max/units as business law |
| §15 / **B7** relations | Curated relation CRUD | Analytics-fallback ranking as default |
| §16 bundle nesting | Acyclic non-nested default | Nested-bundle launch support |
| §24 / **G4** IDs/slugs | ObjectId `_id` + slug fields + redirect collection | Irreversible “slug never changes” without lock |
| §25 / **F5** badges | `productInsightSets` / `productBadgeAssignments` jobs | Exact badge taxonomy / rail list |

**Also SAFE NOW (often still “open” in umbrella but locked elsewhere):**

- **B5** multi-currency → INR canonical + FX display-convert + PayPal gross-up (treat umbrella B5 as stale-open).
- **B1** role rule → already locked; product data entry is not an architecture gate.

**DoD:** public catalog + admin catalog CRUD; Meili index of published only; search/facet tests.  
**Progress:** API + Search + Integration.

### Chunk G — Cart, checkout, orders, pricing, payment/shipping ports  
**Marker: SEAM NOW** (foundations) / **BLOCKED** (final order numbers + some policy engines)

**SAFE NOW:**

- `carts` (guest + user), guest merge, offline sync validation contract
- Pricing service: INR canonical, tax-inclusive *engine shell*, FX, PayPal gross-up
- `PaymentGatewayPort` + INR/PayPal stub adapters (gateway **role**, not vendor-branched core)
- `ShippingPort` + stub quotes (value + currency)
- Order/payment/shipment/return/refund **document shapes**, ownership checks, idempotency keys, transaction boundaries
- Authenticated order history (no public track-order — locked deferred)

**SEAM NOW:** (same table as prior revision — reservation, backorder, snapshots, addresses, stacking, shipping, tax, returns, ledger-only)

**BLOCKED until G-NUM-ORDER:** allocating customer-facing order / tax-invoice numbers; production “place order” that emits those numbers.

**Often-missed when going live:** webhook verify secrets for PayPal/CCAvenue/Shiprocket; separate sandbox vs prod gateway credentials.

**DoD for G (partial OK):** cart + merge + quote + stub pay/ship + ownership tests; order placement internal-id-only or gated.  
**Progress:** API + Payments/shipping/FX + Integration.

### Chunk H — Inventory, purchase invoices, reporting, insights  
**Marker: SEAM NOW** / **BLOCKED** (PI number on post)

**SAFE NOW:** ledger + FIFO + analytics aggregates + insight/badge job seams.  
**BLOCKED until G-NUM-PI:** posting PIs that assign PI numbers.  
**Progress:** DB + API.

### Chunk I — Privacy, content, FAQ, Q&A, reviews, media  
**Marker: SAFE NOW** (px caps deferred)

- Consent + analytics gating
- FAQ / Q&A / reviews (locked moderation model)
- `mediaAssets` + Spaces SGP presign; video HLS seams
- Image derivative job skeleton; **G-IMG-PX** for real sharp sizes  
**Progress:** Media + Notifications + Storefront/Admin as wired.

### Chunk J — Docs, seeds, verification + infra scripts close-out  
**Marker: SAFE NOW** (with deferred seams listed)

- OpenAPI/runbook/env docs aligned with §0b–0d
- Seeds + bulk fixtures
- Full lint/typecheck/test; report deferred seams
- Ensure **detailed** deploy scripts from §0d exist and are documented (not minimal stubs)
- **Progress:** Developer portal + Infra + Meta; update Open owner gates statuses

---

## 3. Collection scaffold matrix

### Build models/indexes/repos now

`categories`, `categoryPlacements`, `categoryFacetConfigs`, `categoryRedirects`, `tags`, `attributeDefinitions`, `addonTemplates`, `products`, `productVariants`, `productBundles`, `productRelations`, `productGroups`, `seoRoutes`, `seoRedirects`, `searchDictionary`, `searchOutbox`, `searchQueryAggregates`, `mediaAssets`, `reviews`, `faqEntries`, `contentBlocks`, `productInsightSets`, `productBadgeAssignments`, auth family (§ Chunk D), `carts`, `currencies`, `currencyExchangeRates`, `paymentGatewayConfigs`, `paypalCommissionRules`, `shippingProviderConfigs`, `shippingRateQuotes`, `inventoryLedger`, `inventoryCostLayers`, `analyticsEvents`, `analyticsDailyAggregates`, `businessReportSnapshots`, `auditLogs`, notification settings/outbox/templates, `promotions` (schema), `taxClasses`/`taxRules` (generic), `orders`/`payments`/`shipments`/`returns`/`refunds` (shapes + ownership), `purchaseInvoices`/`purchaseInvoiceLines` (drafts).

### Wait for owner lock before final allocator / policy engine

| Collection / concern | Wait on |
| --- | --- |
| `sequences` (order / tax-invoice / PI) | **G-NUM-ORDER**, **G-NUM-PI** |
| Final tax/HSN mandatory assignment | worksheet §02 / **E3** |
| Reservation hold TTL implementation as sole path | §07 / **C1** |
| Backorder public sell-past-zero | §08 / **C2** |
| Promotion stack resolver | §06 / **D5** |
| Checkout shipping policy | §04 / **E2** |
| Returns/refunds customer policy | §05 / **E4** |
| Spendable store credit / points | §19 / **E5** |
| Soft vs hard delete product policy (beyond media orphans) | §22 / **G1** |
| Final slug immutability law | §24 / **G4** |
| Sharp ladder px / ingest caps | **G-IMG-PX** |
| Canonical locale URL law | **G-I18N-ROUTES** |

---

## 4. Suggested owner lock order (to unblock BLOCKED chunks fastest)

1. **§01 numbering** (G-NUM-ORDER + G-NUM-PI) — highest leverage  
2. **§07 + §08** reservation + backorder  
3. **§02 + §04 + §05** tax/HSN, shipping, returns  
4. **§06 + §09 + §10** stacking, snapshots, addresses  
5. **§11–§16** catalog polish  
6. **§19, §22, §24, §25, §27, A.6**  
7. Image px/caps when building sharp worker  

Meanwhile: execute Chunks **A → F** fully; **G/H** up to seams; **I** fully (except sharp px); **J** with deferred list + infra scripts.

---

## 5. What “done” for API+DB means while decisions remain open

Acceptable interim “API+DB foundation done”:

- Phases A–F complete with tests against replica-set Mongo + Meili.
- Auth cookies/CSRF/PIN/OTP/audit live.
- Catalog CRUD + search/facets on seeded data.
- Cart + quote + stub payment/shipping.
- Orders/PI either internal-id test path or explicitly gated at numbering.
- Env/secrets model aligned (§0b); often-missed items from §0c either wired or explicitly deferred with comments.
- OpenAPI documents implemented + deferred seams.
- Remaining worksheet/umbrella items listed as **deferred policy**, not silent assumptions.

Not acceptable while open:

- Inventing final GST slabs, COD, order number formats, stacking rules, or spendable wallet without owner lock.
- Hard-coding CCAvenue/Razorpay in core/UI (gateway role + adapter only).
- Shipping Mongo regex search as storefront typeahead.
- Claiming public track-order is live.
- Baking secrets or prod URLs into Angular builds.
- Minimal/undocumented deploy one-liners instead of §0d detailed scripts.

---

## 6. Traceability map (open queues → this roadmap)

| Worksheet | Umbrella | Roadmap impact |
| --- | --- | --- |
| §01 | D2 | **BLOCKED** sequence allocators (G/H) |
| §02 | E3 | SEAM tax models; BLOCKED final GST |
| §03 ✅ | E1 ✅ | SAFE payments policy |
| §04 | E2 | SEAM shipping port |
| §05 | E4 | SEAM returns FSM |
| §06 | D5 | SEAM promotions |
| §07–08 | C1–C2 | SEAM inventory policy |
| §09 | D3 | SAFE baseline snapshots; refine later |
| §10 | D4 | SEAM addresses |
| §11–16 | B2–B7, B6 rem. | SEAM catalog polish |
| §17 ✅ | (media) | SAFE; px deferred |
| §18 ✅ | C3 ✅ | SAFE reason codes |
| §19 | E5 | SEAM ledger-only |
| §20–21 ✅ | F1, D7 ✅ | SAFE / deferred track |
| §22 | G1 | SEAM soft-delete default |
| §23 ✅ | G2 ✅ | SAFE audit |
| §24 | G4 | SEAM ObjectId+slug |
| §25 | F5 | SEAM badges |
| §26 ✅ | G5 ✅ | SAFE PIN |
| §27 | H | Scope confirmation; seams only |
| A.6 | — | **G-I18N-ROUTES** |

---

## 7. Related files

- **`project-progress.md`** — cross-tool checkpoint (update after every task)
- `api-db-local-environment-bootstrap.md` — local Mongo/tooling handoff
- `environment-variables.md` — env catalogue
- `codex-api-app-build-instructional-prompt.md` — Phases A–J, MUST-ASK gates  
- `codex-catalog-db-architecture-assessment-and-plan.md` — collection shapes  
- `codex-auth-architecture-db-and-request-plan.md` — auth collections  
- `owner-decisions-log.md` — locks  
- `pending-decision-worksheet-2026-07-10.md` — owner fillable queue  
- `db-collection-open-questions-umbrella.md` — DB checklist  
- `msg91-notifications-provider-and-pricing.md` — messaging  
- `execution-roadmap.md` — whole-product phases  
- `AGENTS.md` — constitution  

When an open item is locked: update owner log first, then mark the matching row in worksheet + umbrella + this file’s gate table + `project-progress.md` Open owner gates in the same change set.
