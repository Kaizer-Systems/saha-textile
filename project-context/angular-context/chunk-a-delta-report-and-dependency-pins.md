# Chunk A — Delta Report & Dependency Pins

**Roadmap chunk:** A — Context / delta / dependency pin (**SAFE NOW**; read + document + pin only).
**Date:** 2026-07-24
**Tool:** claude-code
**Branch:** `feat/api-db-env-secrets-sync`
**Scope inspected:** `apps/api`, `packages/contracts`, `packages/core-domain`, `packages/adapters-db-mongo`.

> This is a **documentation + pin** artifact. No ports, contracts, collections, cookie-session,
> or `TRUST_PROXY` wiring are implemented here — those are Chunks B/C/D. Anything ambiguous or
> owner-gated is marked **BLOCKED** and left untouched.

## Authority order applied (on conflict)

`owner-decisions-log.md` → `AGENTS.md` + `codex-api-app-build-instructional-prompt.md` →
catalog/auth architecture plans → technical KB → worksheet/umbrella (open queues, not locks).

## Method

- Read the context pack in order (AGENTS, project-progress, roadmap, owner-decisions-log [full],
  codex API build prompt [full], catalog DB plan [§5, §6, §7.1–7.41, §12, §16], auth plan [full]).
- Enumerated actual source trees of the four packages.
- Scanned code (`apps/**`, `packages/**`, `*.ts`) for stale assumptions: Atlas / `mongodb+srv` /
  Brevo / BillDesk / `blr1` / bearer / localStorage.
- Read the auth stack, infra composition, core ports, and representative contracts/models to
  classify keep / refactor / missing.
- Confirmed the core→adapter boundary (no Nest/Mongoose/adapter imports in `core-domain`).

---

## 0. Executive summary

The env/config layer is already clean (roadmap §0b, done in a prior session). The **code** layer is
an early, honest scaffold: a working NestJS/Fastify skeleton with 7 domain modules, a minimal
hexagonal split (13 ports + Mongo adapters + zod contracts), and a **transitional JSON-bearer** auth
path. Against the target architecture it is roughly **~20–25% of the surface**:

- **Keepable (refactor-in-place):** module/DI structure, config loader, zod-pipe, argon2id hashing,
  pricing pure-domain (money/discount/paypal), self-hosted Mongo connection, the existing 7
  repos/contracts as *cores to widen*.
- **Must refactor:** auth (bearer → cookie-session + CSRF + rotation + audiences + PIN + OTP),
  Fastify bootstrap (no cookie/CSRF/trustProxy/request-id/error-filter/health-split),
  narrow enums (`ProductStatus`, `AuthProvider`, `OrderStatus`), embedded variants, `Category`
  single-parent, `SearchPort` stale comment + no adapter.
- **Missing entirely:** `TransactionManagerPort` + session-aware repos, `NotificationPort`/`EmailPort`,
  `YouTubePort`, `VideoTranscodePort`, auth/session/otp/oauth repos, ~34 of 41 target collections,
  ~28 of ~37 target contract families, Meilisearch/Spaces/payments/shipping/fx adapter packages.

**Stale code to correct (small, safe, but deferred to their owning chunks):** 3 sites — see §1.
None are in the env/config layer.

**Boundary status:** `core-domain` imports **zero** Nest/Mongoose/adapter code (clean). The one
open question is `core-domain` → `packages/contracts` (many ports import `Product`/`User`/etc.).
This is gate **G-CORE-CONTRACTS** — *stated here, not resolved* (owner lock pending; Chunk B).

---

## 1. Stale-assumption scan (CODE only — env/docs already clean)

