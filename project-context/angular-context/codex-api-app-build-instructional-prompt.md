# Codex API App Build Instructional Prompt for Cursor

Created: 2026-07-01
Purpose: One reviewable, Cursor-ready prompt for building/refactoring `apps/api` as the enterprise backend for the Saha Textile admin and storefront apps.
Scope: Planning/instruction only. This file does not implement code.

## Review Baseline Before The Prompt

- Build target: `apps/api` is the only HTTP backend for both `sahatextile.com` and `admin.sahatextile.com`; storefront and admin never talk directly to MongoDB, Meilisearch, Spaces, payment gateways, or shipping providers.
- Latest source of truth: `owner-decisions-log.md` overrides stale Atlas M0, Caddy, Tailwind, shadcn, Brevo-lock-in, and old bearer-token assumptions that still appear in older KB files.
- Architecture floor: hexagonal ports/adapters, contracts-first DTOs, domain use cases behind interfaces, no Mongoose/provider objects leaking into controllers or Angular clients.
- Swappability rule: UI, API, DB, search, storage, payments, shipping, email, analytics, and proxy must all be replaceable through layers; swapping one must not force a full rewrite of the others.
- Backend stack: NestJS 11 on Fastify, pnpm/Turborepo, TypeScript, zod contracts, Mongoose/Mongo adapter packages, OpenAPI, Vitest, Fastify security plugins, Docker-ready runtime config.
- Deployment target: one DigitalOcean $24 droplet at launch running Nginx, storefront, admin static/SPA, API, dockerized MongoDB 8.3 single-node replica set, self-hosted Meilisearch, with Spaces SGP for media.
- Reverse proxy: Nginx is the **origin** reverse proxy (Caddy superseded). **Cloudflare (free) sits in front** (DNS already delegated to Cloudflare; site already proxied). Do not generate Caddy guidance.
- Edge architecture (LOCKED 2026-07-02): the Cloudflare edge is **adapter/toggle-based** — if no explicit in-code/droplet config exists, the Cloudflare free-dashboard settings take effect; explicit codebase/droplet config overrides. **TLS:** default = Cloudflare Universal SSL at edge + **Full (Strict)** origin using a free **Cloudflare Origin CA cert** on Nginx; override = **Certbot/Let's Encrypt** publicly-trusted origin cert when configured. **CDN/cache:** default = Cloudflare honors origin `Cache-Control`; override = explicit Nginx/app headers + Cloudflare Cache Rules. **Security:** Cloudflare free WAF/DDoS/rate-limit at edge, with app-level (`@fastify/rate-limit`) + Nginx limits always on as defense-in-depth. **Mandatory origin hardening:** API `trustProxy` + read `CF-Connecting-IP` for the real client IP; lock the droplet firewall to Cloudflare IP ranges so the origin can't be bypassed.
- Email (LOCKED 2026-07-02): Hostinger discontinued at go-live. **Team mailboxes** (`admin@`/`support@`) = **Google Workspace** (separate system from app messaging; Cloudflare = DNS). **Inbound** operational mail handled by Google Workspace MX. **Outbound app email** (OTP + order/account/Q&A/reset/invite + marketing) flows through `EmailPort` under the unified `NotificationPort` below.
- Notifications (LOCKED 2026-07-05): all customer messaging — **OTP/verification, order & account updates, admin marketing/promotional** — across **SMS / email / WhatsApp** flows through a core-domain **`NotificationPort`** with per-channel adapters + a provider adapter. **Provider = MSG91 (LOCKED)** for all three channels; **email consolidated into MSG91** (Resend/SES = code-only `EmailPort` fallback). Pricing / hybrid billing / tool-map / use-case credit map: see **`msg91-notifications-provider-and-pricing.md`**. **Channel-direct OTP** (we own generate/store/verify; MSG91 OTP-Widget/SendOTP NOT used). **Split kill-switches** (transactional vs marketing, per channel). **Seam-first**: build ports + adapters + admin UI now, wire the live MSG91 account once DLT + WhatsApp template approvals land. All 3 channels ship code-ready.
- Channel control (LOCKED 2026-07-02): admin panel exposes **per-channel master toggles** (email/SMS/WhatsApp on/off) that **short-circuit all outbound calls on a disabled channel across every flow**; graceful OTP fallback to an enabled channel. **Plan-limit awareness** warns/auto-disables a channel near its purchased limit (spend control; WhatsApp marketing ~₹0.86/msg is the dominant cost). Marketing sends are **consent-gated** (`consentEvents`) and require approved DLT/WhatsApp templates. These settings are on a **dedicated RBAC-gated admin page/menu (high-privilege only), authorized server-side** (not UI-only), audited, with permission-version bump on change. New collections: `notificationChannelSettings`, `messageOutbox`/`notificationLog`, `notificationTemplates`.
- Database decision: no MongoDB Atlas dependency at launch; MongoDB runs in Docker, private Docker network only, port 27017 not public, named volume or bind mount, resource caps, healthchecks, weekly backups.
- Transaction rule: enable a single-node replica set and use Mongo sessions/`withTransaction()` for atomic multi-collection writes such as order placement and purchase invoice posting.
- Search decision: self-host Meilisearch behind `SearchPort`; Mongo remains source of truth; Meilisearch is a rebuildable derived index with dictionary/outbox/aggregate collections.
- Search quality floor: 3+ character typeahead, typo tolerance, missing-character tolerance, Bengali-English aliases/transliteration, spelling suggestions, no-result learning, facets, ranking boosts, and fast responses.
- Admin rendering decision: admin is an Angular Router feature-based lazy-loaded app, not SSR; API still exposes strict admin APIs, auth, audit, and OpenAPI for it.
- Storefront decision: public Angular/Analog SSR/SSG PWA; API must support public catalog, SEO data, offline catalog reads, offline cart sync, cookie consent, search, checkout, and authenticated account flows.
- Auth floor: API-set httpOnly cookies, signed double-submit CSRF, short access JWT cookie, opaque rotating refresh cookie, reuse detection, cookie-first guard with bearer fallback only for non-browser clients.
- Login decisions: storefront supports email/password, Google, Facebook, guest cart, email OTP, and a seam for phone OTP; X excluded; phone OTP not implemented. **Email OTP is LOCKED (2026-07-02) to a transactional provider free tier via `EmailPort` — primary Resend, adapter-swappable (MailerSend/SES)**, $0 at launch, no Brevo lock-in. OTP "send code" uses a **generic anti-enumeration response**.
- Admin login decisions: admin/staff use email-or-username plus password, no MFA at launch, optional 6-digit PIN alternative with strict weak-PIN rejection and the same session security as password login.
- Password/PIN floor: passwords >= 12 characters for storefront and admin; common-password denylist; admin PIN must reject repeated/sequential/common values such as `000000`, `123456`, `012345`, `111111`.
- OAuth decision: Google and Facebook provider buttons/SDK UX may be used, but backend verifies provider data and owns the session; request minimum scopes only.
- Privacy/GDPR floor: self-hosted granular consent, no paid CMP; categories include strictly necessary, functional, targeting, marketing, promotional; block non-essential tracking until consent.
- PWA offline floor: offline means public catalog browsing and offline cart only; no account, order, admin, auth, payment, or PII data cached or displayed offline.
- Offline cart sync: on reconnect validate availability/status first, then inventory; unavailable products get clear errors, active-but-out-of-stock lines are adjusted and normal +/- controls removed.
- Catalog floor: multi-placement category model, first-class variants, tags, product relations, product groups, SEO route registry, redirects, media assets, searchable aliases, translation coverage, archive lifecycle.
- Product status floor: `published`, `draft`, `hidden`, `archived`, `discontinued`; public routes/search/sitemap/relations exclude non-published items; discontinued URLs return 410 or intentional redirects.
- Product table floor: admin product list must support filterable/sortable status switch, filterable/sortable sale-status switch, tags column/chips, audit logs, and badge/search/cache invalidation.
- Merchandising floor: related products, cross-sell, upsell, bought-together, complete-the-look, product groups, manual badges, sale badges, and weekly analytics-derived badges/rails are first-class API concepts.
- FAQ/Q&A correction: existing `codex-faq-architecture-and-admin-plan.md` (renamed from `codex-qna-...`) is really the FAQ/targeted editorial plan; true Q&A is customer-submitted product questions, answered by admin, published publicly, and emailed back.
- Pricing floor: INR canonical, tax-inclusive stored/displayed by default, backend-only currency conversion, PayPal gross-up formula, FX rate history, order-line snapshots, tax/shipping/payment snapshots.
- Inventory floor: purchase invoice intake near Products, FIFO hidden cost layers, inventory ledger, unit-level COGS, sales/profit/purchase/category reports, no customer-facing batch/MRP complexity at launch.
- Reporting floor: analytics events roll into daily aggregates, business report snapshots, weekly product insight sets, and product badge assignments; storefront reads stable insight collections, not live analytics scans.
- Documentation floor: OpenAPI at `/openapi.json`, Scalar API Reference compatible output, generated DB docs later, clear environment catalog, runbooks, and tests as part of done.
- Security floor: OWASP-aligned controls, object-level authorization, CSRF, CORS allowlist, rate limits, secure cookies, no browser tokens, no secrets in bundles, no PII in logs, audit every admin write.
- Quality gate: do not consider API work done with `vitest --passWithNoTests`; add meaningful unit and integration tests, including auth, CSRF, transactions, public/admin route separation, and OpenAPI smoke checks.
- Execution cadence (LOCKED 2026-07-02): build **one phase at a time**. Each of Phases A–J is its own run/session; run the §21 command gates and **stop for owner review before starting the next phase**. Do not attempt the whole thing in one pass.
- Provider integration policy (LOCKED 2026-07-02): payments (CCAvenue/PayPal) and shipping (Shiprocket) are **ports + stub/sandbox adapters only** at this stage. Real gateway wiring happens **only after the client provides live credentials/access**, following each chosen provider's official docs + supported SDK/stack then. No provider SDK is a launch blocker.
- Dependency policy (LOCKED 2026-07-02): take all stack deps at their **latest versions**, verify cross-compatibility, then **pin** them (exact versions). If latest-together conflicts, **stop and list the conflicts + best options that don't compromise the architecture** for an owner call — do not silently downgrade the architecture to satisfy a version.
- Test-infra floor (LOCKED 2026-07-02): the **Docker Compose single-node replica-set test profile is a hard Phase-C deliverable** so `withTransaction()` tests actually run; silently skipping transaction tests is not acceptable.

