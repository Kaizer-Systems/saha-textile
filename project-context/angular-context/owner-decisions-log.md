# Owner decisions log

> Authoritative running record of decisions the owner has locked, so they're not lost between the codex/claude planning files and the main KB/roadmap. Items marked **PENDING** await the owner; catalog Q3/Q4/Q5/Q7/Q8 were resolved on 2026-07-04.

## 2026-06-29 — Auth (from `codex-auth-...`)

- **LOCKED — No MFA at launch.** Admin logs in via **email+password OR username+password**. Build the seam only.
- **LOCKED — Admin quick-login PIN (new).** Admin may use a **6-digit PIN** of their choice as a faster alternative to the password. **No authenticator-app dependency.** Enforce PIN strength: **reject weak/sequential/repeated PINs** (`000000`, `123456`, `012345`, `111111`, repeated/sequential patterns) via a denylist + pattern checks (not just regex). Same session/cookie security as password login.
- **LOCKED — OAuth UX = provider JS buttons + backend verification.** Use Google/Facebook **provider buttons (best UX, e.g. Google One Tap)**, but the **backend verifies provider tokens and owns the cookie session** (full data/auth control). Request **minimum scopes only** (`openid email profile`; `public_profile,email`). All unpaid. _(Note: adds some CSP/COOP work vs pure backend-redirect — accepted for the UX.)_
- **LOCKED — Domains:** `sahatextile.com` (storefront), `admin.sahatextile.com`, `api.sahatextile.com`.
- **LOCKED — Phone:** collected at **checkout/address stage, optional**, not at registration — until there's budget for phone-OTP.
- **LOCKED — Offline (PWA):** offline = **catalog browsing + offline cart only**. On reconnect: non-logged-in cart → becomes a guest cart; logged-in cart → attaches to the user. **No account/order data cached or shown offline.**
- **LOCKED — On-reconnect cart validation (new, two stages):**
    1. **Availability/status check** per line. If a product is no longer in the portfolio (archived/discontinued/unpublished) → terminate with a clear error, e.g. _"This product is no longer available."_
    2. **Inventory check** per line (only if stage 1 passes). If the product is active but inventory is gone/insufficient → the cart **modifies that line** (e.g. remove the +/- quantity controls, mark out-of-stock) instead of treating it as a normal line.
    3. If both pass → no notification needed (silent success).