| # | Location | Stale text | Correct target | Fix owner | Action now |
| --- | --- | --- | --- | --- | --- |
| S1 | `apps/api/src/auth/auth.service.ts:73,75,79` | "Email-OTP via **Brevo** … pending Brevo credentials" (×3) | Channel-direct OTP via `NotificationPort` (MSG91); `console` adapter in dev | Chunk D | **Leave** (auth refactor rewrites this file). Documented. |
| S2 | `apps/api/src/auth/auth.controller.ts:63,69` | `@ApiOperation` summaries "(stub — pending **Brevo** credentials)" | Same as S1 | Chunk D | **Leave** (rewritten in D). Documented. |
| S3 | `packages/core-domain/src/ports/search.port.ts:10` | "Full-text search port (**Mongo Atlas Search** now; swappable later)" | Meilisearch behind `SearchPort` (Mongo = source of truth) | Chunk B/F | **Leave** (comment-only; port is reworked when the Meili adapter lands in B/F). Documented. |

Notes:
- `packages/adapters-db-mongo/src/config.ts:6` matches the scan on the word "Atlas" but it is a
  **negation** ("self-hosted … never Atlas") — **not stale, keep as-is**.
- `bearer` / `localStorage` hits in `apps/admin` + `apps/storefront` interceptors are the **known
  transitional Bearer path** (owner log 2026-07-24: explicitly TRANSITIONAL until Chunk D). Out of
  Chunk A scope; not counted as stale-to-fix.
- **No** BillDesk, `blr1`, or `mongodb+srv` anywhere in code. ✅

> **Chunk A decision:** the 3 stale comments are cosmetic and live inside files that Chunks B/D will
> rewrite wholesale. Editing them now would create churn a later chunk overwrites and risks touching
> auth/port code outside "read + document + pin." They are logged for the owning chunk instead.

---

## 2. `apps/api` — delta

### 2.1 Keep (refactor in place)
- **Composition/DI shape** — `app.module.ts`, `infra/persistence.module.ts` (`@Global`, symbol
  tokens in `infra/tokens.ts`), `config/` (zod `loadConfig`), `common/zod-validation.pipe.ts`.
  Matches the target "composition root binds ports→adapters" pattern.
- **7 domain modules** (auth, cart, catalog, currency, health, orders, promotions) — correct
  bounded-context seeds; will split into `admin-http` / `storefront-http` + `application` per prompt §4.
- `main.ts` already imports `dotenv/config` (§0b) and `enableShutdownHooks()`.

### 2.2 Must refactor
| Area | Current | Target (authority) | Chunk |
| --- | --- | --- | --- |
| **Auth transport** | Access+refresh JWT returned in JSON body (`AuthService.issueTokens`) | httpOnly `__Host-st_access` + opaque rotating `__Host-st_refresh` cookies; no tokens in body for browser | D |
| **Auth guard** | `JwtAuthGuard` reads `Authorization: Bearer` only | Cookie-first guard; bearer fallback only for non-browser; audience (`aud: admin`/`storefront`) enforcement | D |
| **Refresh** | Stateless JWT verify, re-issue (`AuthService.refresh`) | Server-side `authSessions`, rotation + reuse-detection revoking the family | D |
| **CSRF** | none | Signed double-submit `st_csrf` + `X-CSRF-Token` guard on unsafe methods | C/D |
| **Fastify bootstrap** | helmet (CSP off), global rate-limit, CORS | + `@fastify/cookie`, per-route rate-limits, `trustProxy` + `CF-Connecting-IP` resolution, request-id, global error filter, PII-redacted logger | C |
| **Health** | single `HealthModule` (verify controller) | `/health/live` vs `/health/ready` (Mongo/Meili reachability) | C |
| **OpenAPI** | Swagger at `/docs` + `/openapi.json`, `addBearerAuth()` | Scalar `/api/reference` (prod-protected), cookie-auth documented, public/admin tag split | C/J |
| **OTP** | `NotImplementedException` "pending Brevo" | `otpChallenges` + channel-direct via `NotificationPort` | D |
| **OAuth** | `NotImplementedException` stub | Google/Facebook verify + `oauthStates` | D |

### 2.3 Missing entirely
- Modules per prompt §4/§5: `search`, `checkout`, `payments`(+webhooks), `shipping`, `inventory`,
  `pricing`, `content`(faq/qna/reviews), `privacy`(consent), `analytics`, `media`.
