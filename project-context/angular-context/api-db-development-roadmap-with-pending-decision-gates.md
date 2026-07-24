# API + DB Development Roadmap (with pending-decision gates)

**Status:** Working plan for agents/humans.  
**Date:** 2026-07-24  
**Verdict:** Open items in `pending-decision-worksheet-2026-07-10.md` and `db-collection-open-questions-umbrella.md` do **not** block starting API/DB foundations. General structure, ports, security, Mongo replica-set infra, auth, catalog core, search seams, and most collection scaffolds can proceed while the owner confirms remaining business rules.

**Authoritative precedence (on conflict):**

1. `owner-decisions-log.md`
2. `AGENTS.md` + `codex-api-app-build-instructional-prompt.md`
3. Catalog / auth architecture plans
4. Technical KB
5. Pending worksheet + DB umbrella (working queues — not locks until folded into #1)

**Cadence:** Follow API prompt Phases **A → J**, one phase per run/session, with §21 test gates and owner review between phases. Do not attempt A–J in one pass.

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
| `docker/mongo/docker-compose.yml` | Mongo 8.3 single-node `rs0`, volume `saha_mongo_data`, loopback publish |
| `pnpm mongo:up` / `mongo:down` / `mongo:status` / `mongo:wipe` | Lifecycle scripts |
| `apps/api/.env.example` | Self-hosted `MONGODB_*` (not Atlas) |
| `.env.mcp.example` | LOCAL MCP URI → local Docker RS |

### Bring Mongo up

```bash
docker ps          # must succeed first
pnpm mongo:up
pnpm mongo:status
```

URI: `mongodb://127.0.0.1:27017/saha_local?replicaSet=rs0&directConnection=true`  
**API-only** access path in architecture; Angular apps never hold this URI.

### Not required to start Phases A–E

Live MSG91, Spaces, OAuth, CCAvenue/PayPal/Shiprocket credentials, Meilisearch (needed from Phase F), GitHub/DO MCP (E2E only).

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

**Architecture reconciliation (do early in Phase B):** resolve whether `core-domain` may import `packages/contracts` (Pass 4 gate). Prefer core free of Zod/contracts; contracts depend inward. Do not silently spread an exception.

---

## 1. Hard gates (only these truly stop later chunks)

| Gate | Source | Blocks |
| --- | --- | --- |
| **G-NUM-ORDER** — order / tax-invoice numbering (Mode A FY-reset vs B perpetual; format; gapless; separate sequences) | owner log 2026-07-05; API prompt §14; worksheet §01; umbrella **D2** | Final order placement issuing customer-facing numbers; tax invoice PDFs; `sequences` allocator for those docs |
| **G-NUM-PI** — purchase-invoice numbering (separate sequence, same format rules) | API prompt §16; worksheet §01 | Purchase-invoice **posting** that assigns PI numbers |
| **G-CORE-CONTRACTS** — core ↔ contracts dependency direction | owner log Pass 4 | Expanding Phase B incorrectly if core already imports contracts |
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

### Chunk B — Contracts + core ports  
**Marker: SAFE NOW** (after **G-CORE-CONTRACTS** rule is stated)

- Expand zod families: auth/session/consent, catalog, search, cart, checkout/order *shapes*, inventory, pricing, FAQ/Q&A, reviews, media, audit.
- Expand ports: `TransactionManagerPort`, auth/session repos, `SearchPort`, `StoragePort`, `PaymentGatewayPort`, `ShippingPort`, `FxRatePort`, `NotificationPort`/`EmailPort`, `YouTubePort`, `VideoTranscodePort`, audit/reporting ports.
- ESLint boundary: core forbids Nest/Mongoose/SDK imports.
- **SEAM NOW** for open policy fields: promotion stacking flags, tax/HSN optional fields, reservation policy config, SKU strategy helpers as interfaces — not hard-coded final engines.
- **DoD:** packages typecheck; boundary lint green; unit tests on contracts/ports.

### Chunk C — API security foundation + Mongo replica-set test profile  
**Marker: SAFE NOW**

- Fastify cookies, CSRF guard, CORS allowlist, rate-limit, request id, redacted logger, error filter, readiness vs liveness, OpenAPI bootstrap.
- Runtime config / `.env.example`: Mongo replica URI, Meili, Spaces SGP, Cloudflare→Nginx IP/`trustProxy`, cookie names, MSG91/console notification adapters.
- **Hard deliverable:** Docker Compose single-node replica-set profile for local + CI transaction tests.
- **DoD:** API boots; security bootstrap tests; replica-set profile documented and used in CI.

### Chunk D — Cookie-session auth + admin PIN + OTP + OAuth seams  
**Marker: SAFE NOW**

Collections (scaffold + implement):  
`users`, `authIdentities`, `passwordCredentials`, `pinCredentials`, `authSessions`, `otpChallenges`, `oauthStates`, `passwordResetTokens`, `emailVerificationTokens`, `adminInvites`, `roles` / assignments, `authRateLimits`, `consentEvents`, `auditLogs`, notification channel/outbox/template seams.

- Cookie access/refresh + CSRF; admin vs storefront audiences.
- Admin PIN (onboarding optional + Security Settings; preferred method toggle; 5/15 lockout) — already locked.
- Channel-direct OTP via `NotificationPort` (console adapter in test).
- Google/Facebook verify seams; phone OTP schema-only.
- **DoD:** login/register/refresh/logout/me + PIN + OTP tests; every admin write audited.

### Chunk E — Transaction manager + Mongo adapter upgrade  
**Marker: SAFE NOW**

- `withTransaction()` manager; repositories accept session context.
- Integration tests that rollback on injected failure.
- **DoD:** transaction tests green against Chunk C replica-set profile.

### Chunk F — Catalog, SEO, search, merchandising  
**Marker: SAFE NOW** (with noted seams)

**SAFE NOW collections / APIs:**

- `categories`, `categoryPlacements`, `categoryFacetConfigs`, `categoryRedirects`
- `tags`, `attributeDefinitions`, `addonTemplates` (structure)
- `products`, `productVariants` (status lifecycle, published-only public)
- `productBundles`, `productRelations`, `productGroups` (CRUD + filters)
- `seoRoutes`, `seoRedirects` (provisional locale-prefixed paths — see **G-I18N-ROUTES**)
- `searchDictionary`, `searchOutbox`, `searchQueryAggregates`
- Meilisearch adapter behind `SearchPort`; typeahead; facet listing
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

### Chunk G — Cart, checkout, orders, pricing, payment/shipping ports  
**Marker: SEAM NOW** (foundations) / **BLOCKED** (final order numbers + some policy engines)

**SAFE NOW:**

- `carts` (guest + user), guest merge, offline sync validation contract
- Pricing service: INR canonical, tax-inclusive *engine shell*, FX, PayPal gross-up
- `PaymentGatewayPort` + INR/PayPal stub adapters (gateway **role**, not vendor-branched core)
- `ShippingPort` + stub quotes (value + currency)
- Order/payment/shipment/return/refund **document shapes**, ownership checks, idempotency keys, transaction boundaries
- Authenticated order history (no public track-order — locked deferred)

**SEAM NOW:**

| Open decision | Seam now | Blocked final |
| --- | --- | --- |
| §07 / **C1** reservation | Policy interface + config key | Hard-coding checkout-start vs place-order as only path |
| §08 / **C2** backorder | Per-product flag field | Public oversell behaviour |
| §09 / **D3** snapshots | Rich bounded snapshot baseline from catalog §7.20 / API §14 | Treating owner refinement as a freeze on coding the baseline |
| §10 / **D4** addresses | Multi-address model; phone optional field | Making phone required without lock |
| §06 / **D5** stacking | Promotion collection + priority fields | Final stack resolver rules |
| §04 / **E2** shipping | Port + quote TTL + domestic/international lanes | Zone/weight/free-threshold as sole launch policy |
| §02 / **E3** tax/HSN | `taxClasses` / `taxRules` generic + snapshot slots | Publishing final GST/HSN enforcement |
| §05 / **E4** returns | Return/refund state machine collections | Customer windows / refund method policy |
| §19 / **E5** ledger | Ledger-only reporting rows seam | Spendable store credit / wallet / points engine |

**BLOCKED until G-NUM-ORDER:**

- Allocating customer-facing order / tax-invoice numbers
- “Place order” that emits those numbers as production behaviour  
  *(You may still implement cart → quote → create *internal* order draft with ObjectId only, behind a feature flag, if useful for tests — but do not ship public order numbers.)*

**DoD for G (partial OK):** cart + merge + quote + stub pay/ship + ownership tests; order placement either flagged internal-id-only or paused at numbering gate with explicit skip note.

### Chunk H — Inventory, purchase invoices, reporting, insights  
**Marker: SEAM NOW** / **BLOCKED** (PI number on post)

**SAFE NOW:**

- `inventoryLedger` with locked manual `reasonCode` taxonomy
- `inventoryCostLayers` FIFO from purchase lines (COGS hidden)
- Analytics events → daily aggregates → `businessReportSnapshots`
- Weekly `productInsightSets` + `productBadgeAssignments` (taxonomy configurable)
- Dashboard/report read APIs that do not depend on open badge list

**SEAM NOW:**

- Purchase invoice **draft** create/edit; stock receive preview
- Reservation/backorder policy still config-driven

**BLOCKED until G-NUM-PI:**

- Posting purchase invoices that assign PI numbers

**DoD (partial OK):** ledger + FIFO from draft/fixture posts in tests; posting path stops or uses internal ids until numbering lock.

### Chunk I — Privacy, content, FAQ, Q&A, reviews, media  
**Marker: SAFE NOW** (px caps deferred)

- Consent + analytics gating
- FAQ targeting + preview; customer Q&A + admin answer/email
- Reviews: verified purchase + moderation + aggregates (locked)
- `mediaAssets` + presigned Spaces upload; video HLS pipeline seams
- Image derivative **job skeleton**; **G-IMG-PX** for real sharp sizes/caps

**DoD:** content/review/media happy paths tested; derivative worker may stub sizes.

### Chunk J — Docs, seeds, verification  
**Marker: SAFE NOW** (with deferred seams listed)

- OpenAPI/runbook/env docs
- Seeds: multi-placement categories, No Stitching / named add-on saree, bundle seam, dictionary, admin bootstrap, bulk published+archived products
- Full lint/typecheck/test; report remaining deferred seams (numbering, stacking, shipping policy, returns, ledger spend, image px, i18n routes)

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

Priority for unblocking commerce finish-lines (not for starting foundations):

1. **§01 numbering** (G-NUM-ORDER + G-NUM-PI) — highest leverage  
2. **§07 + §08** reservation + backorder — checkout correctness  
3. **§02 + §04 + §05** tax/HSN, shipping, returns — checkout/fulfil  
4. **§06 + §09 + §10** stacking, snapshots refine, addresses  
5. **§11–§16** catalog polish (SKU/MRP/overrides/relations/bundles)  
6. **§19, §22, §24, §25, §27, A.6** — ledger, retention, IDs, badges, scope, i18n routes  
7. Image px/caps when building sharp worker  

Meanwhile: execute Chunks **A → F** fully; **G/H** up to seams; **I** fully (except sharp px); **J** with deferred list.

---

## 5. What “done” for API+DB means while decisions remain open

Acceptable interim “API+DB foundation done”:

- Phases A–F complete with tests against replica-set Mongo + Meili.
- Auth cookies/CSRF/PIN/OTP/audit live.
- Catalog CRUD + search/facets on seeded data.
- Cart + quote + stub payment/shipping.
- Orders/PI either internal-id test path or explicitly gated at numbering.
- OpenAPI documents implemented + deferred seams.
- Remaining worksheet/umbrella items listed as **deferred policy**, not silent assumptions.

Not acceptable while open:

- Inventing final GST slabs, COD, order number formats, stacking rules, or spendable wallet without owner lock.
- Hard-coding CCAvenue/Razorpay in core/UI (gateway role + adapter only).
- Shipping Mongo regex search as storefront typeahead.
- Claiming public track-order is live.

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

- `codex-api-app-build-instructional-prompt.md` — Phases A–J, MUST-ASK gates  
- `codex-catalog-db-architecture-assessment-and-plan.md` — collection shapes  
- `codex-auth-architecture-db-and-request-plan.md` — auth collections  
- `owner-decisions-log.md` — locks  
- `pending-decision-worksheet-2026-07-10.md` — owner fillable queue  
- `db-collection-open-questions-umbrella.md` — DB checklist  
- `execution-roadmap.md` — whole-product phases (admin/storefront after API foundations)  
- `AGENTS.md` — constitution  

When an open item is locked: update owner log first, then mark the matching row in worksheet + umbrella + this file’s gate table in the same change set.