## Exact Prompt To Cursor Starts Here

You are Cursor acting as a senior backend/platform engineer for the Saha Textile monorepo. Build and refactor the API backend under `apps/api` and its required shared backend packages so it becomes the enterprise-grade, swappable, secure backend for both the Angular storefront and Angular admin.

Work from the repo root. Do not start by coding from memory. First read the context files and current API code listed below. Then implement phase by phase, with tests and a concise report after each phase.

### 0. Read These Files First

Read these in order:

1. `project-context/angular-context/owner-decisions-log.md`
2. `project-context/angular-context/catalog-search-db-decisions-explainer.md`
3. `project-context/angular-context/by-claude-codex-files-assessment-and-verdict.md`
4. `project-context/angular-context/saha-textile-technical-knowledgebase.md`
5. `project-context/angular-context/execution-roadmap.md`
6. `project-context/angular-context/environment-variables.md`
7. `project-context/angular-context/fastkart-execution-plan.md`
8. `project-context/angular-context/fastkart-assessment-and-plan.md`
9. `project-context/angular-context/codex-auth-architecture-db-and-request-plan.md`
10. `project-context/angular-context/codex-catalog-db-architecture-assessment-and-plan.md`
11. `project-context/angular-context/codex-faq-architecture-and-admin-plan.md` (renamed from `codex-qna-...`) — treat it as the FAQ/editorial targeting plan because the owner corrected the terminology.
12. Current code in `apps/api/src`, `packages/contracts/src`, `packages/core-domain/src`, and `packages/adapters-db-mongo/src`.

Precedence rule:

- If an older file mentions MongoDB Atlas M0, paid Atlas production, Caddy, Tailwind, shadcn, Brevo as a fixed provider, admin SSR, or browser-stored bearer tokens, treat that as stale unless `owner-decisions-log.md` explicitly agrees with it.
- Latest locked decisions are: Nginx, self-hosted Docker MongoDB 8.3 single-node replica set with local/prod Docker parity, self-hosted Meilisearch, Angular admin SPA/lazy routes, cookie-session auth, no MFA at launch, admin 6-digit PIN alternative, no paid CMP, no X login, phone OTP seam only, email OTP provider not locked, multi-placement category DAG, all five product patterns, toggle-based option semantics, and Fastkart display styles separated from business meaning.

### 1. Allowed Edit Scope

Primary target:

- `apps/api/**`

Allowed supporting packages because the API architecture depends on them:

- `packages/contracts/**`
- `packages/core-domain/**`
- `packages/adapters-db-mongo/**`
- New backend adapter packages only when needed, such as `packages/adapters-search-meili`, `packages/adapters-storage-spaces`, `packages/adapters-payments`, `packages/adapters-shipping`, `packages/adapters-email`.
- Backend tests, seed scripts, Docker/env examples, and developer docs directly needed by the API.

Avoid unless explicitly required:

- Do not rewrite `apps/admin` or `apps/storefront` UI code in this API task.
- Do not copy Fastkart code. Fastkart is UI/behavior reference for Angular apps, not API source.
- Do not introduce Tailwind, shadcn, React, Next.js, NGXS, or browser token storage.
- Do not hardcode real secrets or commit generated private keys.

### 2. Current API Baseline To Refactor

The existing API already has:

- NestJS on Fastify.
- `@fastify/helmet`, `@fastify/rate-limit`, OpenAPI generation setup, CORS allowlist.
- Modules for auth, catalog, cart, orders, currency, promotions, health.
- zod validation pipe.
- Mongo adapter package using Mongoose.
- Current auth that returns access and refresh tokens in JSON and reads `Authorization: Bearer` only.
- Current package scripts where tests may pass without test files.

Refactor rather than deleting blindly. Preserve working structure where it matches the target, but upgrade the security and layering to the new baseline.

### 3. Non-Negotiable Architecture

Use strict hexagonal architecture:

- `packages/contracts`: zod request/response contracts and inferred types shared by API, admin, and storefront.
- `packages/core-domain`: domain entities, value objects, pure pricing/search/cart/order logic, and port interfaces only. No NestJS, no Mongoose, no Fastify, no provider SDKs.
- Adapter packages: Mongo, Meilisearch, Spaces, payments, shipping, email. They implement ports and translate provider details into domain objects.
- `apps/api`: NestJS composition root, HTTP controllers, guards, pipes, interceptors, application services/use-case orchestration, OpenAPI, config, jobs, and dependency injection.

Dependency rule:

- Controllers call application services.
- Application services call domain services/ports.
- Adapters implement ports.
- Controllers never call Mongoose models, Meilisearch clients, payment SDKs, shipping SDKs, or S3 clients directly.
- Domain/core never imports `@nestjs/*`, Mongoose, Fastify, Meilisearch, AWS SDK, PayPal, CCAvenue, Shiprocket, or provider-specific DTOs.

Swappability examples the code must preserve:

- MongoDB -> Postgres later means implementing a new repository adapter and changing DI binding, not rewriting controllers or Angular clients.
- Meilisearch -> Typesense later means implementing `SearchPort`, not changing catalog controllers.
- PayPal/CCAvenue -> other gateways later means implementing `PaymentGatewayPort`, not changing checkout use cases.
- Shiprocket -> DHL/FedEx later means implementing `ShippingPort`, not changing orders/cart controllers.
- Nginx -> another proxy later must not affect API business logic.

### 4. Target API Folder Shape

You may adapt names to existing conventions, but the final structure should clearly separate transport, application, and infrastructure. A good target shape is:

```text
apps/api/src/
  main.ts
  app.module.ts
  config/
    app-config.ts
    config.module.ts
  common/
    decorators/
    errors/
    filters/
    guards/
    interceptors/
    logging/
    pipes/
    serializers/
  composition/
    provider-tokens.ts
    persistence.module.ts
    search.module.ts
    external-adapters.module.ts
  modules/
    auth/
      http/
      application/
      guards/
      cookies/
      csrf/
    catalog/
      admin-http/
      storefront-http/
      application/
    search/
      http/
      application/
      jobs/
    cart/
      http/
      application/
    checkout/
      http/
      application/
    orders/
      admin-http/
      storefront-http/
      application/
    payments/
      admin-http/
      webhooks/
      application/
    shipping/
      admin-http/
      application/
    inventory/
      admin-http/
      application/
    pricing/
      admin-http/
      application/
    content/
      admin-http/
      storefront-http/
      application/
    privacy/
      http/
      application/
    analytics/
      admin-http/
      storefront-http/
      jobs/
      application/
    media/
      admin-http/
      application/
    health/
```