- `common/` cross-cutting: error filter, request-id interceptor, redacted logger, serializers,
  `AdminAudienceGuard`/`StorefrontAudienceGuard`/`PermissionGuard`/`CsrfGuard`/`OptionalAuthGuard`.
- Admin PIN login/policy; admin invite/bootstrap; audit-write pipeline.

---

## 3. `packages/contracts` — delta

**Exists (9 files):** `common`, `currency`, `category`, `product`, `promotion`, `cart`, `order`,
`user`, `shipping`.

### 3.1 Keep but widen
| Contract | Gap vs target |
| --- | --- |
| `ProductStatus` (`draft\|published\|archived`) | Add `hidden`, `discontinued` (prompt §12; plan §5). |
| `ProductType` (`simple\|variable`) | Add grouped/bundle/tailoring semantics; option `semanticRole` (`filter_only\|variation_axis\|named_add_on\|bundle_component_option`) + `displayStyle` (6 styles). |
| `Product.variants` (embedded) | Promote to first-class `ProductVariant` contract/collection (plan §5, §7.8). |
| `Category` (single `parentId` + path) | Add `categoryPlacements` (multi-placement DAG) + facet config (plan §7.2/§7.2A). |
| `AuthProvider` (`password\|email_otp\|google\|facebook`) | Add `phone_otp`, `passkey` (auth plan §7.2). |
| `User` | Add phone/`phoneE164`/username/status/`security`(token/permission version, PIN)/`adminProfile` (auth plan §7.1). |
| `ConsentRecord` (necessary/analytics/marketing) | Add `functional`, `targeting`, `promotional`, `policyVersion` (owner GDPR lock 2026-06-29). |
| `OrderStatus` | Reconcile with separate payment/shipment/return/refund state machines (plan §7.20–7.25). |

### 3.2 Missing contract families (target = catalog plan §12 + auth plan §8 + prompt)
Auth/session/consent: `AuthSession`, `AdminAuth`, `SessionResponse`, `EmailOtp*`, `AdminInvite`,
`ConsentEvent`. Catalog/SEO: `CategoryNode`, `CategoryPlacement`, `CategoryRedirect`,
`AttributeDefinition`, `AddonTemplate`, `ProductVariant`, `ProductBundle`, `ProductRelation`,
`ProductGroup`, `SeoRoute`, `SeoRedirect`, `MediaAsset`, `ProductAdminCreate/Update`,
`ProductPublicSummary/Detail`, `CategoryPublicTree`. Search: `SearchDictionaryEntry`,
`SearchSuggestionResponse`. Content: `FaqEntry`, `ContentBlock`, `QuestionAnswer`, `Review`.
Commerce/config: `CurrencyExchangeRate`, `PaymentGatewayConfig`, `PaypalCommissionRule`,
`ShippingRateQuote`, `TaxClass/TaxRule`. Inventory/reporting: `PurchaseInvoice`,
`PurchaseInvoiceLine`, `InventoryCostLayer`, `AnalyticsEvent`, `AnalyticsDailyAggregate`,
`BusinessReportSnapshot`, `ProductInsightSet`, `ProductBadgeAssignment`. Notifications:
`NotificationChannelSettings`, `NotificationTemplate`, `MessageOutbox`. Checkout: `CheckoutQuote`,
`PlaceOrder`. Audit: `AuditLog`.

> **G-CORE-CONTRACTS caveat:** contract-family expansion is Chunk B and depends on the core↔contracts
> direction lock. Prompt/plan want per-shape DTO split (DB / adminCreate / adminUpdate / publicResponse
> / searchResponse / bulk). Not designed here.

---

## 4. `packages/core-domain` — delta

**Exists — 13 ports:** `pagination`, `catalog.repository`, `order.repository`, `cart.repository`,
`user.repository`, `currency.repository`, `promotion.repository`, `storage.port`,
`payment-gateway.port`, `shipping.port`, `fx-rate.port`, `search.port`, `auth.port`.
**Pricing (pure domain):** `money`, `discount`, `paypal`.