- **LOCKED — Password length ≥ 12** for **both** frontends (storefront + admin) + common-password denylist.
- **LOCKED — Cookie-session model.** Adopt API-set **httpOnly cookie sessions + double-submit CSRF + opaque rotating refresh with reuse-detection.** Refactor: add `@fastify/cookie`, CSRF guard, cookie set/clear session service, cookie-first JWT guard (bearer fallback for non-browser), refresh rotation + reuse detection. _(This replaces our current Phase-3 "JSON bearer token" auth.)_
- **LOCKED — Email OTP is conditional, NOT Brevo.** Include email OTP **only if it can be done programmatically at $0** in our setup. **Do not lock Brevo.** Keep email OTP as a **seam** like phone-OTP. _(Honest note: $0 transactional email with good deliverability is hard — options are self-hosted SMTP from the droplet w/ SPF/DKIM/DMARC [free but spam-risk] or a free provider tier [Resend/MailerSend]. Not a launch blocker — password + Google/FB cover login.)_ **→ RESOLVED 2026-07-02: outbound transactional email via `EmailPort`, primary Resend free tier (adapter-swappable, no Brevo); inbound via Cloudflare Email Routing. Hostinger dropped at go-live. See the 2026-07-02 section.**
- **LOCKED — Provider scope:** Google ✅, Facebook ✅, phone-OTP seam-only (paid SMS, deferred), **X/Twitter excluded.**
- **PENDING owner clarity (later):** exact PIN UX (where it's set, lockout policy).

## 2026-06-29 — GDPR / privacy / cookie consent (new requirement)

- **LOCKED — Granular cookie + privacy consent, self-hosted, no paid tool.** Site is accessed worldwide incl. EU → need a **privacy-policy acceptance + cookie-consent banner** with **per-category toggles**: strictly-necessary (always on), **functional, targeting, marketing, promotional** (and any others) — each **user-customizable**. Block non-essential scripts until consent; store consent + version + timestamp (codex `consentEvents` collection). **No paid CMP** — build it ourselves (small Angular consent component + storage). _(Our KB §08 already has GDPR consent; reconciliation will upgrade it to these granular categories + the self-hosted/no-paid-tool stance.)_

## 2026-06-29 — Database & infrastructure (supersedes "M0 / Atlas")

- **LOCKED — Leaving MongoDB Atlas entirely.** Self-host **dockerized MongoDB on the $24 droplet** (2 vCPU / 4 GB / 80 GB SATA SSD / 4 TB transfer), alongside the API, search, and **Nginx** (origin reverse proxy behind Cloudflare — Caddy is superseded; see 2026-07-02 edge decision).
    - **Single-node replica set** (enables multi-document **ACID transactions**).
    - Named volume / bind-mount on the droplet SSD; **bound to the private Docker network only** (27017 not public).
    - **Resource caps** for Mongo memory/CPU (so it doesn't starve API/search); health checks + restart policy.
    - **Weekly scheduled backups** on the droplet; later, automated archival to Spaces.
- **LOCKED — Catalog Q1 & Q2 are MOOT** (no M0, no Atlas).
- **LOCKED — Mongo 8.x transactions.** Use `session.withTransaction()` for atomic multi-collection writes (post purchase-invoice; place order; etc.). Use current 8.x practice, not old-version workarounds. _(Caveat: single-node RS = no failover; mitigated by backups + a standby later.)_
- **LOCKED — Spaces for media** (images/video/large files) + CDN. **Region = SGP (Singapore)** (BLR not offered for Spaces).
- **Reality flag:** 4 GB RAM hosting Mongo + Meilisearch + 3 app containers + Nginx is **tight** → plan to move to the **8 GB droplet (~$48/mo)** as catalog/traffic grows.
- **LOCKED — Product archive retention.** Keep archived products fully in Mongo at launch. Design the compressed JSON-to-Spaces + Mongo stub seam now, but build/run cold archive only later when droplet disk pressure is real (suggested trigger: 60-65% of the 80 GB disk). Mongo cannot query Spaces directly; restore is an explicit API/admin action.
- **LOCKED — Local/prod Mongo parity.** Local development on Mac must run Dockerized MongoDB 8.3 through Docker Desktop with the same single-node replica-set behavior used in production, so transaction code is tested locally before deployment.

## 2026-06-29 — Catalog (from `codex-catalog-...`)

- **LOCKED — Q6 tax:** **tax-inclusive prices displayed AND stored**; reverse-calculate pre-tax values only where/when needed.
- **LOCKED — Q9 inventory valuation:** **FIFO hidden cost layers** (unit-level COGS/margin; no customer-facing batch/MRP complexity).
- **LOCKED — PayPal commission admin screen** (`Settings > Payments > PayPal Commission`, versioned + calculator preview).
- **LOCKED — Weekly analytics → persisted insight sets + badge assignments** (storefront rails/product-card badges read stable curated collections, not live analytics).
- **LOCKED — Separate collections** (orders/payments/shipments/returns/refunds + the rest) with immutable order-line snapshots, **and they must use transactions** for atomic cross-collection writes (see Mongo decision above).
- **LOCKED 2026-07-04 — Q3 categories.** Use multi-placement DAG via category placements and clean WooCommerce junk on import. Do not force a strict single-parent tree.
- **LOCKED 2026-07-04 — Q4 product complexity.** Build the model/contracts for all five patterns: simple products, variation/SKU products, tailoring/customization, bought-together/cross-sell/upsell relations, and true bundle/composite products.
- **LOCKED 2026-07-04 — Product option role rule.** If an option changes the main sellable item's SKU, stock, price row, image, base identity, or purchasability, it is a variation axis. If it customizes an included sub-part/service, it is a named add-on option group. If it consumes separate inventory/components as a kit, it is a bundle/composite component. If it is only searchable/filterable/display-only, it is a filter/descriptive attribute.
- **LOCKED 2026-07-04 — Color and all other option axes are toggle-based per product.** Color, size, fabric, design, waist, liter, etc. are filter/descriptive by default and become variation-driving only when the product upload flow explicitly marks them as `variation_axis`.
- **LOCKED 2026-07-04 — Fastkart attribute terminology.** Fastkart's "Attribute" master becomes our reusable option/attribute definition. Per-product semantic role (`filter_only`, `variation_axis`, `named_add_on`, `bundle_component_option`) is separate from per-product storefront `displayStyle`.
- **LOCKED 2026-07-04 — Storefront option display styles.** Support Fastkart's six visual styles as canonical display values: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`. Visual style never decides business behavior.
- **LOCKED 2026-07-04 — Saree/blouse nuance.** A standalone blouse can use design as a normal variation axis. A saree whose base cloth includes a blouse piece keeps the saree as the base product; `Blouse Design` is a named add-on group with default `No Design`, optional price/media/measurement requirements, and no forced saree variant matrix.
- **LOCKED 2026-07-04 — Multiple named add-on groups.** Future products may have multiple named add-on groups such as `Blouse Design` and `Aachol/Churni Design`, each with defaults and independent measurement/price rules.
- **LOCKED 2026-07-04 — Q8 search.** Self-host Meilisearch behind `SearchPort`. Full Level 1-4 search feature surface exists from day one: typo tolerance, English aliases, Bengali script/transliteration dictionary, suggestions, no-result analytics, and admin dictionary tuning. The seed dictionary may start small; curation improves over time.
- **LOCKED 2026-07-04 — Storefront category/sidebar facets.** Category and collection pages use a Fastkart-style sidebar/off-canvas filter UI backed by API/search facets, not ad hoc Mongo queries. Product option `filter_only` only means a value is eligible for filtering/search; a separate category/placement facet config decides whether it appears publicly, in what order/style, and on which category path.
- **LOCKED 2026-07-04 — Facet data source and SEO.** Storefront listing filters query Meilisearch through `SearchPort` and return products plus facet counts/ranges in one response. Mongo remains source of truth and feeds the denormalized search document. Arbitrary filter URLs are `noindex,follow` and canonical to the base category unless deliberately modeled as SEO landing pages/product groups.
- **LOCKED 2026-07-04 — Facet semantics.** Variation-axis filters must resolve against active purchasable variants; product-level `filter_only` values match product metadata; named add-ons and bundle components are not sidebar facets by default unless explicitly enabled as merchandising filters. Rating and delivery filters use persisted aggregate/coarse fields, not live joins or exact courier checks.

## 2026-06-29 — Q&A and FAQ (CORRECTION)

- **IMPORTANT correction:** the entire `codex-faq-architecture-and-admin-plan.md` (renamed 2026-07-02 from `codex-qna-architecture-and-admin-plan.md`) content was **mislabeled — it actually describes FAQs**, not Q&A. So:
    - **FAQ** = the editorial/targeted module described in that codex file (general/product/category/mixed targeting, admin-curated). Its "inherited category → product" question stays **Option A (yes, inherited with preview)**.
    - **Q&A** = a **customer-driven product Q&A**, defined now as:
        - **LOCKED — Customers submit questions from the product page.** Admin has a **separate "Unanswered Q&A" page** to respond.
        - **LOCKED — Admin's answer publishes the Q&A publicly** on that product, **and emails the asker** (email captured on the question form).
        - **LOCKED — Question form:** non-logged-in users type **name + email**; logged-in users get name+email **prefilled from session** (editable for the question). Both have a **"Stay anonymous"** checkbox → public storefront shows **"Anonymous"**, but **admin always sees the real name/email**.
    - **LOCKED — Q&A and FAQ are separate admin pages**, sharing reusable table/dropdown/editor components.
- **Reconciliation action:** ✅ file renamed to `codex-faq-architecture-and-admin-plan.md` (2026-07-02); repurpose its content as the **FAQ** plan; add a new **Q&A** spec per the above (customer-submitted, admin-answered, anonymous flag, email-on-answer).

## 2026-07-02 — API build kickoff decisions (review of `codex-api-app-build-instructional-prompt.md`)

Context: reviewed the Cursor build prompt for `apps/api`. The five items below are now **LOCKED** and the prompt file has been updated to match.

- **LOCKED — Phased execution, one phase at a time.** Build `apps/api` phase-by-phase (Phases A–J in the prompt). **Each phase is its own run/session with the §21 test gates enforced before the next phase starts.** Do not attempt A–J in one pass. Stop for owner review after each major phase.
- **LOCKED — Seams/adapters first, real providers later.** Payments (CCAvenue/PayPal) and shipping (Shiprocket) ship now as **ports + stub/sandbox adapters only**. Real gateway wiring happens **only after the client grants live credentials/access**, and will follow each chosen provider's official docs + supported SDK/stack at that time. No provider SDK integration is a launch blocker.
- **LOCKED — Mongo replica-set test infra is a hard Phase-C deliverable.** A **Docker Compose test profile** running a single-node replica set (so `withTransaction()` works) must be delivered **in Phase C**, and transaction tests run against it in local/CI. **`vitest --passWithNoTests` and silent-skipping transaction tests are NOT acceptable** — this protects the rigidity/standards we locked.
- **LOCKED — Discontinuing Hostinger.** Hostinger existed only for the old WordPress site. On the manual stack it is dropped **at go-live**. Its two functions are re-homed into the stack we already own/pay-for: **Cloudflare (free) for inbound email + edge**, **a transactional email provider free tier for outbound**, **DigitalOcean droplet + Spaces** for compute/media.
- **LOCKED — Email is split into two jobs.**
    - **Inbound** (receiving `@sahatextile.com` mail): **Cloudflare Email Routing (free)** — DNS is already on Cloudflare, so this is a dashboard toggle that sets Cloudflare MX and forwards `support@`/`hello@`/bounces to a real inbox. Replaces the Hostinger mailbox at $0.
    - **Outbound transactional** (OTP + order confirmations, Q&A answer emails, password resets, admin invites): a **transactional email provider free tier behind our `EmailPort`**. **Primary = Resend** (3,000/mo·100/day free, API+SMTP, verified via Cloudflare DNS, strong deliverability). Adapter-swappable alternatives documented: **MailerSend** (3k/mo) and **Amazon SES** (~$0.10/1k). **No lock-in, no Brevo.** _(Rejected: Cloudflare can't send outbound — Email Routing is inbound-only; self-hosted Postfix on the droplet is out — DO blocks port 25 by default and droplet-IP reputation tanks OTP deliverability.)_
- **LOCKED — Cloudflare-fronted, adapter-based edge (proxy / TLS / CDN / security).** Site is already Cloudflare-proxied (verified). The edge layer is **config-driven toggles**: if no explicit in-code/droplet config is present, **whatever is enabled in the Cloudflare free dashboard takes effect**; if a feature is configured in the codebase/droplet, that **overrides**. Specifics:
    - **TLS:** default = Cloudflare Universal SSL at edge + origin cert; **recommended default origin = Full (Strict) with a free Cloudflare Origin CA cert** on Nginx. Override = explicit **certbot/Let's Encrypt** publicly-trusted origin cert when configured.
    - **CDN/cache:** default = Cloudflare honors origin `Cache-Control`; override = explicit Nginx/app cache headers + Cloudflare Cache Rules win.
    - **Security:** default = Cloudflare free WAF/DDoS/basic rate-limit at edge; app-level (`@fastify/rate-limit`) + Nginx limits **always on** as defense-in-depth; Cloudflare premium only if configured.
    - **Mandatory origin hardening:** API must `trustProxy` and read **`CF-Connecting-IP`** for the real client IP (rate-limit keys, logs, consent IP hashing); **droplet firewall locked to Cloudflare IP ranges** so the origin can't be bypassed.
- **LOCKED — Email OTP anti-enumeration.** OTP "send code" returns a **generic response** ("If an account exists, we've sent a code") regardless of whether the email is registered, paired with strict rate-limiting. (Owner accepted the security recommendation over branching UI on existence.)
- **LOCKED — Dependencies pinned at latest-compatible.** Take all stack deps (NestJS 11, Fastify + plugins, Mongoose, zod, Vitest, etc.) at their **latest versions**, verify cross-compatibility, then **pin** them. If latest-together has conflicts, **list them + best options that don't compromise the architecture** and get an owner call before proceeding.
- **LOCKED — FAQ/Q&A file renamed.** `codex-qna-architecture-and-admin-plan.md` → **`codex-faq-architecture-and-admin-plan.md`** (its content is the FAQ/editorial-targeting plan per the 2026-06-29 correction). All cross-references updated.

### DNS / email verification (checked 2026-07-02)

Facts confirmed by live DNS lookups:

- **Registrar** = GoDaddy; **DNS** = delegated to **Cloudflare** (`duke/mary.ns.cloudflare.com`); **web** = already **Cloudflare-proxied** (A = `104.21.37.106` / `172.67.207.130`, orange-cloud active).
- **MX** = `mx1/mx2.hostinger.in` (Hostinger — to be removed at cutover). **SPF** = `v=spf1 include:_spf.mail.hostinger.com ~all` (Hostinger only). **DMARC** = none. **DKIM** = none visible.

### Email transfer plan (Hostinger → Cloudflare + Resend), cutover-safe

1. Create Resend; add `sahatextile.com`; verify via Cloudflare DNS (domain TXT + DKIM CNAMEs).
2. **SPF** → replace the Hostinger include with `include:_spf.resend.com`; **add DMARC** at `_dmarc` (`p=none` → tighten to `quarantine` later).
3. Enable **Cloudflare Email Routing** (inbound) → replaces Hostinger MX, forwards `support@`/`hello@`/bounces to a real inbox.
4. Wire `EmailPort` → **Resend adapter** (`RESEND_API_KEY`); `console` adapter in dev/test.
5. **Only discontinue Hostinger after** Resend is verified + routing is live + a real OTP test lands in inbox (the "at go-live" cutover).

### Email OTP flow (mapped to our hexagonal model)

1. User enters email and requests an OTP.
2. Backend generates a **6-digit** OTP (preferred over 4 for entropy; consistent with the admin-PIN posture), stores it in the dedicated **`otpChallenges`** collection (NOT on the user document) with a **10-minute expiry**, an attempt counter, and `purpose = login`.
3. OTP emailed via the `EmailPort` provider adapter (Resend).
4. On verify: match + not-expired + attempts < max → issue the normal httpOnly cookie session and **consume/clear the challenge immediately** (single-use). Expired/used → generic "code expired, request a new one" UX.
5. Env: `OTP_TTL_SECONDS=600`, `OTP_MAX_ATTEMPTS=5`.
6. **Anti-enumeration (LOCKED):** the "send code" response is **generic** ("If an account exists, we've sent a code") regardless of whether the email is registered, plus rate-limiting. No branching UI on existence.

- **Scale caveat:** Resend free = 100/day·3,000/mo — comfortably covers launch OTP + transactional volume. If outgrown, swap the `EmailPort` adapter (MailerSend/SES) — no domain or architecture change.

## 2026-07-02 — Multi-channel notifications (SMS / email / WhatsApp) + admin control

Context: the owner wants **one umbrella** for all customer messaging — **OTP/verification, order & account updates, and admin promotional/marketing** — across **SMS, email, WhatsApp**, operated from the admin panel. Team mailboxes are a **separate** system (see below).

- **LOCKED — Team mailboxes = Google Workspace.** `admin@`, `support@`, and other operational IDs move off Hostinger to **Google Workspace** (~$6–8.40/user/mo). This is the human inbox (send/receive), **distinct** from programmatic messaging. Cloudflare remains DNS; MX points to Google. _(Supersedes the interim Zoho suggestion and the Cloudflare-Email-Routing-only idea for team mail — Cloudflare routing is forwarding-only, not a mailbox.)_
- **PROVIDER — leaning MSG91 (pending owner confirm).** Deep comparison done (MSG91 vs Twilio). For a mostly-India, INR-billed, cost-sensitive store wanting admin-panel campaigns, **MSG91** wins: ~₹0.15–0.20 SMS (Twilio ~₹0.45–0.63 + forex), Meta-rate WhatsApp + ₹500/mo/number, near-free email, DLT assistance, INR wallet, built-in campaign tooling. Twilio = premium global DX but pricier for India + self-DLT + build-your-own-campaigns. **Email:** consolidate into MSG91 (one bill, cheap) with `EmailPort` swappable to Resend/SES as fallback → this **revises the earlier "Resend primary" email lock to "provider(MSG91) primary, Resend fallback"**, pending confirm.
- **LOCKED — `NotificationPort` abstraction, provider-swappable.** All customer messaging flows through a core-domain **`NotificationPort`** with per-channel adapters (**email / SMS / WhatsApp**) and a provider adapter. Seam-first (same pattern as payments/shipping): build ports + adapters + admin UI now; **wire the live provider only once account + DLT + WhatsApp template approvals land**. OTP uses our own `otpChallenges` store (no paid Verify-API surcharge) — OTP is just a cheap templated message on the enabled channel.
- **LOCKED — Per-channel master toggles (kill-switches), provider-agnostic.** The admin panel exposes **independent on/off switches per channel** (email, SMS, WhatsApp). When a channel is OFF, the API **short-circuits every outbound call on that channel across all flows** (OTP, transactional, marketing) — no provider call is made. Flows degrade gracefully: OTP falls back to an enabled channel; if all OTP channels are off, the affected login method is blocked/adjusted with clear UX. The owner can run **any subset of the three**; all three ship code-ready regardless of the chosen provider.
- **LOCKED — Plan-limit awareness / spend control.** Track usage per channel against the purchased plan/wallet; when nearing/exceeding the included limit, **warn and optionally auto-disable** that channel (admin-configurable threshold) to prevent runaway spend (esp. WhatsApp _marketing_ at ~₹0.86/msg — the dominant cost line).
- **LOCKED — RBAC on channel/billing controls.** The notification-channel settings (toggles, plan limits, thresholds) live on a **dedicated admin settings page/section with its own menu entry**, **restricted to high-privilege roles only** (owner/super-admin). Enforced **server-side** by the role/permission system (permission-version bump on change + audit log), not just UI hiding — the API authorizes every toggle mutation. This RBAC page/menu gating is a general pattern for privileged settings, not a one-off.
- **LOCKED — Marketing is consent-gated.** Promotional SMS/email/WhatsApp sends require opt-in via `consentEvents`; transactional (OTP/order/account) does not. Marketing WhatsApp/SMS also require approved DLT/WhatsApp **templates**.
- **New collections/contracts (seam):** `notificationChannelSettings` (per-channel enabled flag, plan/wallet limits, usage counters, auto-disable thresholds), `messageOutbox`/`notificationLog` (per-message audit + delivery status per channel), `notificationTemplates` (channel+category templates incl. DLT header/template IDs and WhatsApp template IDs). Affects **API + DB + Angular admin** planning.

## 2026-07-05 — Notifications provider, OTP mechanics, numbering, periods

Detail for the messaging items lives in **`msg91-notifications-provider-and-pricing.md`**; this section records the locks.

- **LOCKED — MSG91 is the notifications provider** for **SMS + WhatsApp + Email** (email consolidated into MSG91). **Revises the 2026-07-02 "Resend primary" email lock → "MSG91 primary."** Resend/SES remain only as a code-level `EmailPort` fallback (not operated). Team mailboxes stay **Google Workspace** (separate). Full pricing + hybrid billing (wallet-rollover for SMS/OTP/WhatsApp/Voice/RCS; monthly-reset quota for Email/Segmento; single ₹500/mo per WhatsApp number; failed SMS charged; one route-based wallet, not separate domestic/intl packages; +18% GST) is in the MSG91 doc §2–§3.
- **LOCKED — Channel-direct OTP.** We generate/store/verify OTP ourselves (`otpChallenges`) and send the code via the **SMS / WhatsApp / Email** channel tools. We do **NOT** use MSG91's **OTP Widget** or **SendOTP** for any use case (keeps our security controls + one `NotificationPort`, marginally cheaper). Billing = **per send only**; resend = +1 send; the ₹500/mo WhatsApp fee is a **single per-number** fee covering all WA categories (not per-message/per-category).
- **LOCKED — Split kill-switches.** Per-channel master toggles are **split by category**: transactional/utility (OTP, order/status, payment, security — keep ON, cheap) vs **marketing** (consent-gated, independently capped — WA-Marketing ₹0.8631 is the runaway line). A disabled (channel × category) short-circuits all its outbound calls across every flow; OTP falls back to an enabled channel. Plan-limit awareness warns/auto-disables near limits. Toggles save per-message burn, not the fixed WhatsApp-number / Email / Segmento monthly fees. RBAC-gated, server-authorized, audited. (See MSG91 doc §6 + the 2026-07-02 notifications section.)
- **LOCKED — OTP mechanics.** CSPRNG **6-digit** code; store **`HMAC-SHA256(code, server-pepper)`** (NOT plaintext, NOT Argon2 — overkill/slow for 6 digits; short TTL + attempt caps + pepper are the defense). `otpChallenges` fields: `identifier`, `purpose`, `channel`, `codeHash`, `expiresAt (=now+600s)`, `attempts`, `maxAttempts (5)`, `consumedAt`, `resendCount`, `lastSentAt`, `ip/uaHash`. **Single active challenge per (identifier, purpose)** via atomic upsert + partial unique index on `consumedAt:null` (latest supersedes; cross-user identical code values are harmless — scoped per challenge). **Verify** = atomic find-active → constant-time compare → on match atomically set `consumedAt` + issue session; on miss atomically `attempts++`, invalidate at max. **Expiry** via Mongo TTL index + reject expired/consumed. Resend cooldown + per-identifier/per-IP caps (`authRateLimits`). Generic anti-enumeration responses; codes never logged; pepper in env.
- **PENDING (owner decision) — Invoice/order numbering, with a proactive-ask GATE.** Proposed format `<CompanyCode>/<FY-short>/<zero-padded counter>` (e.g. `ST/26-27/000042`). Two modes: **A** FY-reset (counter resets + FY segment auto-rolls 1 Apr IST) vs **B** perpetual (static prefix, forever counter). India GST constraints baked in regardless: ≤16 chars, alphanumeric + `/` `-`, unique + **consecutive/gapless per FY**, separate sequences for order-no vs tax-invoice-no vs purchase-invoice-no, gaplessness via cancel-status not delete. **GATE:** before implementing orders/checkout/invoicing/numbering — or a neighboring collection this affects — if the owner has not already answered, **STOP and ask** (Mode A/B, company code/separators/padding, gapless, separate sequences). Mirrored as a MUST-ASK callout in the build prompt §14/§16.
- **CONFIRMED — Admin "Quarter" = Indian financial quarter** (Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar), not calendar.
- **DRAFT (not locked) — Deferred/queued-action (intent-preservation)** pattern + tables in `deferred-queued-actions-intent-preservation.md`. Awaiting owner verify; also surfaces a **guest-checkout vs forced-login PENDING** decision (row 9).
- **LOCKED — Timestamp / period-duration standard.**
  - **Storage = UTC** always (Mongo `Date`, ISO-8601 `…Z`); never store IST-with-offset in the DB. API returns UTC; frontends format at the edge.
  - **Accounting/legal anchor = IST (Asia/Kolkata).** All business boundaries — order date "for the books", FY, quarter, month, daily aggregates, invoice date — computed in IST. **India FY = 1 Apr–31 Mar**; admin **"Quarter" = Indian financial quarter** (Apr-Jun/Jul-Sep/Oct-Dec/Jan-Mar). Resolves all month-end/offset corner cases (an 11:30 PM IST 31-Mar order is in that FY regardless of the customer's local date).
  - **Display = audience-aware, always tz-labeled** (never a bare time). **Storefront:** customer-local time, detected client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone` (fallback: profile/shipping-country, else IST). **Admin:** always IST.
  - **PDF invoices = IST, stamped at generation and frozen/immutable** (never regenerated in the viewer's zone — same invoice must show the same date to everyone for GST/audit). Optional courtesy "your local time" line allowed.
  - **Presets computed dynamically, never hardcoded.** **Admin** (reports/history): Last 30 days, Last calendar month (auto 28/29/30/31), Current Quarter, Last Quarter, Current FY, 3 named prior FYs (excl. current), Custom Range. **Storefront** (orders; extensible): Last 30 days, Last 90 days, This year (calendar YTD), named prior calendar years, Custom (later).

## Reconciliation checklist (to do after PENDING items are confirmed)

1. ✅ Replace live **Atlas M0** guidance in KB/roadmap with the **self-hosted dockerized Mongo (single-node RS + transactions)** plan; update infra/cost sections; update env (Mongo connection to local container). Remaining Atlas/M0 mentions are retained only when explicitly labeled historical/superseded.
2. Add the **cookie-session auth model** to KB §08 (+ note the API refactor) and the granular **cookie-consent/GDPR** component.
3. Add the **admin 6-digit PIN** login, **on-reconnect cart validation (2-stage)**, and **email-OTP-conditional/no-Brevo** notes.
4. Fold the **catalog DB collections, FIFO/COGS, PayPal-commission screen, weekly-insight pipeline, separate order/payment/shipment/return/refund + transactions** into KB §data-model / roadmap.
5. ✅ File renamed to **`codex-faq-architecture-and-admin-plan.md`**; recast its content as the **FAQ** plan; add the new **customer Q&A** spec.
6. ✅ Reflect the confirmed **Q3/Q4/Q5/Q7/Q8** answers in the data model + admin/search plan (2026-07-04 reconciliation pass).