Public and admin controllers can live in the same bounded context, but must be different controller classes and route prefixes.

### 5. Route Segregation

Use route boundaries that make security and client ownership obvious.

Recommended public/storefront route groups:

- `GET /catalog/categories`
- `GET /catalog/categories/:path`
- `GET /catalog/products`
- `GET /catalog/products/:slug`
- `GET /catalog/products/:slug/relations`
- `GET /search/typeahead`
- `GET /search/results`
- `GET /content/faqs`
- `GET /content/qna/products/:productId`
- `POST /content/qna/products/:productId/questions`
- `GET /merchandising/insight-sets`
- `POST /analytics/events` with consent checks
- `GET /cart`
- `POST /cart/lines`
- `PATCH /cart/lines/:lineId`
- `DELETE /cart/lines/:lineId`
- `POST /cart/sync-offline`
- `POST /checkout/quote`
- `POST /checkout/place-order`
- `GET /orders/me`
- `GET /orders/:id`
- `GET /auth/csrf`
- `GET /auth/me`
- `POST /auth/storefront/register`
- `POST /auth/storefront/login/password`
- `POST /auth/storefront/login/email-otp/request` (enabled — channel-direct via `NotificationPort`/MSG91; 6-digit code, `otpChallenges`, 10-min single-active expiry, generic anti-enumeration response)
- `POST /auth/storefront/login/email-otp/verify` (single-use; consume/clear challenge on success)
- `GET|POST /auth/oauth/google/*`
- `GET|POST /auth/oauth/facebook/*`
- `POST /auth/refresh`
- `POST /auth/logout`
- `POST /privacy/consent`
- `GET /privacy/consent`

Recommended admin route groups:

- `GET|POST|PATCH /admin/catalog/categories`
- `GET|POST|PATCH /admin/catalog/category-placements`
- `GET|POST|PATCH /admin/catalog/tags`
- `GET|POST|PATCH /admin/catalog/attributes`
- `GET|POST|PATCH /admin/catalog/addon-templates`
- `GET|POST|PATCH /admin/catalog/products`
- `PATCH /admin/catalog/products/:id/status`
- `PATCH /admin/catalog/products/:id/sale-status`
- `POST /admin/catalog/products/bulk/*`
- `GET|POST|PATCH /admin/catalog/product-relations`
- `GET|POST|PATCH /admin/catalog/product-groups`
- `GET|POST|PATCH /admin/content/faqs`
- `GET /admin/content/qna/unanswered`
- `POST /admin/content/qna/:id/answer`
- `GET|POST|PATCH /admin/search/dictionary`
- `POST /admin/search/reindex`
- `GET|POST|PATCH /admin/pricing/currencies`
- `GET|POST|PATCH /admin/pricing/paypal-commission-rules`
- `GET|POST|PATCH /admin/tax/classes`
- `GET|POST|PATCH /admin/shipping/providers`
- `GET|POST|PATCH /admin/inventory/purchase-invoices`
- `POST /admin/inventory/purchase-invoices/:id/post`
- `GET /admin/reports/dashboard`
- `GET /admin/reports/sales`
- `GET /admin/reports/purchases`
- `GET /admin/reports/inventory`
- `GET /admin/reports/search`
- `GET /admin/reports/tax`
- `GET /admin/reports/shipping`
- `GET|PATCH /admin/notifications/channels` (per-channel enable/disable toggles + plan limits/thresholds — **high-privilege RBAC only**, server-authorized, audited)
- `GET /admin/notifications/usage` (per-channel usage vs plan/wallet limit)
- `GET|POST|PATCH /admin/notifications/templates` (SMS/email/WhatsApp templates incl. DLT header/template IDs and WhatsApp template IDs)
- `POST /admin/notifications/campaigns` (consent-gated marketing send: bulk or targeted; hybrid — simple sends here, heavy campaigns may use the provider dashboard)
- `GET /admin/audit-logs`
- `POST /auth/admin/login`
- `POST /auth/admin/login/pin`
- `GET /auth/admin/me`
- `POST /auth/admin/refresh`
- `POST /auth/admin/logout`
- `POST /admin/users/invite`
- `PATCH /admin/users/:id`

Rules:

- All admin routes require admin audience, role/permission checks, CSRF for unsafe methods, and audit logs for writes.
- Public routes must never accidentally accept admin cookies as customer authority unless a controlled impersonation flow is explicitly built later.
- Storefront and admin may share application services, but HTTP contracts and authorization guards must stay separated.

### 6. Core Security Bootstrap

Upgrade `main.ts` and boot config to include:

- Fastify adapter with proxy awareness for the **Cloudflare → Nginx → API** chain: set `trustProxy` appropriately and derive the real client IP from **`CF-Connecting-IP`** (fall back to `X-Forwarded-For` from Nginx). Every IP-dependent feature — rate-limit keys, structured logs, consent IP hashing, auth audit — must use that resolved client IP, not the proxy IP. Assume the droplet firewall is restricted to Cloudflare IP ranges (documented as an infra step; the app must not rely on being publicly reachable).
- `@fastify/helmet` with production CSP handled jointly with Nginx; the development/staging Scalar surface may receive only the narrowly required CSP allowances.
- `@fastify/rate-limit` global defaults plus stricter per-route/auth/search/checkout limits.
- `@fastify/cookie` for signed/secure cookie parsing and setting.
- Credentialed CORS allowlist for only `https://sahatextile.com`, `https://www.sahatextile.com` if used, `https://admin.sahatextile.com`, staging origins, and local dev origins.
- `Vary: Origin` on credentialed CORS responses.
- Global zod validation pipe using `packages/contracts` schemas.
- Global error filter returning consistent, sanitized error envelopes.
- Request ID generation and propagation.
- Structured logs with PII redaction; do not log tokens, OTPs, passwords, raw provider tokens, raw IPs, or full address payloads.
- OpenAPI generation at `/openapi.json`; Scalar API Reference is mounted or statically integrated at `/api/reference` for approved development/staging use and disabled or access-protected in production.
- Health endpoints:
    - `/health/live`: process is alive.
    - `/health/ready`: Mongo, Meilisearch, and required runtime dependencies are reachable.

### 7. Runtime Config And Environment

Replace Atlas-specific config assumptions with self-hosted Docker Mongo support.

API env should support:

```dotenv
NODE_ENV=development|test|production
PORT=4000
PUBLIC_SITE_URL=https://sahatextile.com
ADMIN_SITE_URL=https://admin.sahatextile.com
API_PUBLIC_URL=https://api.sahatextile.com
CORS_ALLOWED_ORIGINS=https://sahatextile.com,https://admin.sahatextile.com
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
COOKIE_DOMAIN=

MONGODB_URI=mongodb://saha_api:...@mongo:27017/saha_prod?replicaSet=rs0&authSource=admin
MONGODB_DB_NAME=saha_prod
MONGODB_REPLICA_SET=rs0

MEILISEARCH_HOST=http://meilisearch:7700
MEILISEARCH_API_KEY=...

JWT_ACCESS_SECRET=...
JWT_ACCESS_TTL=15m
JWT_ISSUER=https://api.sahatextile.com
REFRESH_TOKEN_PEPPER=...
CSRF_SECRET=...
STORE_FRONT_REFRESH_TTL=30d
ADMIN_REFRESH_IDLE_TTL=12h
ADMIN_REFRESH_ABSOLUTE_TTL=7d

GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
FACEBOOK_OAUTH_APP_ID=...
FACEBOOK_OAUTH_APP_SECRET=...

# Outbound transactional email via EmailPort. LOCKED: provider free tier, no Brevo. Primary=resend; swappable.
EMAIL_PROVIDER=resend                   # resend | smtp | ses | console (dev/test) | disabled
RESEND_API_KEY=...                      # when EMAIL_PROVIDER=resend
# Generic SMTP fallback (e.g. MailerSend relay) — used only when EMAIL_PROVIDER=smtp
SMTP_HOST=
SMTP_PORT=587                           # 587 STARTTLS, or 465 SSL
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=no-reply@sahatextile.com      # verified sender on the chosen provider
OTP_EMAIL_FROM=no-reply@sahatextile.com
OTP_TTL_SECONDS=600
OTP_MAX_ATTEMPTS=5
# Team mailboxes (admin@/support@) = Google Workspace (MX in Cloudflare DNS) — separate from app email; no API keys here.

# Unified messaging via NotificationPort (SMS/email/WhatsApp). Provider = MSG91 (LOCKED); swappable.
# Per-channel on/off toggles + plan limits live in DB (notificationChannelSettings), NOT env — admin/RBAC controlled.
NOTIFICATIONS_PROVIDER=msg91            # msg91 | twilio | console (dev) | disabled
MSG91_AUTH_KEY=...                      # when provider=msg91
MSG91_SMS_SENDER_ID=                    # DLT-approved header, e.g. SAHATX
MSG91_WHATSAPP_NUMBER=                  # approved WhatsApp Business number
DLT_ENTITY_ID=                          # TRAI DLT principal entity id (India SMS)
# TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_MESSAGING_SERVICE_SID  # only if provider=twilio

# Edge / proxy (Cloudflare in front of Nginx origin) — adapter/toggle model.
# Leave EDGE_* empty to defer to Cloudflare dashboard settings; set them to override in-code.
TRUST_PROXY=true                        # honor Cloudflare/Nginx forwarded headers
CLIENT_IP_HEADER=cf-connecting-ip       # real client IP source (fallback: x-forwarded-for)
EDGE_TLS_MODE=                          # empty = Cloudflare-managed; or "origin-ca" | "letsencrypt"
EDGE_CACHE_OVERRIDE=false               # true = app/Nginx cache rules authoritative over CF defaults

SPACES_KEY=...
SPACES_SECRET=...
SPACES_BUCKET=...
SPACES_REGION=sgp1
SPACES_ENDPOINT=https://sgp1.digitaloceanspaces.com
SPACES_CDN_URL=...

CCAVENUE_MERCHANT_ID=...
CCAVENUE_ACCESS_CODE=...
CCAVENUE_WORKING_KEY=...
CCAVENUE_BASE_URL=https://test.ccavenue.com
PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_ENV=sandbox|live

SHIPROCKET_EMAIL=...
SHIPROCKET_PASSWORD=...
SHIPROCKET_PICKUP_PINCODE=...
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=1 minute
```

Rules:

- Do not put real secrets in committed files.
- Public Angular runtime config receives only public values such as API URL and OAuth client IDs when provider JS buttons need them.
- OAuth secrets, payment keys, SMTP secrets, Spaces secrets, JWT secrets, CSRF secrets, and refresh peppers stay API-side only.
- Update `.env.example` to reflect SGP Spaces and self-hosted Mongo. Do not leave BLR Spaces as default because DigitalOcean Spaces does not offer BLR in the owner decision.
- Keep Caddy variables out. Nginx is outside the API but proxy/header assumptions should be documented.

### 8. MongoDB And Transaction Architecture

MongoDB is self-hosted in Docker, not Atlas.

Required database assumptions:

- MongoDB 8.3 container.
- Single-node replica set enabled so multi-document ACID transactions work.
- Mongo listens only on Docker private network. No public 27017 exposure.
- Data in named volume or bind-mounted path on the droplet SSD.
- Weekly local backups initially; later archive backup/export artifacts to DigitalOcean Spaces.
- Mongo memory cap and WiredTiger cache cap so it cannot starve API/search.

API implementation requirements:

- Create a `TransactionManagerPort` or `UnitOfWorkPort` in `packages/core-domain`.
- Implement it in the Mongo adapter using Mongoose sessions or the MongoDB Node driver session available through Mongoose.
- Repositories that participate in atomic writes must accept an optional session/context.
- Use `session.withTransaction()` or equivalent Mongoose transaction helper for multi-collection operations.
- Do not run parallel operations inside one transaction with `Promise.all`.
- All cross-collection writes below must be transactional:
    - register/login session creation where identity/session/audit rows must agree.
    - refresh token rotation and reuse detection.
    - offline cart merge into user cart.
    - place order: order, payment attempt, stock reservation/decrement, inventory ledger, analytics event, cart state.
    - payment capture webhook: payment, order status, inventory finalization, audit/event.
    - purchase invoice post: invoice header, invoice lines, inventory ledger rows, FIFO cost layers, stock increment, audit/event.
    - return/refund where order/payment/refund/inventory rows must agree.

Do not treat API boot success as DB readiness. `/health/ready` must show DB readiness separately.

### 9. Auth And Session Architecture

Refactor browser auth away from JSON bearer token responses.

Browser session model:

- Access token: short-lived JWT in `__Host-saha_access` httpOnly Secure cookie.
- Refresh token: opaque high-entropy token in `__Host-saha_refresh` httpOnly Secure cookie; only hash stored in DB.
- CSRF token: readable `saha_csrf` cookie plus `X-CSRF-Token` header on unsafe methods; sign/bind token to session.
- Guest identity: separate `saha_guest` httpOnly cookie for cart/session continuity, never account authority.
- Locale/currency preferences may use non-httpOnly preference cookies because they are not secrets.

Add or update auth collections:

- `users`
- `authIdentities`
- `passwordCredentials`
- `adminPinCredentials` or equivalent separate credential collection
- `authSessions`
- `otpChallenges`
- `oauthStates`
- `passwordResetTokens`
- `emailVerificationTokens`
- `adminInvites`
- `roles` and `userRoleAssignments` as growth seam
- `securityAuditLogs`
- `authRateLimits`
- `consentEvents`

Session requirements:

- Cookie-first guard reads access cookie first.
- Bearer fallback exists only for explicit non-browser/internal clients and must not be the normal Angular path.
- Access JWT includes issuer, audience, subject, session id, role, permissions version, token version, jti, iat, exp.
- Admin JWT has `aud: admin`; storefront JWT has `aud: storefront`.
- Storefront access must never authorize admin routes.
- Admin access must never bypass object-level ownership checks on storefront/customer endpoints.
- Refresh rotation stores a new hash and invalidates the old token each time.
- Reuse detection revokes the full refresh family and logs a critical security audit event.
- Logout clears cookies and revokes the active session.
- Password/PIN change revokes sessions and increments token version.
- Role/permission changes increment permission version so old admin JWTs fail quickly.

CSRF requirements:

- Use signed double-submit cookie bound to the authenticated session.
- Enforce CSRF on `POST`, `PUT`, `PATCH`, `DELETE` when cookies authenticate the request.
- Validate `Origin`/`Referer` or Fetch Metadata headers as defense-in-depth where practical.
- Never use GET for state-changing operations.

Admin auth:

- No MFA at launch.
- Admin/staff login via email-or-username plus password.
- Admin 6-digit PIN alternative is allowed only after password credential exists and user is staff/admin.
- Hash PIN with the same seriousness as password or a separate strong hash; never store plaintext.
- Reject weak PINs with denylist plus pattern checks:
    - all same digits.
    - ascending/descending sequences.
    - common keyboard/calendar-like values.
    - known weak values such as `000000`, `111111`, `123456`, `012345`, `654321`.
- Admin PIN has stricter rate limits and lockout than password login because entropy is lower.
- Admin sessions have shorter idle TTL than storefront.
- Admin self-registration is forbidden; first admin uses guarded bootstrap script, later admins use invites.

Storefront auth:

- Email/password: launch.
- Google login: launch if credentials exist; backend verifies provider data and owns session.
- Facebook login: launch if credentials exist; backend verifies provider data and owns session.
- OTP (email/SMS/WhatsApp): **LOCKED (2026-07-05) — channel-direct via the `NotificationPort` (MSG91).** We own generate/store/verify; the code is sent through the SMS/WhatsApp/Email channel adapters. Do **NOT** use MSG91 OTP-Widget/SendOTP. Billing = per send only; resend = +1 send. Mechanics:
    - **Generate:** CSPRNG (`crypto.randomInt`, never `Math.random`) → **6-digit** zero-padded. Never logged, never returned in a response.
    - **Store:** in `otpChallenges` (never on the user doc) — **`HMAC-SHA256(code, server-pepper)`**, not plaintext, not Argon2 (overkill/slow for 6 digits; short TTL + attempt caps + pepper are the defense). Fields: `identifier`, `purpose` (login/signup/reset/email-change), `channel`, `codeHash`, `expiresAt (=now + OTP_TTL_SECONDS=600)`, `attempts`, `maxAttempts (=OTP_MAX_ATTEMPTS=5)`, `consumedAt`, `resendCount`, `lastSentAt`, `ip/uaHash`.
    - **Uniqueness:** keep a **single active challenge per (identifier, purpose)** — new request atomically supersedes the prior unconsumed one (atomic upsert + partial unique index on `consumedAt:null`). Cross-user identical code values are harmless (scoped per challenge). Resend hits a cooldown + max-resend cap, not new mints.
    - **Verify (atomic, race-safe):** find active (not consumed, not expired, `attempts<max`) → **constant-time compare** → on match atomically set `consumedAt` (only if null) + issue the httpOnly cookie session; on miss atomically `attempts++`, invalidate at max. All failures generic ("invalid or expired code").
    - **Expiry/cleanup:** reject expired/consumed/exhausted; **Mongo TTL index** on `expiresAt` auto-purges dead challenges.
    - **Abuse:** per-identifier + per-IP send/verify caps with backoff in `authRateLimits`.
    - **Anti-enumeration (LOCKED):** generic "if an account exists, a code was sent"; never branch UI on existence.
    - **Deliverability (email):** verify the MSG91 sender domain; SPF/DKIM/DMARC set in Cloudflare DNS (Starter+ MSG91 email plan for DMARC compliance + Handlebars).
    - `NotificationPort` (with `EmailPort` under it) is the seam for **all** transactional messaging (OTP, order/status, payment, Q&A answer, resets, admin invites); the provider swaps via env without touching auth/business logic.
- Phone OTP: schema/port seam only, no SMS implementation.
- X/Twitter: no dependency, no routes, no UI contract.
- Guest browsing/cart: required.

OAuth requirements:

- Request minimum scopes only: Google `openid email profile`; Facebook `public_profile,email`.
- Store Google `sub` and Facebook user id as `authIdentities.providerSubject`; do not use email as provider primary id.
- Use signed state, nonce where applicable, fixed redirect URI allowlist, and strict redirect-after-login allowlist.
- Provider JS buttons/SDK can be used for UX, but the backend must verify ID token/signed response/access token before session creation.
- Do not store provider access tokens unless a future feature requires provider API access; if stored later, encrypt and add deletion/revocation paths.

### 10. Privacy, Cookie Consent, And GDPR API Duties

Frontend owns the banner UI; API owns consent persistence and enforcement.

Create privacy/consent API support:

- `POST /privacy/consent`: store guest/user consent event.
- `GET /privacy/consent`: return current effective consent for user or guest.
- `GET /privacy/policy-version`: expose active policy/cookie version.
- Future user export/delete request endpoints can be scaffolded as admin/customer workflows.

Consent categories:

- `strictlyNecessary`: always true and not user-disableable.
- `functional`
- `targeting`
- `marketing`
- `promotional`
- optional `analytics` if you separate analytics from targeting/marketing.

Persistence requirements:

- Store `consentEvents` with userId or guestId, policyVersion, source, categories, timestamp, and hashed IP/user-agent if needed.
- Never block strictly necessary auth/cart/order/security/audit functions behind optional consent.
- Block or ignore optional analytics/marketing events unless consent allows them.
- Storefront analytics endpoint must be consent-aware.
- Do not add a paid CMP SDK.

### 11. Catalog, Product, Category, Tags, And SEO API Duties

Implement the catalog model behind ports and contracts.

Collections and contracts to add or evolve:

- `categories`
- `categoryPlacements`
- `categoryFacetConfigs`
- `categoryRedirects`
- `tags`
- `attributeDefinitions`
- `addonTemplates`
- `products`
- `productVariants`
- `productBundles` as seam, not full launch complexity unless needed.
- `productRelations`
- `productGroups`
- `seoRoutes`
- `seoRedirects`
- `mediaAssets`

Public catalog rules:

- Public queries return only `published` products and active categories.
- Archived/hidden/discontinued products are excluded from search, sitemap, product cards, product relations, cross-sell, upsell, related blocks, and product insight sets.
- Product detail for non-published slugs returns 410 Gone or an intentional redirect, not a soft 404.
- Product canonical URL is independent of category placement.
- Category page resolves through `categoryPlacements.pathSlugs` and canonical placement.
- Product summaries include highest-priority 1-2 badges from `productBadgeAssignments` or derived summary.
- Product summaries include only fields needed for cards/lists; do not return full variant/add-on payloads in listings.
- Category/listing endpoints return `items`, pagination/sort metadata, `appliedFilters`, `facets` with counts/ranges, price range, and SEO metadata in one response.
- Sidebar/off-canvas filters are resolved from `categoryFacetConfigs` by category placement/category/global fallback. Do not expose every `filter_only` value automatically.
- Listing filters must go through `SearchPort`/Meilisearch in production; Mongo query fallback is local/dev degraded behavior only.

Admin catalog rules:

- Product table must support filter/sort by status, sale status, price, category, tags, updated date.
- Status switch and sale-status switch must be patchable from table endpoints.
- Status and sale-status changes must audit, invalidate public caches, enqueue search outbox changes, and refresh badge assignments.
- Tags require full CRUD and reusable searchable multi-select behavior in admin contracts.
- Category/tag assignment DTOs must support multi-select chips in admin.
- Admin category/product-group screens must expose facet configuration: enabled filters, order, translated label, display style, collapsed/default state, count visibility, desktop/mobile visibility, and SEO policy.
- Purchase invoice product selector contracts must support single-select mode for product/variant lookup.
- Publish gates must validate title, slug, primary category/canonical placement, image/alt, price summary, active variant, SEO route, structured data readiness, and search document readiness.

SEO duties:

- Generate/maintain `seoRoutes` for indexable products/categories/product groups per locale.
- Generate/maintain `seoRedirects` for Woo legacy URLs, slug changes, category moves, archived/discontinued routes.
- Public responses must provide metadata needed by Angular/Analog SSR: canonical path, hreflang group, breadcrumbs, JSON-LD data payloads or structured-data inputs.
- Sitemaps should be generated from `seoRoutes`, not by crawling UI.
- Search result pages and arbitrary filters are `noindex,follow` unless explicitly modeled as SEO landing pages through product groups/categories.
- Facet combinations do not become indexable routes unless backed by explicit `seoRoutes`/`productGroups`; query-string filter pages canonicalize to the base category.
- FAQ content on indexable routes must be available in SSR HTML and represented in API data accordingly.

### 12. Product Types And Inventory Semantics

Support these product concepts:

- Simple product: one purchasable item, one variant row.
- Variable product: one product with option-defined variant rows; design/stitching changes price/stock/image/SKU.
- Tailoring add-ons: measurement inputs on cart/order line, not variations.
- Product group: merchandising rail/lookbook/complete-the-look/bought-together display, not inventory composition.
- Bundle product: reserved seam for real kits where one purchase resolves to component lines and consumes multiple inventories.

Option semantics are locked and must be explicit in contracts:

- `filter_only`: searchable/filterable/display attribute only; no SKU row.
- `variation_axis`: generates product variant rows because it changes SKU/stock/price row/image/base identity/purchasability.
- `named_add_on`: customizes an included sub-part/service and snapshots on cart/order line; does not generate variant matrix rows.
- `bundle_component_option`: resolves separate inventory/components through bundle/composite logic.