### 4.1 Keep
- Pure pricing (`money`/`discount`/`paypal`) — canonical-INR + PayPal gross-up direction is correct.
- `StoragePort`, `PaymentGatewayPort` (gateway-role, vendor-neutral), `ShippingPort`, `FxRatePort` —
  shapes are keepable seeds; widen as adapters land.
- Repo ports are usable cores; must gain **session/transaction context** params (Chunk E).

### 4.2 Must refactor
| Port | Gap |
| --- | --- |
| `AuthPort` | Minimal (hash/verify/sign). Target `AuthCryptoPort` adds opaque-token gen/hash, OTP gen/hash/verify, constant-time compare (auth plan §9.1). `TokenClaims` needs `aud/sid/jti/tokenVersion/permissionsVersion`. |
| `UserRepository` | Only `findById/findByEmail/findCredentialByEmail/save/setPasswordHash`. Target splits into user + `authIdentities` + `passwordCredentials` + `pinCredentials` repos. |
| `SearchPort` | Stale "Atlas Search" comment (S3); shape (`indexProduct/removeProduct/search`) is thin vs typeahead+facets+suggestions+dictionary; no adapter bound. |

### 4.3 Missing ports
`TransactionManagerPort` / `UnitOfWorkPort` (prompt §8 — **prereq for every atomic write**);
`NotificationPort` (+ `EmailPort` under it, MSG91); `YouTubePort`; `VideoTranscodePort`
(AGENTS §3, video lock 2026-07-18); `AuthSessionRepository`, `IdentityRepository`, `OtpRepository`,
`OAuthStateRepository` (auth plan §9.1); audit/reporting ports; `CategoryRepository`
placement/facet methods; inventory/purchase-invoice repos.

### 4.4 Boundary assessment (hexagonal)
- ✅ `core-domain` imports **no** `@nestjs/*`, `mongoose`, or `@saha-textile/adapters-*`. Clean.
- ✅ No Mongoose docs leak into core (repos return contract types).
- ⚠️ **Open (not a violation to fix here):** `core-domain` → `@saha-textile/contracts` (zod) across
  most ports (`search.port` imports `Product`, `user.repository` imports `User`, etc.). AGENTS §3
  says "core depends on NOTHING external"; the plan wants contracts→core (inward). This is
  **G-CORE-CONTRACTS** — owner lock pending, resolved early in Chunk B. **Do not spread or silently
  resolve** (owner-decisions-log Pass-4 reconciliation gate).

---

## 5. `packages/adapters-db-mongo` — delta

**Exists:** `config` (self-hosted URI builder, clean), `connection` (idempotent connect), `mappers`,
7 models + 7 repos (cart, category, currency, order, product, promotion, user), `seed`.

### 5.1 Keep
- `config.ts` self-hosted `mongodb://` builder (host/port/`replicaSet=rs0`/`directConnection`,
  optional auth, `%40` encoding) — done in §0b, correct.
- Connection singleton + `strictQuery`.
- 7 repos/models as cores to widen.

### 5.2 Must refactor
| Item | Gap | Chunk |
| --- | --- | --- |
| `connection.ts` | No session/`withTransaction()` helper; no `TransactionManagerPort` impl | E |
| repos | None accept an optional session/context (prompt §8: no atomic writes possible today) | E |
| `user.model.ts` | `passwordHash` embedded (target: separate `passwordCredentials`); `identities`/`addresses` are `Mixed`; only `{email}` unique-sparse index | D |
| `category.model` | Single-parent + path; needs placements | F |
| `product.model` | Embedded variants; needs first-class `productVariants` + status lifecycle | F |
| `order.model` | Snapshots present, but payment/shipment/return/refund not separated | G |