Storefront display style is separate and visual only: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`. The API must return display metadata for storefront/admin renderers, but display style must never decide business behavior.

Live data rules:

- `Salwaar Designs` and `Blouse Designs` are variation-driving.
- `No Stitching` and `No Blouse` are base terms and map to `isBaseVariant`.
- Measurement fields show conditionally for stitched/design choices, not base terms.
- Color defaults to filter/descriptive unless the product explicitly marks that option group as `semanticRole: "variation_axis"`.
- Do not force Color to always be a variation axis.
- Same toggle rule applies to size, fabric, design, waist, liter, and every other option group.
- Standalone blouse design may be a normal variation axis. Saree-attached blouse design is a named add-on group with default `No Design`, optional price/media/measurement requirements, and no forced saree variant matrix.
- Future products may define multiple named add-on groups, e.g. `Blouse Design` and `Aachol/Churni Design`, each with default selections.

Inventory rules:

- Stock writes target variants.
- Inventory ledger records every stock-affecting movement.
- FIFO hidden cost layers are required for unit-level COGS/profit reports.
- Purchase price lives in purchase invoice/cost layer records, not catalog price fields.
- Catalog MRP/sale price remains read-only on purchase invoice screen at launch.

### 13. Search API And Meilisearch Adapter

Implement `SearchPort` and a self-hosted Meilisearch adapter.

Collections/contracts:

- `searchDictionary`
- `searchOutbox`
- `searchQueryAggregates`

Search document includes only derived public data:

- product/category/tag id.
- titles in EN/BN where available.
- slug/SKU.
- category/tag names.
- attributes.
- aliases/misspellings/transliterations.
- price min/max.
- image URL.
- status.
- facetable fields resolved from `categoryFacetConfigs`, including category placement IDs, tag IDs, attribute/filter values, active variant option values, price INR min/max, sale/featured flags, rating buckets, stock availability, and coarse shipping flags.
- popularity/inventory/boost scores.

Search pipeline:

1. Accept typeahead at minimum 3 characters.
2. Normalize query: lowercase, trim punctuation, normalize spaces, detect script, normalize known variants.
3. Expand using `searchDictionary` aliases, misspellings, transliterations.
4. Query Meilisearch with typo tolerance, prefix/typeahead, filters/facets, ranking boosts, and `status = published` filter.
5. For listing/category requests, apply category facet config and return products plus available facets/counts/ranges in the same response.
6. Return product suggestions, category suggestions, query suggestions, and corrected spelling if confidence is high.
7. Upsert aggregate query stats without storing unnecessary PII.
8. Capture no-result searches for future dictionary tuning.

Facet semantics:

- `variation_axis` filters match active purchasable variants; product-level `filter_only` values match parent metadata.
- Named add-ons and bundle component options are hidden from sidebar filters unless a category facet config explicitly enables them as merchandising filters.
- Price filters use canonical INR effective price; currency ranges from the client are normalized to INR before search.
- Shipping filters are coarse eligibility flags; exact courier/pincode serviceability remains outside listing endpoints.
- Rating filters use persisted aggregates, not live review scans.

Reindex lifecycle:

- Enqueue `searchOutbox` on product/category/tag/attribute/search-dictionary changes.
- Delete from Meilisearch immediately when product moves away from `published`.
- Rebuild all search indexes from Mongo source of truth via an admin command/job.
- Meilisearch is not source of truth. It can be destroyed and rebuilt.

Admin search requirements:

- Seed dictionary with terms such as saree/sari/sharee, banarasi/benaroshi/benarasi, jamdani/jamdanee, chikankari variants, salwaar/salwar, Bengali equivalents where known.
- Build dictionary CRUD and no-result reports as day-one API/data capabilities; the admin UI may expose them in a later screen only with explicit owner approval.
- Keep the full Level 1-4 search feature surface available from day one: typo tolerance, English aliases, Bengali/transliteration tokens, suggestions/popular/no-result analytics, and admin-curated dictionary growth.
- Prepare Level 4: admin dictionary editor fed by no-result analytics.

### 14. Cart, Offline Cart Sync, Checkout, And Orders

Cart requirements:

- Server-side persistent cart for guest and logged-in users.
- Guest cart linked by `saha_guest` cookie.
- On login/register/OAuth, merge guest cart into user cart transactionally.
- Merge key: productId + variantId + selected options + add-on measurement signature.
- Angular may store offline cart locally, but API is final source when online.

Offline sync endpoint:

- Provide `POST /cart/sync-offline`.
- Request contains local offline cart lines, client timestamps, locale/currency.
- Stage 1: availability/status validation.
    - If product/variant is archived, discontinued, hidden, unpublished, or no longer in portfolio, return a line-level terminal error such as `product_no_longer_available` with user-safe message.
- Stage 2: inventory validation.
    - If active but out of stock or insufficient quantity, adjust line quantity/status and return UI hints to disable normal +/- controls.
- If all pass, merge/sync silently.
- Do not require login for guest cart sync, but if authenticated attach to user cart.
- Do not cache account/order data offline.

Checkout/order requirements:

- Quote endpoint resolves prices, promotions, tax, shipping, currency, gateway eligibility, and stock validation server-side.
- Place order endpoint must be idempotent using an idempotency key.
- Place order must run a Mongo transaction for order, payment attempt, inventory reservation/decrement, ledger rows, cart update, and audit/event rows.
- Order lines snapshot everything needed forever: title, slug, productId, variantId, SKU, selected attributes, add-ons/measurements, product status at purchase, category snapshot, price INR, display currency, FX rate, tax, promotion, shipping, gateway decision, image/asset snapshot, return eligibility.
- Payment webhooks/return callbacks must be idempotent and update payment/order state transactionally.
- **MUST-ASK GATE (order numbering, PENDING owner decision 2026-07-05):** before implementing order/checkout numbering or any neighboring sequence, if the owner has not already answered, **STOP and ask**: Mode A (FY-reset counter + FY-segment auto-roll 1 Apr IST) vs Mode B (perpetual counter); company code / separators / zero-pad width; gapless-per-FY enforcement (via cancel-status, not delete); separate sequences for order-no vs tax-invoice-no. India GST: ≤16 chars, alphanumeric + `/` `-`, unique + consecutive. See `owner-decisions-log.md` (2026-07-05).
- **Timestamps (LOCKED 2026-07-05):** store **UTC**; compute business/accounting boundaries (order date, FY, quarter, daily aggregates) in **IST**; India FY = 1 Apr–31 Mar; admin "Quarter" = Indian financial quarter. **Display:** storefront = customer-local (tz-labeled, browser-detected), admin = IST; **PDF invoices = IST, frozen at generation**. Report/history date presets computed dynamically. Full standard in `owner-decisions-log.md` (2026-07-05).

### 15. Pricing, Tax, Currency, Payments, And Shipping

Pricing core:

- INR is canonical.
- Product variant fields: `priceINR`, `compareAtPriceINR`, `salePriceINR`.
- Effective selling INR: `salePriceINR ?? priceINR` after promotion resolution.
- Store/display tax-inclusive values as locked owner decision.
- Reverse-calculate tax-exclusive base only where invoices/reports need it.
- Angular receives backend-computed display prices and formats them only.

FX:

- Persist daily INR-based exchange rates in `currencyExchangeRates`.
- Copy latest active rate into `currencies.rateFromINR` for fast reads.
- Keep last good rate if provider fails; alert if stale > 48h.
- Use `FxRatePort` so provider can change.

PayPal gross-up:

```ts
G = (N + f) / (1 - p);
```

Where:

- `N` is intended net display amount after INR conversion.
- `p` is PayPal percentage fee decimal.
- `f` is fixed fee in the same currency.
- Optional extra FX/buffer/GST-on-fees policy must live in versioned `paypalCommissionRules`, not hardcoded.

Admin payment/pricing config:

- `currencies`
- `currencyExchangeRates`
- `paymentGatewayConfigs`
- `paypalCommissionRules`
- `taxClasses` and `taxRules`
- `shippingProviderConfigs`
- `shippingRateQuotes`

Gateway rules:

- INR checkout routes to CCAvenue.
- Non-INR checkout routes to PayPal.
- Gateway decision is server-side.
- Secrets are env/secret storage only; Mongo stores non-secret config, status, supported currencies, redirect URLs, version IDs.
- Payment records snapshot gateway config version and fee assumptions.

Shipping rules:

- Domestic and international lanes stay separate in config even if both use Shiprocket first.
- Shiprocket domestic and Shiprocket international adapters sit behind `ShippingPort`.
- Future DHL/FedEx/Aramex add adapters/config rows, not checkout rewrites.
- Store provider returned value and currency.
- Convert shipping via stored FX.
- Apply PayPal gross-up to shipping only for international PayPal checkout when rule says so.

### 16. Purchase Invoice And Inventory Intake API

This API supports the custom admin purchase invoice page.

Collections:

- `purchaseInvoices`
- `purchaseInvoiceLines`
- `inventoryLedger`
- `inventoryCostLayers`

Admin workflow API support:

- Create draft purchase invoice header.
- Add/update/remove invoice lines.
- Product selector endpoint returns products/variants for single-select dropdown.
- Add-new-product-in-modal flow uses normal product creation endpoint and returns created product/variant to populate the invoice line.
- Once line has a new product, existing-product selector becomes disabled in UI.
- Once line has existing product, add-new button becomes disabled in UI.
- Quantity and purchase price including tax are editable.
- MRP and sale price are fetched from catalog and returned read-only for launch.
- Posting invoice validates all lines and runs a transaction.
- **MUST-ASK GATE (purchase-invoice numbering, PENDING owner decision 2026-07-05):** purchase-invoice numbers use a **separate sequence** from order/tax-invoice numbers. Before implementing, if unanswered, **STOP and ask** the owner for Mode A/B, format, padding, and gapless enforcement (same rules as §14). See `owner-decisions-log.md` (2026-07-05).

Posting transaction must:

1. Validate supplier/invoice header.
2. Validate each product/variant exists and is eligible for stock intake.
3. Split tax-inclusive purchase price when tax rate is known.
4. Save invoice header and lines as posted.
5. Create inventory ledger receipt rows.
6. Create FIFO inventory cost layers.
7. Increment variant stock.
8. Leave catalog MRP/sale price unchanged.
9. Write audit logs.
10. Queue analytics/reporting rollup update.

Voiding a posted invoice is restricted, audited, and must reverse stock/cost layers through compensating ledger entries rather than silent deletion.

### 17. Content, FAQ, And Real Q&A

Keep FAQ and Q&A separate.

FAQ module:

- This corresponds to the existing `codex-faq-architecture-and-admin-plan.md` (renamed from `codex-qna-...`) targeting model.
- Admin-curated editorial FAQs can be general, category-targeted, product-targeted, or mixed.
- Category targeting may inherit to products with target preview and deduplication.
- FAQ content is translated (`en`, `bn`), SEO-aware, and rendered in initial SSR HTML on public routes.
- API must support target preview: selected categories, explicit products, estimated covered products, duplicates removed, and explicit products outside selected categories.

Real customer Q&A module:

- Customers submit questions from product pages.
- Non-logged-in form accepts name and email.
- Logged-in form pre-fills name and email from session but allows edit for this question.
- Both logged-in and guest users can select `stayAnonymous`.
- Public storefront shows `Anonymous` when the flag is true.
- Admin always sees actual submitted name/email.
- Admin has a separate Unanswered Q&A page.
- Admin answer publishes publicly on that product and triggers an email to the asker through `EmailPort`.
- Store question status: `pending_answer`, `answered`, `published`, `rejected`, `archived`.
- Add spam/rate limits and moderation guardrails.
- Do not expose raw email publicly.

### 18. Analytics, Reporting, Insight Sets, And Badges

Collections/contracts:

- `analyticsEvents`
- `analyticsDailyAggregates`
- `businessReportSnapshots`
- `productInsightSets`
- `productBadgeAssignments`
- `searchQueryAggregates`

Event capture:

- `product_view`
- `category_view`
- `search`
- `search_no_result`
- `add_to_cart`
- `remove_from_cart`
- `checkout_started`
- `checkout_abandoned`
- `order_placed`
- `product_bought`
- `wishlist_add`
- `coupon_applied`
- `admin_product_saved`
- `admin_price_changed`
- `admin_status_changed`
- `admin_sale_status_changed`
- `admin_purchase_invoice_posted`

Privacy rules:

- Optional analytics/marketing events require consent.
- Security/audit/transactional records do not require marketing consent but must minimize PII.
- Raw analytics events should have short retention when possible.
- Dashboards read aggregates/snapshots, not raw events where avoidable.

Admin reports must support:

- Most searched terms.
- No-result searches and candidate aliases/spellings/transliterations.
- Most viewed products/categories.
- Most added-to-cart products.
- Most bought products/variants/categories.
- Abandoned carts and checkout-started-but-not-paid.
- Sales by product, category, variant, day/week/month, currency, payment gateway.
- Gross revenue, discounts, refunds, tax, shipping charged, estimated gateway fees.
- COGS and gross profit by order/product/variant/category.
- Purchase totals by supplier/product/category/date.
- Inventory value, low stock, slow moving stock, stock aging.
- Returns/refunds by reason and product/category.
- Admin activity including product edits, price edits, stock updates, purchase invoice posts.

Weekly storefront insight job:

- Schedule predictably, e.g. Monday 02:00 IST.
- Inputs: aggregates, orders, search aggregates, product status/stock/media/price/category/tags, manual suppress/pin overrides.
- Outputs: active `productInsightSets` and refreshed `productBadgeAssignments`.
- Keep prior active set until new set succeeds.
- Exclude hidden/archived/discontinued/out-of-stock products unless admin-only.
- Store score explanation for admin review.
- Storefront homepage rails fetch stable insight sets such as Most Searched, Most Viewed, Most Bought, Trending, Hot, Popular.
- Product cards receive only top 1-2 badges by priority.

Manual badges and sale status:

- Product `saleStatus` switch in admin table writes/updates `sale` badge assignment.
- Manual featured/hot/popular/trending controls should coexist with analytics-derived suggestions.
- Analytics-derived labels become real tags only when admin promotes them; normal badges should not pollute taxonomy.

### 19. Media And DigitalOcean Spaces

Add `StoragePort`/Spaces adapter support if not already present.

Rules:

- Store media bytes in DigitalOcean Spaces SGP, not Mongo.
- Mongo stores `mediaAssets` with storage key, CDN URL, metadata, alt text, usage, size, dimensions, mime type.
- API upload endpoints are admin-only, CSRF-protected, rate-limited, size-limited, MIME-validated, and malware-scan-ready as a future seam.
- Public catalog returns CDN URLs and alt text.
- API must not proxy all media bytes in normal storefront browsing; use Spaces/CDN URLs.
- Archive/export jobs can later write compressed old product payloads to Spaces, but self-hosted Mongo cannot live-query Spaces as cold storage.

### 20. API Documentation

OpenAPI must be useful enough for admin/storefront development and Postman.

Requirements:

- `/openapi.json` always generated in non-production and available to CI.
- Scalar API Reference and its interactive client protected or disabled in production.
- DTOs documented from zod/Nest decorators as far as practical.
- Tags separate public vs admin areas.
- Every endpoint documents auth, CSRF, roles/permissions, request body, query params, response, validation errors, rate limits, idempotency requirements, and side effects.
- Developer portal later consumes OpenAPI and generated DB schema docs.

### 21. Tests And Verification Gates

Do not leave API with no meaningful tests.

Minimum test suites:

- Config validation tests.
- Zod contract tests for key DTOs.
- Auth unit tests: password policy, PIN policy, CSRF token validation, refresh rotation, reuse detection, audience checks.
- Auth integration tests: register/login set cookies and do not return tokens; CSRF blocks unsafe requests; storefront token cannot access admin; admin login rejects customer.
- OAuth unit tests with mocked provider verification.
- Cart tests: guest cart, merge, offline sync availability and inventory stages.
- Catalog tests: published-only public queries, archived 410 behavior, status/sale-status switches audited.
- Search tests: query normalization, dictionary expansion, outbox enqueue, adapter mocked typeahead.
- Transaction tests: purchase invoice post and order placement rollback on injected failure.
- Pricing tests: tax-inclusive reverse calculation, FX conversion, PayPal gross-up, shipping gross-up policy.
- Reporting tests: aggregate generation and weekly insight set exclusion rules.
- OpenAPI smoke test: `/openapi.json` exists and includes expected auth/admin/catalog tags.
- Health tests: liveness separate from readiness.

Command gates after each phase:

```bash
pnpm --filter @saha-textile/contracts test
pnpm --filter @saha-textile/core-domain test
pnpm --filter @saha-textile/adapters-db-mongo test
pnpm --filter @saha-textile/api lint
pnpm --filter @saha-textile/api typecheck
pnpm --filter @saha-textile/api test
pnpm turbo run lint typecheck test --force
```

Integration tests require a Mongo single-node replica set. **A documented Docker Compose test profile that spins up a single-node replica set is a mandatory Phase-C deliverable** (see §22 Phase C) — transaction tests must run against it locally and in CI. Skipping transaction tests is not an accepted outcome; "loud, explicit skip" is only a temporary state within a phase, never a done state.

### 22. Implementation Phases

Work in phases and stop for review after each major phase.

#### Phase A: Context and Delta Report

- Read files listed above.
- Inspect current API, contracts, core-domain ports, Mongo adapter models/repos, and package scripts.
- Produce a short delta report before coding: what already exists, what must be refactored, what new deps are required, what old assumptions must be removed.
- Resolve dependency versions per the dependency policy: list each proposed dep at its **latest** version, check cross-compatibility, and record the **pinned** (exact) versions. If latest-together conflicts, surface the conflicts + options in the delta report and pause for an owner call rather than downgrading the architecture.

#### Phase B: Contracts And Core Ports

- Add/expand zod contract families for auth/session/consent, catalog, search, cart, checkout, orders, inventory, pricing, reports, FAQ/Q&A.
- Add/expand core ports: transaction manager, auth/session repositories, search, storage, email, payment, shipping, FX, analytics/reporting, audit.
- Keep core-domain free of infra imports.
- Add contract/core tests.

#### Phase C: API Security Foundation

- Add cookies, CSRF guard, error filter, request id, redacted logger, CORS hardening, health readiness, OpenAPI improvements.
- Update runtime config and `.env.example` for self-hosted Mongo, Meilisearch, Cloudflare→Nginx edge assumptions (`TRUST_PROXY`, `CLIENT_IP_HEADER=cf-connecting-ip`, `EDGE_*` toggles), SGP Spaces, cookie/session variables, and transactional email (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`).
- **Deliver the Docker Compose test profile that runs a single-node Mongo replica set** (hard deliverable), so `withTransaction()` tests in later phases have a real replica set locally and in CI. Document how to start it.
- Add security bootstrap tests.

#### Phase D: Cookie Session Auth Refactor

- Replace browser JSON token auth with cookie-set responses.
- Implement session repository, refresh rotation, reuse detection, cookie service, CSRF issue/validation.
- Implement password policy and admin PIN policy.
- Implement admin login, storefront login/register, logout, refresh, me.
- Implement OAuth start/callback or provider-token verification paths for Google/Facebook behind provider services.
- Implement **channel-direct OTP via `NotificationPort` (MSG91)** — email/SMS/WhatsApp; 6-digit CSPRNG, HMAC-stored in `otpChallenges`, single-active-per-(identifier,purpose), atomic race-safe verify, TTL cleanup, generic anti-enumeration, per-identifier/IP caps, `console` adapter in dev/test. No OTP-Widget/SendOTP. Keep **phone OTP** as a seam only.
- Add auth tests.

#### Phase E: Mongo Transaction And Adapter Upgrade

- Add transaction manager.
- Ensure Mongo connection supports replica set URI and sessions.
- Update repositories to accept transaction/session context where needed.
- Add transactional tests with rollback behavior.

#### Phase F: Catalog, SEO, Search, And Merchandising APIs

- Implement/upgrade collections, contracts, and endpoints for categories, category placements, category facet configs, tags, attributes, add-ons, products, variants, product relations, product groups, SEO routes/redirects, badges.
- Implement admin table status/sale-status patch endpoints with audit and search outbox.
- Implement public published-only catalog routes and archived/discontinued 410/redirect behavior.
- Wire Meilisearch adapter behind `SearchPort`, dictionary, outbox, typeahead endpoint.
- Add catalog/search tests.