### 5.3 Missing (≈34 of 41 target collections — see §6 matrix)
All auth-family (`authSessions`, `authIdentities`, `passwordCredentials`, `pinCredentials`,
`otpChallenges`, `oauthStates`, `passwordResetTokens`, `emailVerificationTokens`, `adminInvites`,
`roles`/`userRoleAssignments`, `authRateLimits`, `consentEvents`, `auditLogs`), catalog-target
(placements, facet configs, redirects, tags, attributes, addons, variants, bundles, relations,
groups, seoRoutes/Redirects, mediaAssets), search (dictionary/outbox/aggregates), commerce
(payments/shipments/returns/refunds, tax, currencies-FX, gateway/commission/shipping configs +
quotes), inventory (purchaseInvoices/Lines, ledger, cost layers), reporting
(analyticsEvents/aggregates, snapshots, insightSets, badgeAssignments), reviews/faq/content,
notifications (channel settings/templates/outbox). No `sequences` (BLOCKED: G-NUM-ORDER/PI).

---

## 6. Target-collection matrix (catalog plan §7.1–7.41 + auth plan §7 + notifications lock)

Legend: **✅ exists** · **↺ refactor** (partial today) · **✗ missing** · chunk = build owner.

| Collection | State | Chunk | Note |
| --- | --- | --- | --- |
| categories | ↺ | F | single-parent → keep + add placements |
| categoryPlacements | ✗ | F | multi-placement DAG |
| categoryFacetConfigs | ✗ | F | sidebar facet source of truth |
| categoryRedirects | ✗ | F | |
| tags | ✗ | F | |
| attributeDefinitions | ✗ | F | reusable option/attribute master |
| addonTemplates | ✗ | F | named add-on groups |
| products | ↺ | F | widen status; de-embed variants |
| productVariants | ✗ | F | first-class SKU rows |
| productBundles | ✗ | F (seam) | acyclic non-nested default |
| productRelations | ✗ | F | cross/up/bought-together |
| productGroups | ✗ | F | rails/lookbook/SEO groups |
| seoRoutes | ✗ | F | G-I18N-ROUTES governs locale prefix |
| seoRedirects | ✗ | F | Woo legacy + slug changes |
| mediaAssets | ✗ | I | Spaces SGP; G-IMG-PX for px |
| searchDictionary | ✗ | F | aliases/transliteration |
| searchOutbox | ✗ | F | reindex queue |
| searchQueryAggregates | ✗ | F | no-result learning |
| promotions | ↺ | F/G | promotion contract exists; stacking = SEAM |
| orders | ↺ | G | snapshots exist; numbering BLOCKED G-NUM-ORDER |
| payments | ✗ | G | |
| shipments | ✗ | G | |
| returns | ✗ | G | |
| refunds | ✗ | G | |
| taxClasses / taxRules | ✗ | G (seam) | final GST BLOCKED (worksheet §02) |
| auditLogs | ✗ | C/D+ | broad admin-write audit (lock 2026-07-23) |
| faqEntries / contentBlocks | ✗ | I | |
| reviews | ✗ | I | verified-purchase + moderation |
| currencies | ✅ | — | keep; widen `rateFromINR` |
| currencyExchangeRates | ✗ | G | FX history |
| paymentGatewayConfigs | ✗ | G | non-secret config only |
| paypalCommissionRules | ✗ | G | versioned + calculator |
| shippingProviderConfigs | ✗ | G | domestic/intl lanes |
| shippingRateQuotes | ✗ | G | |
| purchaseInvoices / …Lines | ✗ | H | posting BLOCKED G-NUM-PI |
| inventoryLedger | ✗ | H | reason codes (lock 2026-07-23) |
| inventoryCostLayers | ✗ | H | FIFO COGS |
| analyticsEvents | ✗ | H | ~90d retention |
| analyticsDailyAggregates / businessReportSnapshots | ✗ | H | |
| productInsightSets | ✗ | H | weekly job |
| productBadgeAssignments | ✗ | H | storefront rails/cards |
| **Auth family** (authSessions, authIdentities, passwordCredentials, pinCredentials, otpChallenges, oauthStates, passwordResetTokens, emailVerificationTokens, adminInvites, roles, userRoleAssignments, authRateLimits, consentEvents) | ✗ | D | auth plan §7 |
| **Notifications** (notificationChannelSettings, notificationTemplates, messageOutbox/notificationLog) | ✗ | B/D/I | MSG91 seam |
| carts | ✅ | — | keep; add guest merge + TTL (G) |
| users | ↺ | D | split credentials out |
| sequences (order/tax-invoice/PI) | ✗ | **BLOCKED** | G-NUM-ORDER + G-NUM-PI |