#### Phase G: Cart, Checkout, Orders, Pricing, Payments, Shipping

- Implement cart, guest merge, offline sync validation, checkout quote, order placement transaction.
- Implement pricing service: INR canonical, tax-inclusive calculations, FX, PayPal gross-up, promotion resolution.
- Add payment/shipping ports with stub/sandbox-ready adapters and safe webhook patterns. **No live provider wiring at this stage** — real CCAvenue/PayPal/Shiprocket integration waits until the client provides live credentials/access (per the provider integration policy).
- Add order/payment/shipment/return/refund snapshot models as needed.
- Add tests.

#### Phase H: Inventory, Purchase Invoices, Reporting, Insight Jobs

- Implement purchase invoice draft/post endpoints and FIFO cost layers.
- Implement analytics event capture, daily aggregate job, business report snapshots, weekly product insight sets, product badge assignments.
- Add dashboard/report endpoints.
- Add tests.

#### Phase I: Privacy, Content, FAQ, Q&A, Media

- Implement consent endpoints and analytics gating.
- Implement FAQ targeting module and target preview.
- Implement customer product Q&A submission and admin answer/publish/email flow.
- Implement Spaces media asset admin endpoints if not already present.
- Add tests.

#### Phase J: Documentation, Seeds, And Final Verification

- Update API README/runbook.
- Update OpenAPI and env docs.
- Add seed data for real Saha patterns: multi-placement categories, simple products, variable products with No Stitching/No Blouse, filter-only color, named add-on blouse-design-on-saree example, bundle/composite seam fixture, tags, sample search dictionary, sample admin user bootstrap.
- Run full lint/typecheck/test gates.
- Provide final report with implemented endpoints, contracts, collections, tests, and remaining deferred seams.

### 23. Done Means

Do not mark the API app done unless all are true:

- Browser auth uses httpOnly cookies and CSRF, not JSON tokens stored by Angular.
- Admin and storefront auth audiences are separated and tested.
- Public routes return only public-safe DTOs.
- Admin routes require admin audience/permissions and audit writes.
- Mongo transactions exist and are used on order placement and purchase invoice posting.
- Search goes through `SearchPort` and Meilisearch adapter, with dictionary/outbox seams.
- Offline cart sync returns line-level availability and inventory decisions.
- Product status and sale-status table switch endpoints exist and are auditable/filterable/sortable through API contracts.
- Pricing/tax/FX/PayPal/shipping calculations are server-side and snapshotted on orders.
- Purchase invoice posting creates inventory ledger and FIFO cost layers.
- Analytics rolls into stable insight sets/badge assignments for storefront rails/cards.
- Consent events and analytics gating exist.
- FAQ and true Q&A are separate modules.
- OpenAPI exists and tests cover major security and business flows.
- No new stale dependencies or references to Caddy, Atlas-only features, Tailwind, shadcn, Brevo lock-in, X login, or browser token storage are introduced.

### 24. Official References To Verify During Implementation

Use official/current docs while implementing, especially because this project targets modern versions:

- MongoDB Node.js driver transactions: https://www.mongodb.com/docs/drivers/node/current/crud/transactions/
- MongoDB transactions manual: https://www.mongodb.com/docs/manual/core/transactions/
- Meilisearch typo tolerance: https://www.meilisearch.com/docs/capabilities/full_text_search/relevancy/typo_tolerance_settings
- Nginx proxy module: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- OWASP CSRF prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- Google OAuth 2.0: https://developers.google.com/identity/protocols/oauth2
- Meta Facebook Login: https://developers.facebook.com/docs/facebook-login/web

### 25. Deferred Storefront → API Integration Notes (added 2026-07-17)

Recorded here so they are not lost while the storefront is built ahead of the API:

- **Server-error interception → `/500`.** The storefront `/500` page and route now exist (`apps/storefront/.../features/page/error500` + `pages/500.page.ts`), but nothing auto-navigates to it yet. When the API/SSR layer is wired, add a real error path that routes users to `/500` on backend/SSR 5xx failures (HTTP interceptor + Nitro/AnalogJS SSR error handling). Do not silently swallow 5xx. Keep 404 (not-found) and 500 (server-error) paths distinct. This mirrors how the maintenance interceptor already routes to `/maintenance` when `setting.maintenance.maintenance_mode` is on.
- **`500.png` placeholder asset.** The storefront currently uses a duplicate of `404.png` saved as `assets/images/inner-page/500.png`. Replace with a dedicated 500 illustration before launch.
- **Error/status page copy is storefront Transloco keys, not API/CMS.** 404/500/maintenance text is developer-managed i18n (Machine-1). The API does not need to serve this copy. The `maintenance_mode` flag (and maintenance image) remain settings-driven.

End of prompt.