**Tally:** 7 of ~48 target collections exist in some form (currencies, carts, users, categories,
products, orders, promotions); ~41 missing/seam; 1 BLOCKED allocator family.

---

## 7. Open gates touched by this delta (status only — not resolved here)

- **G-CORE-CONTRACTS** — core→contracts import direction. *Stated* (§4.4). Resolve early in Chunk B.
- **G-NUM-ORDER / G-NUM-PI** — `sequences` allocators. Not designed; BLOCKED.
- **G-I18N-ROUTES** — governs `seoRoutes` locale-prefix policy. Provisional only.
- **G-IMG-PX** — governs `mediaAssets` derivative px. Roles locked, px deferred.

---

## 8. Dependency pins

**Context7 availability:** the Context7 MCP server is **not connected** in this session (no
`resolve-library-id` / `get-library-docs` tools registered). Per AGENTS §2 + the 2026-07-02
dependency-policy lock, pins are grounded on the **pnpm lockfile (installed) versions** — ground
truth that is conflict-free by construction (the workspace already resolves + builds). Not-yet-installed
future deps are recorded as **advisory** only; their exact patch is to be finalized via Context7 /
lockfile at the moment each is actually added (its chunk). No exact version is invented for an
uninstalled package.

### 8.1 Applied pins (installed API-stack deps — pure pins, no major change)

Converted caret ranges → the exact installed version (verified via lockfile). Diff = specifier text
only; `pnpm install` added/downloaded **0** packages (resolution unchanged).

| Package | Was | Pinned | Major (line) | Manifest | Rationale |
| --- | --- | --- | --- | --- | --- |
| `@fastify/helmet` | `^13.0.2` | `13.1.0` | 13 (Fastify 5) | apps/api | security headers |
| `@fastify/rate-limit` | `^11.0.0` | `11.1.0` | 11 (Fastify 5) | apps/api | rate limiting |
| `@fastify/static` | `^9.1.3` | `9.3.0` | 9 (Fastify 5) | apps/api | static assets (Scalar/docs) |
| `@nestjs/swagger` | `^11.4.4` | `11.4.5` | 11 | apps/api | OpenAPI generation |
| `argon2` | `^0.44.0` | `0.44.0` | 0.44 | apps/api | argon2id password/PIN hashing |
| `dotenv` | `^17.4.2` | `17.4.2` | 17 | apps/api | `.env` load (Nest CLI doesn't) |
| `jsonwebtoken` | `^9.0.3` | `9.0.3` | 9 | apps/api | JWT (transitional; `jose` candidate in D) |
| `@types/jsonwebtoken` | `^9.0.10` | `9.0.10` | 9 | apps/api (dev) | JWT types |
| `@types/node` | `^24` | `24.13.3` | 24 | root (dev) | Node 24 types (`engines: node >=24`) |

### 8.2 Already exact-pinned (verified installed = declared; no change needed)

`@nestjs/common` / `@nestjs/core` / `@nestjs/platform-fastify` **11.1.27**, `@nestjs/cli` 11.0.23,
`@nestjs/schematics` 11.1.0, `@nestjs/testing` 11.1.27, `reflect-metadata` 0.2.2, `rxjs` 7.8.2,
`zod` **4.4.3** (contracts/api/adapters), `mongoose` **9.7.2** (adapters), `vitest` 4.1.9,
`typescript` 6.0.3, `tsx` 4.22.4, `eslint` 10.5.0, `prettier` 3.8.4, `turbo` 2.10.0.
Toolchain: `packageManager` = `pnpm@11.9.0`; `engines.node` = `>=24` (`.nvmrc` per AGENTS §2).

### 8.3 Cross-compatibility

- **Fastify 5 line is coherent:** `@nestjs/platform-fastify@11` targets Fastify 5; the pinned
  `@fastify/*` plugins (helmet 13, rate-limit 11, static 9) are the Fastify-5 majors. No mismatch.
- **zod 4** is shared uniformly across `contracts` / `api` / `adapters-db-mongo` (4.4.3). Single major.
- **mongoose 9** bundles a MongoDB driver that supports `withTransaction()` against the single-node
  `rs0` (Chunk E prerequisite — no separate `mongodb` dep needed for sessions).
- No latest-together conflict surfaced among installed deps. **BLOCKED for owner: none.**

### 8.4 Advisory future pins (NOT installed, NOT applied — finalize at add-time per chunk)

Recorded so the stack is planned; do **not** add these in Chunk A. Exact patch via Context7/lockfile
when the owning chunk installs them.

| Dep | Purpose | Chunk | Major line to match | Note |
| --- | --- | --- | --- | --- |
| `@fastify/cookie` | cookie parse/set | C/D | v11 (Fastify 5) | required for cookie sessions |
| `@fastify/csrf-protection` *or* custom CSRF guard | double-submit CSRF | C/D | v7 (Fastify 5) | auth plan §13 prefers evaluating a custom guard for zod/session fit |
| `jose` | modern JWT/JWK, key rotation | D | v5+ | candidate to replace `jsonwebtoken@9` — **owner call in D**, not a version conflict |
| `google-auth-library` | Google ID-token verify | D | latest | OAuth (`sub` as `providerSubject`) |
| `undici` | Meta token/profile/debug calls | D | Node-bundled or explicit | Facebook verify |
| `meilisearch` (JS client) | `SearchPort` adapter | F | align to self-hosted Meili **server** version | client/server majors must match |
| `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | Spaces (S3-compatible, SGP) | F/I | v3 | presigned direct-to-Spaces |
| `bullmq` + `ioredis` | job queue + broker (video HLS / image derivatives) | I | latest; needs Docker Redis | AGENTS §3 + video/image locks 2026-07-18 |
| `sharp` (libvips) | image derivative ladder | I | latest | px ladder BLOCKED (G-IMG-PX) |
| `@nestjs/terminus` (optional) | health readiness checks | C | 11 (match Nest) | or hand-rolled `/health/ready` |

> **Policy note (AGENTS §2 / lock 2026-07-02):** none of the applied pins cross a major boundary;
> all are pure pins of already-resolved versions. If a future add surfaces a latest-together conflict,
> it is surfaced as **BLOCKED** for an owner call — never silently downgraded.

---

## 9. Recommended build order (delta-derived; mirrors roadmap A→J)

1. **Chunk B** — resolve G-CORE-CONTRACTS; widen contracts + add missing ports
   (`TransactionManagerPort`, `NotificationPort`/`EmailPort`, auth/session/otp/oauth repos,
   `YouTubePort`, `VideoTranscodePort`); boundary ESLint (core forbids Nest/Mongoose/SDK).
2. **Chunk C** — Fastify security bootstrap (cookie/CSRF/trustProxy/`CF-Connecting-IP`/request-id/
   error-filter/health-split); fix S1–S3 stale comments as they are touched.
3. **Chunk D** — cookie-session auth + PIN + OTP + OAuth; retire bearer happy path; split credentials.
4. **Chunk E** — `TransactionManagerPort` impl + session-aware repos.
5. **Chunks F→J** — catalog/search/SEO → cart/checkout/orders (seam; numbering BLOCKED) →
   inventory/reporting (PI BLOCKED) → privacy/content/reviews/media → docs/seeds/infra close-out.
