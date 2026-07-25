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
- **RESOLVED 2026-07-23 — Admin PIN UX / setup / lockout:** see §2026-07-23 Admin PIN UX (clears the former “PENDING owner clarity” on exact PIN UX).

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
- **LOCKED 2026-07-07 — Deferred/queued-action intent preservation.** The reviewed draft in `deferred-queued-actions-intent-preservation.md` has been folded into the 2026-07-07 section below. Guest checkout is **not** available at launch; `Proceed to checkout` from the cart forces login/signup, then resumes checkout after guest-cart merge. Cart/order collections must still preserve a future guest-checkout seam.
- **LOCKED — Timestamp / period-duration standard.**
    - **Storage = UTC** always (Mongo `Date`, ISO-8601 `…Z`); never store IST-with-offset in the DB. API returns UTC; frontends format at the edge.
    - **Accounting/legal anchor = IST (Asia/Kolkata).** All business boundaries — order date "for the books", FY, quarter, month, daily aggregates, invoice date — computed in IST. **India FY = 1 Apr–31 Mar**; admin **"Quarter" = Indian financial quarter** (Apr-Jun/Jul-Sep/Oct-Dec/Jan-Mar). Resolves all month-end/offset corner cases (an 11:30 PM IST 31-Mar order is in that FY regardless of the customer's local date).
    - **Display = audience-aware, always tz-labeled** (never a bare time). **Storefront:** customer-local time, detected client-side via `Intl.DateTimeFormat().resolvedOptions().timeZone` (fallback: profile/shipping-country, else IST). **Admin:** always IST.
    - **PDF invoices = IST, stamped at generation and frozen/immutable** (never regenerated in the viewer's zone — same invoice must show the same date to everyone for GST/audit). Optional courtesy "your local time" line allowed.
    - **Presets computed dynamically, never hardcoded.** **Admin** (reports/history): Last 30 days, Last calendar month (auto 28/29/30/31), Current Quarter, Last Quarter, Current FY, 3 named prior FYs (excl. current), Custom Range. **Storefront** (orders; extensible): Last 30 days, Last 90 days, This year (calendar YTD), named prior calendar years, Custom (later).

## 2026-07-07 — Deferred actions, guest checkout stance, admin resume

This section professionalizes and locks the owner-reviewed `deferred-queued-actions-intent-preservation.md` draft.

- **LOCKED — Pending-intent model.** When a guest triggers an account-bound storefront action, the system records one active `pendingIntent` for the guest/session, then redirects to login/signup. The latest pending intent wins; no unbounded queue. Store the intent server-side, keyed to the guest/session token, with a short TTL and a TTL cleanup path. Default TTL: **30 minutes maximum** unless a feature sets a shorter limit. Intent payloads must contain only action type, validated entity ids/options, origin route, created timestamp, and non-sensitive UI context. Rationale: a 15-minute default is marginally safer against stale replay, but server-side storage plus mandatory revalidation keeps the risk low; 30 minutes better covers OTP, signup, and short user interruptions without frustrating legitimate flows.
- **LOCKED — Auth success replay order.** After login/signup, the API first merges the guest cart into the user cart, then suppresses the default post-auth destination, revalidates and replays the pending intent, clears the intent, and returns the user to the correct origin or continuation route. Replay must re-check product status, variant stock, purchase eligibility, review eligibility, coupon validity where applicable, permissions, and ownership before making any write.
- **LOCKED — Failed replay behavior.** If replay validation fails, do not execute the action. Show a user-safe toaster/message and keep the user on the most relevant screen. Examples: unavailable product, out-of-stock variant, expired intent, missing verified purchase, or stale checkout/cart state.

### Storefront intent behavior

- **Wishlist is account-bound and distinct from Save for Later.** Guests can click the wishlist control from product cards, listing/category/search surfaces, PDP, or cart. The guest flow saves a pending intent, sends the user through login/signup, then adds the item to the user's wishlist and returns to the origin with the heart state active. If the product is no longer public/available, show an error and do not add it.
- **Save for Later is separate from Wishlist.** It is cart-adjacent behavior, not a general discovery wishlist. Guests who attempt to save a cart line for later are sent through login/signup; on success the line moves into the user's Save for Later list and the user returns to the cart. If the product or selected variant is unavailable, show a line-level error.
- **Notify Me / Back in Stock is account-bound.** It is available anywhere an end product or selected purchasable variant is displayed out of stock, including PDP, product cards, product lists, category pages, and search results. For simple products the product stock controls the state; for variable products the selected variant controls the state. If the item becomes available before replay, show an informational message instead of creating a stale notification subscription.
- **Reviews require login and verified purchase.** Logged-in verified purchasers see direct review/rating actions. Guests and non-logged-in users see a login-to-review action. After auth, replay checks purchase eligibility before opening or submitting the review flow; if the user has not purchased the item, block with a clear message. **Content + publish policy locked 2026-07-23:** star + text + optional images; **admin moderation before public publish** (see §2026-07-23 Reviews policy).
- **Reorder / Buy Again is not a guest pending-intent case.** Order history and order detail are authenticated surfaces already. These actions should still revalidate current product status, variant availability, and stock when adding items to cart, and should support partial success with a notice when some historical items are unavailable.
- **Save/Add Address is not a guest pending-intent case outside checkout.** Account address screens are authenticated. Checkout address entry resumes through the checkout continuation flow after auth rather than a generic queued action.
- **Clip/save coupon to account is out of scope.** Do not build account-bound coupon clipping unless a future business use case explicitly adds it.
- **Follow brand/category and price-drop subscriptions are out of scope.** Do not build follow-brand, follow-category, or price-drop flows now.
- **Proceed to checkout forces login/signup at launch.** Add to cart remains guest-friendly through the guest cart. From cart, `Proceed to checkout` starts auth if the user is not logged in; after successful login/signup, merge guest cart into the user cart and continue to checkout. Do not implement guest checkout at launch, but keep cart/order ownership fields and contracts compatible with adding guest checkout later without a rewrite.
- **Add to cart never forces login.** Guest cart is a first-class launch behavior. It must work from product surfaces and survive normal browsing through the guest token until login merge or expiry. Out-of-stock products/variants should disable or block add-to-cart before a pending intent is created.
- **Product Q&A does not force login.** Guest users may submit product questions with name and email; logged-in users get name/email prefilled but editable for the question. Public display can show Anonymous while admin retains the real submitted identity. This remains the separate customer Q&A module, not the editorial FAQ module.
- **Track order is deferred at launch; when-built model locked 2026-07-23.** Do not build the public track-order screen or pending-intent behavior now. **When built** (after full order/payment/shipping flow): require **order number + email or phone** verification — never order-number-only. See §2026-07-23 Public track-order lookup.

### Admin resume behavior

- **LOCKED — Admin deep links resume after login.** When an unauthenticated admin opens a protected admin URL, successful login returns to that URL instead of the dashboard.
- **LOCKED — Admin idle lock vs full logout.** Admin inactivity first triggers a **soft screen lock**, not an immediate destructive logout. Default soft-lock threshold: **15 minutes of no user activity** (keyboard, pointer, touch, route interaction, or form input), configurable later. The underlying Angular route/component tree should remain mounted behind the lock overlay, so in-memory form state, conditional fields, selected tabs, expanded sections, table filters, and partially completed workflows remain intact. If the refresh session has also expired or been revoked, fall back to full login and restore only persisted drafts.
- **LOCKED — Session expiry mid-action uses quick resume.** If an admin session expires or idles out while the user is on any admin screen, show a temporary lock/resume screen using the login layout. Display the known user identity as text, not an editable username/email field. Show only the credential method matching the user's preferred quick-resume method: password or PIN (**preferred method chosen via theme form-switch in onboarding + Security Settings — owner-locked 2026-07-23**). On success, restore the admin to the exact screen and in-progress state where possible, refresh CSRF/session cookies, and retry the originally blocked unsafe request only after revalidating permissions and entity version.
- **LOCKED — In-progress admin state preservation.** Preserve draft state for dynamic conditional forms, order flows, purchase invoices, product builders, and similar admin work during idle lock or session refresh. For a simple idle lock in the same tab, preserve exact state by keeping the component mounted behind the lock overlay. For reloads, crashes, route exits, or long-running forms, use feature-owned draft/autosave support. Draft-capable entities should store server-side drafts keyed by user/entity/workflow where practical; avoid storing sensitive admin/order/customer data in long-lived browser storage as the source of truth. If restore is impossible because the entity changed, permissions changed, or the draft is stale, fail closed with a clear message.
- **LOCKED — Dynamic form restore requirements.** Product builders, purchase invoices, order-edit flows, and other conditional forms must serialize enough draft metadata to reconstruct dynamic controls: selected product type, option semantic roles, generated variant matrix inputs, selected add-on groups, conditional measurement fields, current wizard step/tab, validation errors where useful, and unsaved uploaded-media references. Restore must run through the same validation/mapping path as a normal form load, not bypass business rules.
- **LOCKED — RBAC failures are not queued.** If the user lacks permission, return a 403-style blocked state/message. Do not queue, replay, or defer the action.
- **LOCKED — Unsaved-draft protection.** Warn before navigating away from unsaved admin changes. Draft-capable workflows should be resumable.
- **LOCKED — Security on resume.** A resumed admin session must re-check active user status, role/permission version, token version, and session validity. Password/PIN changes, role changes, disabled users, or reuse-detection events must invalidate the quick-resume path.

### Guest cart behavior

- **LOCKED — Guest cart is server-authoritative.** Guest carts are first-class launch behavior and are keyed by an httpOnly, Secure, SameSite `st_guest` cookie containing an opaque random token. The token grants access only to that guest cart; it is not account authority. Store only a hash of the guest token server-side.
- **LOCKED — Guest cart storage.** Persist guest carts in the `carts` collection with `ownerType: guest`, guest token hash, line items, selected variant/options, named add-on selections, measurements/customization values, currency/locale preferences as display context, `createdAt`, `updatedAt`, and `expiresAt`. Product prices, discounts, tax, shipping, and availability are recalculated by the API; cart values are not trusted as final checkout amounts.
- **LOCKED — Guest cart TTL.** Guest cart TTL is **30 days sliding from last activity**. Reading/updating the cart extends `expiresAt`; abandoned guest carts are cleaned up by TTL index/job. This TTL is separate from the 30-minute pending-intent TTL: cart persistence supports normal browsing return behavior, while pending intent is only a short-lived post-login replay instruction.
- **LOCKED — Offline cart interaction.** The browser may keep an IndexedDB/offline queue for PWA offline cart edits, but the server cart remains the source of truth once online. On reconnect, sync pending local mutations to the guest cart, then validate status and inventory line by line.
- **LOCKED — Guest cart validation.** Add-to-cart never forces login, but it must validate product/variant purchasability and stock before adding when online. Cart reads and checkout continuation must revalidate every line: non-public/archived/discontinued products are terminal line errors; active but insufficient-stock lines are adjusted or marked unavailable with clear UI.
- **LOCKED — Guest-to-user cart merge.** On login/signup/OAuth/OTP success, merge the guest cart into the user's cart transactionally before replaying any pending intent or continuing checkout. Merge key: product id + variant id + selected variation options + named add-on selections + measurement/customization signature. Duplicate lines merge quantities subject to current stock. Invalid/unavailable lines are not silently dropped; return line-level notices. After a successful merge, mark/delete the guest cart and rotate/clear the guest token as appropriate.
- **LOCKED — Future guest checkout seam.** Guest checkout is not available at launch, but cart and order contracts must keep an ownership model that can later support `ownerType: guest` checkout without changing cart-line shape or order snapshot semantics.

### Browser-side offline storage

- **LOCKED — IndexedDB is browser-side storage, not infrastructure.** IndexedDB is a standard browser storage API available to normal website visitors and installed PWA users. It is not a cookie and not an additional server database. Refer to it as **browser-side storage**, **local browser cache**, or **offline queue**, not as part of the backend database architecture.
- **LOCKED — MongoDB remains the source of truth.** IndexedDB, Cache Storage, localStorage, and service worker caches must never be authoritative for cart, product, price, stock, account, order, payment, admin, or security state. They may only help the browser continue locally until the API can sync and validate against MongoDB-backed state.
- **LOCKED — Offline cart browser storage.** IndexedDB may store pending offline cart mutations and local cart state while the browser is offline. On reconnect, sync to the API; the API revalidates product status, variant availability, stock, pricing, ownership, and cart merge rules before persisting or merging anything server-side.
- **LOCKED — Offline catalogue browser storage.** Offline catalogue browsing uses two browser storage layers: **Cache Storage/service worker** for app shell, static assets, images, and cacheable HTTP responses; **IndexedDB** for structured public catalogue data such as product summaries, category trees, product detail JSON, and TanStack Query persisted cache. Offline catalogue means showing previously fetched/cached public catalogue data only; it does not guarantee the entire live catalogue is available offline.
- **LOCKED — No sensitive offline storage.** Do not store auth tokens, refresh tokens, payment data, secrets, admin API responses, or account/order PII in IndexedDB, Cache Storage, localStorage, or service worker caches. Public catalogue and local cart mutation data are allowed; account/order/admin data require the network.
- **LOCKED — User-clearable site data.** IndexedDB and Cache Storage are browser site data under `sahatextile.com`; users can clear them through browser site-data controls. The storefront/account privacy UI should also expose **Clear local/offline data on this device** to delete Saha Textile browser-side caches/queues without requiring developer tools.
- **LOCKED — Storage loss is expected.** Private/incognito browsing, browser cleanup, user action, quota pressure, or strict privacy settings may clear IndexedDB/cache data. The app must degrade gracefully, refetch when online, and never assume browser-side storage is durable.

## Reconciliation checklist (to do after PENDING items are confirmed)

1. ✅ Replace live **Atlas M0** guidance in KB/roadmap with the **self-hosted dockerized Mongo (single-node RS + transactions)** plan; update infra/cost sections; update env (Mongo connection to local container). Remaining Atlas/M0 mentions are retained only when explicitly labeled historical/superseded.
2. Add the **cookie-session auth model** to KB §08 (+ note the API refactor) and the granular **cookie-consent/GDPR** component.
3. Add the **admin 6-digit PIN** login, **on-reconnect cart validation (2-stage)**, and **email-OTP-conditional/no-Brevo** notes.
4. Fold the **catalog DB collections, FIFO/COGS, PayPal-commission screen, weekly-insight pipeline, separate order/payment/shipment/return/refund + transactions** into KB §data-model / roadmap.
5. ✅ File renamed to **`codex-faq-architecture-and-admin-plan.md`**; recast its content as the **FAQ** plan; add the new **customer Q&A** spec.
6. ✅ Reflect the confirmed **Q3/Q4/Q5/Q7/Q8** answers in the data model + admin/search plan (2026-07-04 reconciliation pass).

## Storefront i18n + error/status pages (2026-07-17)

- **LOCKED — 404, 500, and Maintenance pages are Machine-1 (Transloco keys), not admin-editable.** Their copy is static and rarely changes, so it lives in the per-language Transloco JSON files (`apps/storefront/public/assets/i18n/<lang>.json`), not in admin-editable CMS slots. The earlier CMS-slot approach (`error_page` in `site-config.json`; `maintenance` title/description in `setting.json`) is retired on the storefront: 404 + maintenance page text moved to Transloco keys. The `setting.maintenance.maintenance_mode` flag and background image remain — the auth interceptor uses the flag to route to `/maintenance`.
- **LOCKED — English is primary; more languages are added as needed.** Bengali (`bn`) in the KB is only an illustrative example target and will most likely be the first language added right after go-live. The storefront currently ships `en` + `fr`. Do not treat any specific fr↔bn pairing as a required "mismatch" to reconcile; i18n structures are keyed by language code so new languages drop in without rework.
- **LOCKED — Code-file (TS-origin) static strings use the reactive pattern ("Option A").** Static labels set in component `.ts` (e.g. breadcrumb titles) are stored as Transloco keys and resolved via `TranslocoService.selectTranslate(...)` so they re-translate on runtime language switch. Dynamic data (customer names, product/category titles) is still rendered raw and never piped through Transloco. Applied via the `translatedBreadcrumb()` helper (`apps/storefront/src/app/shared/util/breadcrumb-i18n.ts`) to the auth pages **and** the non-auth static pages (cart, wishlist, compare, checkout, collection, search, contact-us, about-us, offer, faq). Genuinely dynamic breadcrumbs (product, blog, blog-details, CMS static-page) are intentionally left mutating their own title and are NOT converted.
- **Pass 2 — admin app (2026-07-17):**
    - (a) ✅ **DONE** — admin i18n migrated from `ngx-translate` to Transloco to match the storefront stack. Mirrors storefront: `provideTransloco({ availableLangs: ['en','fr'], defaultLang: 'en', … })` + a client-only `TranslocoHttpLoader` at `apps/admin/src/app/core/i18n/transloco-loader.ts` (loads `/assets/i18n/<lang>.json`). `@ngx-translate/core` + `@ngx-translate/http-loader` removed from `apps/admin/package.json` (replaced by `@jsverse/transloco`). All templates: `| translate` → `| transloco`; all components: `TranslateModule` → `TranslocoModule`; `TranslateService.use()` → `TranslocoService.setActiveLang()` (in `app.ts` + the `languages` switcher). Existing `assets/i18n/{en,fr}.json` reused unchanged. Verified: typecheck + AOT build clean, dev server on :4300, browser render shows real labels (no raw keys).
    - (b) ✅ **DONE** — `image_tile` and `radio_bar` (from the storefront `DisplayStyle` union in `product-detail.interface.ts`) added to the attribute display-style dropdown (`variantStyle` in `apps/admin/src/app/features/attribute/form-attribute/form-attribute.ts`). Stored **values** stay `image_tile` / `radio_bar`; the admin-facing **labels** are **"Image V2"** and **"Radio Bar"** (no underscores in the UI).
    - (c) ✅ **DONE (2026-07-18)** — retired the now-unused admin error-page/maintenance content forms. Theme Options: the entire **"404 Error Page"** nav tab + `error_page` FormGroup/patch + `IErrorPage` interface + `error_page` mock JSON removed. Settings → Maintenance: dropped the **title** and **description** text fields (FormControls, template inputs, `IMaintenance` members, and mock JSON), keeping only the **maintenance-mode toggle + background image**. Dead error-page i18n keys removed from admin `en`/`fr` (both back to 787 keys, in parity). The admin's own `errors/error404` route (shown when an admin URL doesn't match) is unrelated and left intact. Verified: typecheck + AOT build clean.
- **PENDING (API/DB phase):** wire a real server-error interceptor that routes users to `/500` on backend/SSR 5xx errors (see `codex-api-app-build-instructional-prompt.md`). The `/500` page itself is built now; nothing auto-navigates to it yet.

## i18n architecture — "Machine 1 vs Machine 2" split (LOCKED 2026-07-18)

**One source of truth: the locale in the URL** (`core/i18n/locale.ts` seam). Both translation systems key off it, so a language switch drives both in lockstep.

- **Machine 1 — UI chrome → Transloco keys.** Fixed, developer/translator-owned labels that exist regardless of catalog content. Stored in the shipped per-language JSON (`apps/storefront/public/assets/i18n/<lang>.json`), consumed via the `| transloco` pipe / `TranslocoService.selectTranslate` (or the `translatedBreadcrumb()` helper for TS-origin labels). Examples: buttons, headings, breadcrumb titles, validation/empty-state text, and **general one-time navigation/section chrome** such as `Customer Service`, `Help Center`, `Authentication`, `Popular Categories`, `Popular Tags`, `Overall Rating`, `Product Review`.
- **Machine 2 — catalog/CMS content → DB-localized, rendered RAW (never Transloco).** Everything the shop admin authors/edits. Future storage = MongoDB localized fields (e.g. `name: { en, fr, bn }`); the **API resolves to the URL locale server-side and returns plain strings** the client renders raw (optional `| localize` pipe only if we later choose to ship full localized maps). Interim (pre-API, English-only mock JSON): **render raw — do NOT pipe through Transloco.** Piping catalog data through Transloco is banned (it can never be complete, pollutes `en.json`, and spams `Missing translation` warnings, destroying the §7 QA signal).
- **LOCKED — Decision 1: attribute/option-group labels, option/term VALUES, and all sizing/measurement fields are ALWAYS Machine 2.** e.g. category/tag names, product names/descriptions, attribute names, `Blouse Design` / `Petticoat Size` group labels, term values like `Green` / `Maroon / Zari` / `M` / `Design 1` / `Unstitched Piece`. None of these are Transloco keys.
- **LOCKED — Sizing/measurement is NOT a standard fixed set (owner-informed).** Do **not** hardcode the same 4 measurement fields (`Chest/Shoulder/Waist/Sleeve`) everywhere. Sizing/measurement will most likely be modeled as **its own reusable entities (akin to "variation-axis definitions")**, defined once, then **pulled into product/service setup only where relevant**, and **retrieved for PDP display from data** (per product/service) — not a static template constant. Because they are data-driven and admin-scoped, measurement labels are Machine 2 (rendered raw / DB-localized), never Transloco keys.
- **LOCKED — Decision 2: the mega-menu + footer navigation are developer-owned → Machine 1.** Their labels (from `shared/data/menu.ts` / `layout/footer/...`) are keyed in `en/fr.json`, not admin-editable. (Revisit only if an admin-managed CMS menu is ever introduced.)
- **Task C (i18n sanity sweep) — storefront-general portion DONE (2026-07-18).** Applied:
    - (1) ✅ Machine-1 keys added for general chrome + mega-menu + footer. The mega-menu data (`shared/data/menu.ts`) and footer (`layout/footer/basic-footer/basic-footer.html`) had literal display strings piped through `| transloco` (which warn because keys are snake_case). Converted to keys: `Customer Service→customer_service`, `Help Center→help_center`, `Authentication→authentication` (existing key), `Popular Categories→popular_categories`, `Popular Tags→popular_tags`, `Product Review→product_review`, `Overall Rating→overall_rating` (`widgets/product-review`), `Edit review→edit_review`, and the demo category/tag names (`Vegetables & Fruits→vegetables_fruits`, `Biscuits & Snacks→biscuits_snacks`, `Daily Breakfast→daily_breakfast`, `Trendy Fashion→trendy_fashion`, `Furniture & Decore→furniture_decore`, `Beauty Products→beauty_products`, `Electronics & Accessories→electronics_accessories`, `Pet Shop→pet_shop`, `Milk & Dairy Products→milk_dairy_products`, `Sports→sports`). New keys added to `en/fr.json` (now 542/542, full parity; also mirrored 4 pre-existing en-only keys `variation`/`configure`/`edit_configuration`/`update_cart` into `fr`). Fixed a stray corrupted label `'Payment ISiteConfig'` → `payment_method` in the refund modal.
    - (2) ✅ No Machine-2 un-piping needed in the general scope — the footer widgets already render admin data raw (`categories.name` raw; footer links use `| titleCase`). The only remaining piped data lives in the PDP configurator.
    - (3) ⏳ **PENDING (PDP session):** the remaining ~13 distinct warnings (`Chest`/`Shoulder`/`Waist`/`Sleeve`, `Green`/`M`/`Maroon / Zari`/`Design 1`, `Blouse Design`/`Petticoat Size`, …) all originate in `shared/ui/product-config/parts/*` + `cart-line-config` and are owned by the PDP build session — see `claude-code-pdp-i18n-reconciliation-handoff.md`. Verified: storefront typecheck clean, `eslint` 0 errors (2 pre-existing prettier warnings remain in the PDP-owned `product-configurator.ts`, intentionally left for that session), SSR home + collections render 200 with **zero** general-chrome missing-translation warnings.

## 2026-07-18 — Storefront / admin video (YouTube rails + Spaces HLS VOD)

Context: Saha Textile needs (1) automatic “latest N” videos from the brand YouTube channel on selected storefront surfaces, and (2) admin-uploaded product/informational videos on DigitalOcean Spaces with YouTube-like quality selection. Fastkart’s storefront has **no** video player to port.

> **Supersedes** the earlier same-day progressive-MP4-only / “no HLS at launch” bullets. Those are void. Authoritative pipeline = **master MP4 upload → BullMQ + ffmpeg HLS → delete master → Vidstack HLS**.

### Player & hexagonal boundaries

- **LOCKED — Player = Vidstack Player.** One programmable chrome for YouTube embeds and self-hosted HLS. Angular path = web components + Vite. Prefer Default Layout or Plyr Layout first; custom Saha Textile chrome later if needed. No dual-UI (different chrome for YouTube vs Spaces).
- **LOCKED — Hexagonal / swappable.** Core never imports Vidstack, ffmpeg, BullMQ, or the Spaces SDK. Ports:
    - `YouTubePort` (channel-feed discovery)
    - `StoragePort` (presign, put/delete object keys, CDN URL resolution)
    - `VideoTranscodePort` (enqueue / run encode; adapter = ffmpeg worker)
    - Job queue adapter (BullMQ) sits at the edge — use-cases enqueue via a narrow job/port seam, not by importing BullMQ in core.
- **LOCKED — UI wrapper.** Thin `app-media-player` (storefront/admin or `packages/ui`) maps our playback DTO → Vidstack. Swap player later = new UI adapter + same DTOs.

### YouTube channel “latest N” feed

- **LOCKED — Discovery = YouTube Data API v3** behind `YouTubePort` (not RSS; not storefront→Google). Resolve uploads playlist id via `channels.list` once (cache indefinitely); fetch latest via `playlistItems.list` with `maxResults` = 5 or 10 (**1 quota unit/call**). Do **not** use `search.list`.
- **LOCKED — Cache:** persist latest 5–10 DTOs server-side; **refresh once daily at 00:00 IST (Asia/Kolkata)**. Storefront reads only our API. Optional admin force-refresh later.
- **Quota note:** Data API v3 is **$0**; default **10,000 units/day** (reset midnight PT). Daily playlist fetch ≈ **1 unit/day** — negligible.

### Admin → Spaces upload (master)

- **LOCKED — Master upload format = MP4 (H.264 + AAC).** Admin never uploads WebM/AV1 as the primary master. Masters are **≥1080p** when video is offered (1080 / 1440 / 2160 as source).
- **LOCKED — Direct-to-Spaces upload.** API creates a `mediaAssets` row + **presigned PUT**; browser uploads bytes **directly to Spaces (SGP)**. API does **not** proxy multi‑GB bodies. Mongo stores metadata only.
- **LOCKED — Asset status machine:** `uploading` → `processing` → `ready` | `failed`. Playable only when `ready`.

### Transcode pipeline (BullMQ + ffmpeg)

- **LOCKED — Queue = BullMQ** for video (and the general pattern for other heavy async jobs). Broker = **Redis** (self-hosted Docker Redis on the droplet / local Docker Compose — not a cloud Redis tax at launch). API enqueues; a worker process consumes.
- **LOCKED — Encoder = free ffmpeg** (binary in the worker image). No paid transcode SaaS at launch. Node only shells/orchestrates; ffmpeg does the encode. Swappable later via `VideoTranscodePort` (e.g. Mux) without touching catalog/UI.
- **LOCKED — Output = HLS** (master `.m3u8` + per-rendition playlists/segments) under a per-asset Spaces prefix. Playback = Vidstack **HLS** provider against `playback.masterPlaylistUrl` (CDN/public URL).
- **LOCKED — Fixed rendition ladder (storage-conscious):**
    - Always encode: **480p + 720p + 1080p**.
    - If master is **1440p (2K):** also encode **1440p**.
    - If master is **2160p (4K):** also encode **2160p** streaming rung; **skip 1440p** (no 2K slab on 4K masters).
    - Do **not** encode 144p / 240p / 360p.
- **LOCKED — Delete master after successful transcode.** On `ready`, remove the master object from **hot Spaces**. Do not keep the fat 2K/4K upload alongside the ladder. (Optional cold-archive later is a separate decision; default = delete.)
- **LOCKED — Default player quality:** prefer **720p** when present, else **1080p** / next available; user may change via Vidstack quality menu (ABR “auto” allowed). Bitrate targets are encode-time presets per rung — not a separate bitrate slider in the UI.
- **LOCKED — YouTube playback quality** comes from YouTube’s own ladder via the Vidstack YouTube provider; we do not host those renditions.

### Data model & reuse (media gallery)

- **LOCKED — First-class reusable `mediaAssets`.** One logical video = one `mediaAssetId`. Admin media gallery shows **one card** per asset (poster + title + status). Products, CMS blocks, home rails, etc. store **references only** (`mediaAssetId` + role/sortOrder) — never embed ladder paths in the product document.
- **LOCKED — Same asset, many products.** Linking an already-transcoded video from the gallery to another product adds another reference to the **same** `mediaAssetId`. No second upload, no second encode, no Spaces duplication.
- **LOCKED — Playback DTO** (API → apps) exposes roughly: `masterPlaylistUrl`, `posterUrl`, `durationSec`, `renditions[{ height, … }]`, `status`. Segment keys stay storage-internal; UI/player only need the master playlist URL.
- **LOCKED — Spaces layout (convention):** `videos/{mediaAssetId}/master/` (ephemeral) + `videos/{mediaAssetId}/hls/master.m3u8` + `…/hls/{480p|720p|1080p|1440p|2160p}/`.

### Explicitly out of scope / rejected for this pipeline

- Progressive-only multi-MP4 ladder as the primary path (superseded).
- Client-side “invent 144p–4K from one file” (impossible / rejected).
- API proxying of video bytes for normal browsing.
- Paid transcode SaaS at launch.

## 2026-07-18 — Images (Spaces + sharp + admin product image UX)

Context: companion to the video pipeline. Same `mediaAssets` / gallery reuse / BullMQ worker family. Pixel sizes of ladder rungs are **PENDING** until the owner supplies final dimensions after UI audit; rung _names/roles_ below are locked.

### Ingest & derivatives

- **LOCKED — Upload formats:** admin uploads **JPEG/JPG** (photos) or **PNG** (transparency). High-quality WebP also accepted later if needed; launch UX targets JPEG/PNG.
- **LOCKED — Retain original + full-res WebP + ladder.** After ingest, Spaces keeps: (1) the **original** upload bytes (JPEG/PNG as uploaded), (2) a **full-resolution WebP** transcode of that master (same pixel dimensions, web-optimized), (3) the **static derivative ladder** (all WebP). This supersedes the earlier “no fat original / zoom-only” suggestion for images.
- **LOCKED — Processor = sharp (libvips)** via BullMQ job `image.derivatives` on the **same worker image** as ffmpeg (`video.hls`). No AVIF now or for the next ~2 years. No JPEG derivative fallback required at launch (WebP-only derivatives + original kept).
- **LOCKED — Ladder is static in code/config** (not per-upload, not an admin “ladder presets” screen). Every ready image always has every rung available so any future surface can pick by role. Exact px values **PENDING owner definition**. Locked rung **roles**:
    - `thumb`, `card`, `gallery`, `zoom`
    - `swatch_image` — size for displayStyle **`image_swatch`** (admin label “Image”)
    - `swatch_image_v2` — size for displayStyle **`image_tile`** (admin label “Image V2”)
- **LOCKED — No separate swatch upload pipeline.** Swatch pixels come from the ladder rungs above. If a swatch needs a **different crop/content** than the gallery shot, that is a **different `mediaAsset`** (still runs through the same ladder), not a crop tool at launch.
- **LOCKED — Alt + SEO fields at upload (all active locales).** Upload cannot proceed until **every currently supported storefront/admin locale** has required alt (and any other required per-asset SEO fields) filled. No “English-only + warn for the rest.” Machine 2 — stored on `mediaAssets` as localized maps, **not** Transloco JSON. Fallback/cleanup = asset lifecycle (soft-delete + GC), not translation-file pruning.
- **LOCKED — Orphans:** soft-delete; GC Spaces + Mongo when `usage[]` empty after a grace period.
- **LOCKED — Presigned direct-to-Spaces**; API does not proxy image bytes for browsing.

### Product admin image section UX (simple vs compound)

- **LOCKED — Mode toggle on the product image section:** **Simple image** ↔ **Compound image** (switcher).
- **LOCKED — Compound matrix = full Cartesian** of all `variation_axis` rows — **same combination set as Inventory** (theme `generateCombinations` behaviour). Not “image-axes only.”
- **LOCKED — Listing/card primary when compound:** use the **default/base variant row’s sequence-`1` image**; if that row has no images, fall back to the first active variation row that has a `#1`.
- **LOCKED — Toggle Simple ↔ Compound = park (soft-keep), not destroy.** Confirm dialog. The newly selected mode starts with a **clear form** for editing. The previously active mode’s bindings are **parked** (retained server-side / in draft) and restored into the form if the admin toggles back — so backup shape/data remains available. Active mode is the only one published/served.
- **LOCKED — Simple mode:** one attachment list for the product. From the media library, each pick shows the existing on-page thumbnail preview and **auto-assigns** the next sequence number (`1, 2, 3…`). **Cross/remove** on a preview removes that attachment and **decrements** all higher numbers so the list stays contiguous `1…N`. Editable numbers: **uniqueness per list** (no two images share a number in the same simple list or the same compound row). Ceiling = current image count (with 6 images you cannot enter `7`). To **swap** two positions, clear both numbers first, then enter the new values (or rely on remove/re-add). After any valid edit, sequence stays a permutation of `1…N`. **`1` = primary** — first carousel slide, product-card image, listing thumbnail, and swatch source when that list feeds an image-styled axis. **No “mark as primary” checkbox.**
- **LOCKED — Compound mode:** one ordered image list **per inventory variation row** (full Cartesian). Same numbering / remove / uniqueness / `#1` rules **per row**. Axes with `displayStyle` `image_swatch` / `image_tile` use that combination row’s `#1` + ladder rung `swatch_image` / `swatch_image_v2` for the swatch chrome.
- **LOCKED — Named add-on image lists (not inventory, but carousel).** Groups like `Blouse Design` (`named_add_on`) do **not** create inventory SKU rows, but **each add-on term** (Design 1, Design 2, …) may have its **own ordered image list** (same numbering rules). Storefront: when the customer selects a variation or add-on term that has images, the PDP carousel **smooth-scrolls to that term’s `#1`** if not already on it — prefer the theme’s existing variation→carousel behaviour; no bespoke scroll library. Display style for the add-on control may be Image / Image V2 / radio / radio bar / dropdown — unrelated to whether the term has a gallery.
- **LOCKED — Sequence / sort order lives on the attachment**, never on the shared `mediaAssets` row: `{ mediaAssetId, sortOrder }` under product simple list, variation row, or named-add-on term. Same library asset can be `#1` on one product and `#3` on another without conflict.
- **LOCKED — Variation-axis display order = admin add order.** When attaching `variation_axis` options on the product, the **order they are added** is persisted and is the **PDP top-to-bottom** render order of those option groups. Same order defines **visual hierarchy** among image-containing axes (`image_swatch` / `image_tile`): the **first (top) image-containing variation axis** is the **primary visual axis**.
- **LOCKED — Initial PDP carousel vs clicks (multi image-axis).** Carousel content is always the **currently selected inventory combination row’s** ordered attachment list (full Cartesian). On first paint, the default/base combination is selected and its gallery loads; the primary visual axis (top image-containing axis in add-order) is the hierarchy leader for default visual emphasis. **Explicit customer clicks** on any image-associated variation term or named-add-on term may change the selection and/or **smooth-scroll the carousel to that context’s `#1`** (theme-like; no custom scroll library). Named add-on groups are outside the variation-axis stack but still jump the carousel on select.
- **DEFERRED — Exact ladder px** for `thumb` / `card` / `gallery` / `zoom` / `swatch_image` / `swatch_image_v2`. Not required for API/DB attachment shape. **Must be raised when building** the sharp `image.derivatives` worker, storefront `srcset`/swatch renderers, or any feature that hard-codes those dimensions — until then treat rung **roles** as locked and px as TBD.
- **DEFERRED — Ingest caps** (max upload MB / max long-edge). Ceiling validation only; does **not** change API/DB schema. **Must be raised when building** the presigned upload / media ingest UI and worker accept path.## 2026-07-18 — New language introduction checklist (dev UX)

- **LOCKED — Language setup / addition screen must include a developer checklist** (checkboxes at minimum) enumerating every translation surface that must be completed before a new locale is considered live. Checklist grows as the system grows; seed items include at least:
    1. **Build-bundled / compile-time i18n** (if any remain).
    2. **Static frontend JSON** (e.g. Transloco `assets/i18n/<lang>.json` for storefront + admin — Machine 1).
    3. **Dynamic catalog/CMS localized fields** (products, categories, tags, attributes/options, FAQs, static pages, banners, **media alt/SEO**, etc. — Machine 2).
    4. **Any compounding/merged JSON or API locale payloads** used by storefront/admin.
    5. **Email/notification templates** and other server-rendered copy as those ship.
    6. **SEO defaults** (title/description patterns, hreflang entries).
- Purpose: prevent “half-translated” launches when a language is added years into the project. Exact UI lives in admin (or developer portal) when that screen is built; this lock is the requirement.

## 2026-07-18 — Developer portal API reference

- **LOCKED — Scalar API Reference replaces Swagger UI + Redoc in the developer portal.** The NestJS API still generates the authoritative OpenAPI document at `/openapi.json` (using `@nestjs/swagger` where appropriate), but the human-facing portal exposes one modern Scalar surface for both reference reading and approved interactive requests.
- **LOCKED — Portal route:** `/api/reference` hosts Scalar; `/api/openapi.json` exposes the machine-readable contract. Do not maintain parallel Swagger UI, Redoc, or a separate `/api/console` surface.
- **LOCKED — Environment/security boundary:** interactive requests target approved development/staging environments only. Scalar must not embed secrets, weaken cookie/CSRF/auth/RBAC/rate-limit controls, or make an unprotected production console available. In production the reference is disabled or protected together with the private developer portal.
- **DEFERRED IMPLEMENTATION:** do not install or wire Scalar until the API produces a real OpenAPI document. Current portal pages may show an explicitly labelled planned placeholder only.

## 2026-07-18 — Developer portal visual baseline

- **LOCKED — Scalar-faithful portal shell:** the private Docusaurus portal reproduces the dated Scalar documentation interface captured in `developer-portal-scalar-visual-baseline.md`, including its dark-first shell geometry, compact technical density, typography, navigation rails, surface treatments and responsive behaviour.
- **LOCKED — Saha Textile-owned identity:** Saha Textile branding, content and routes replace Scalar branding. Scalar logos, wordmarks and proprietary brand artwork are not copied.
- **LOCKED — implementation freedom for fidelity:** reuse/adapt MIT-licensed Scalar source with required notices where useful; otherwise use Docusaurus React theme wrappers, scoped CSS and custom components. Tailwind/shadcn-style primitives are permitted when they materially improve fidelity, but are not mandatory dependencies.
- **LOCKED — dated target:** the 2026-07-18 capture is the visual acceptance baseline. A future Scalar redesign requires an explicit owner decision before the portal follows it.

## 2026-07-18 — Developer portal Pass 1 governance foundation

- **LOCKED — lifecycle vocabulary:** every portal page uses exactly one of `implemented`, `scaffolded`, `planned`, `deferred`, or `deprecated`. These states describe evidence relative to implementation and are not progress percentages.
- **LOCKED — required provenance:** every human-authored portal page declares audience, ISO verification date, and repository source-of-truth paths. The portal renders these values next to the page title and pre-build validation rejects missing metadata.
- **LOCKED — audience entry points:** the foundation maintains separate beginner, frontend, backend, and operator onboarding paths under one Docusaurus umbrella.
- **LOCKED — authority boundary:** owner decisions govern locked intent; tested code/runtime govern current behaviour; contracts/OpenAPI govern HTTP shapes; adapter models/indexes govern persistence shapes; the portal is a derived maintained view and must expose disagreements instead of silently choosing one.
- **LOCKED — backend honesty:** current NestJS/OpenAPI and Mongo-adapter code is `scaffolded`, not “not started.” The Scalar portal integration and generated database catalogue are `deferred` until their recorded integration/generation triggers are satisfied. The transitional framework API UI is `deprecated` and must not become a parallel long-term documentation surface.
- **LOCKED — validation boundary:** portal builds validate lifecycle metadata, provenance metadata, verification dates, and the forbidden vendor-name boundary before Docusaurus compilation.

## 2026-07-18 — Developer portal Pass 2 frontend atlas

- **LOCKED — frontend documentation is code-evidence-first:** a routed or visually complete screen is not described as operational when its read, write or security boundary remains mocked or disconnected.
- **LOCKED — separate application atlases:** storefront customer/SSR concerns and admin operator/SPA concerns remain distinct while sharing state, contract and quality guidance where appropriate.
- **LOCKED — lifecycle cards expose evidence:** interactive atlas entries include implementation status, runtime, data boundary, caution text and source paths.
- **LOCKED — current implementation gaps stay explicit:** mixed catalogue sources, client-only cart behavior, unconnected checkout/auth writes, the `en/fr` versus locked `en/bn` mismatch, absent PWA wiring, admin mock mutations and minimal tests are not hidden.
- **LOCKED — UI permissions are never authorization:** guards, menus and directives improve presentation; the API must authorize actor, action and resource.
- **LOCKED — shared foundations are documented only when present:** `packages/contracts` is real; a repository-level `packages/ui` implementation is not claimed.
- **LOCKED — frontend state ownership is decision-based:** TanStack Query owns server state, SignalStore/local signals own compact browser/UI state, and classic NgRx is reserved for heavily mutated client workflows.
- **LOCKED — backend generated surfaces remain later work:** Scalar API reference and generated database catalogue work do not advance during Pass 2.

## 2026-07-18 — Developer portal Pass 3 commerce journeys

- **LOCKED — every journey has three evidence lenses:** current code, locked target and failure recovery remain visibly separate.
- **LOCKED — a surface is not an end-to-end flow:** routes, UI, controllers, ports, contracts and collections advance only the lifecycle boundary they actually implement.
- **LOCKED — commerce invariants are prominent:** INR is canonical, Angular does not own final totals, server revalidation precedes payment, guest checkout is unavailable at launch, guest-cart merge precedes pending-intent replay, and orders snapshot purchased facts.
- **LOCKED — separate operational lifecycles:** order, payment, shipment, return, refund and notification state are documented separately and linked through durable identifiers.
- **LOCKED — failure recovery is first-class documentation:** every critical journey explains corrections, idempotency, ownership, authorization, safe retries and audit evidence.
- **LOCKED — current gaps remain explicit:** static checkout totals, stub place-order navigation, transitional bearer/demo auth, absent provider adapters, absent `NotificationPort` and deferred public tracking are not presented as operational.
- **LOCKED — journey interaction is accessible:** journey-area and lifecycle-status filters use pressed state, evidence lenses implement keyboard tab behavior, and the journey timeline reflows vertically on mobile.
- **LOCKED — Pass 3 is documentation-only:** no API, database or provider implementation is implied or authorized by this pass.

## 2026-07-18 — Developer portal Pass 4 backend platform atlas

- **LOCKED — backend documentation is request-path evidence-first:** a controller, service, port, model or OpenAPI operation is not described as production-capable without its authentication, authorization, validation, invariant, transaction, response-safety and verification boundaries.
- **LOCKED — public visibility is server-enforced:** storefront callers never select draft/archived visibility, and public catalogue/search responses use explicit public-safe policies.
- **LOCKED — authentication is not object authorization:** every cart, order, user and other owned-resource operation proves actor-to-resource ownership or an explicit privileged permission.
- **LOCKED — transport/domain/persistence/response shapes remain distinct:** persistence documents and secret/internal fields never leak through shared/public responses; actor-specific DTOs are allowlists.
- **LOCKED — adapters contain edge details:** provider SDKs, Mongoose sessions/documents and provider payloads stay outside core/application contracts; composition is the binding boundary.
- **LOCKED — atomicity and proof are visible:** workflows spanning several durable facts identify their unit-of-work/idempotency boundary and require replica-set rollback/replay tests before becoming implemented.
- **LOCKED — liveness is not readiness:** a running process is documented separately from Mongo/search/provider readiness and deployment promotion evidence.
- **LOCKED — generated surfaces remain honest:** OpenAPI is machine truth; Scalar stays deferred until completeness/security triggers pass; the database catalogue stays deferred until deterministic generation from stable explicit schemas/indexes/mappings is possible.
- **LOCKED — current security/data gaps stay explicit:** public-status leakage, missing cart/order ownership, non-transactional order placement, bearer browser auth, development secret defaults, absent readiness, regex search, stale hosted-Mongo assumptions and skipped/missing backend tests are not hidden.
- **RECONCILIATION GATE — core dependency direction:** before expanding backend Phase B, resolve the constitution's “core depends on nothing external” rule against current core imports from `packages/contracts`; do not spread the ambiguity silently.
- **LOCKED — Pass 4 is documentation-only:** no API, database, auth, search or provider implementation is implied or authorized by this pass.

## 2026-07-23 — Launch payment methods

- **LOCKED — Online payments only at launch. No COD.** Cash on delivery is **out of scope for now** (no COD UI, no COD order path, no COD caps). Revisit only via an explicit future owner decision.
- **LOCKED — No manual UPI / screenshot proof flow at launch.** Gateway checkout only.
- **LOCKED — No split/partial payments at launch.**
- **LOCKED — Gateway *policy* by currency (product/ops choice, not code branching on vendor):**
    - **INR → Indian online gateway slot** (ops preference today: CCAvenue; planned successor preference: Razorpay).
    - **Any non-INR currency → PayPal only.**
- **LOCKED — Hexagonal swap rule (non-negotiable):** naming CCAvenue vs Razorpay is an **ops / DI binding** choice only. **`core-domain`, use-cases, Zod contracts, Angular storefront/admin checkout, and order/payment state machines must depend solely on `PaymentGatewayPort`** (and currency → gateway-*role* selection). They must **never** import vendor SDKs, encrypt/sign CCAvenue payloads, call Razorpay APIs, or branch business logic on “is CCAvenue / is Razorpay.” Swapping INR providers = **new adapter in `adapters-payments` + one NestJS DI binding** — same swappability test as Mongo→Postgres. If a feature force-touches core/UI to change INR vendor, the layering is wrong: stop and flag it.
- **LOCKED — FX + PayPal gross-up** remain as already documented in the technical KB (§multi-currency / PayPal `G = (N + f)/(1 − p)` with admin-editable `%` + fixed fee per currency; INR path factor = 1, no PayPal markup). Canonical catalog price stays **INR**. Markup/FX math is **gateway-role** aware (INR online vs PayPal foreign), not vendor-name aware.
- **LOCKED — Planned INR adapter succession preference: CCAvenue → Razorpay** (timing: during development or after go-live — owner call). Prefer building the port + stub first; wire whichever INR adapter has credentials; add the other adapter later without rewriting checkout.
- **LOCKED — Seams first:** real provider SDK wiring only after live/sandbox credentials; ports + stub/sandbox adapters ship first (existing API build policy).

## 2026-07-23 — Manual stock adjustment reason codes

- **LOCKED — Option A: fixed taxonomy + notes** for every **manual** inventory adjustment outside purchase-invoice receive and normal order reserve/release/fulfill flows. Not free-text-only; not codes-without-notes.
- **LOCKED — Required `reasonCode` enum** (stable codes; expand only via deliberate product change):
    1. `damage`
    2. `lost_missing`
    3. `manual_recount_correction`
    4. `supplier_shortage`
    5. `return_restocked`
    6. `return_not_restocked`
    7. `internal_use_sample`
    8. `photoshoot_display_use`
    9. `system_migration_correction`
    10. `other`
- **LOCKED — Notes field:** optional for codes 1–9; **mandatory when `reasonCode = other`.** Persist on the ledger row with actor + timestamp for audit/reporting.
- **LOCKED — Scope:** applies to admin manual quantity deltas written to `inventoryLedger` (and any linked cost-layer / stock mutations those adjustments trigger). Automated ledger types (`order_reserved`, `order_released`, `order_fulfilled`, etc.) keep their own typed provenance and do **not** require this manual reason taxonomy.
- **LOCKED — Not a warehouse WMS.** Reason codes support boutique audit/COGS hygiene only — no multi-location warehouse complexity.

## 2026-07-23 — Reviews policy

- **LOCKED — Option A: verified purchase + moderation.** Completes the earlier (2026-07-07) eligibility lock with content and publish rules.
- **LOCKED — Who may submit:** logged-in customer with a **verified purchase** of that product. Guests see login-to-review; post-auth replay re-checks purchase eligibility before open/submit. Non-purchasers are blocked with a clear message.
- **LOCKED — Content shape:** required **star rating** + **text**; **optional images**. Not anyone-can-review; not verified-purchase auto-publish.
- **LOCKED — Moderation:** submissions land in an **admin queue**; public PDP / listing aggregates show only **approved** reviews. Pending/rejected never affect storefront ratings or SEO review schema.
- **LOCKED — Aggregates:** recompute `ratingAverage` / `ratingCount` / rating buckets from **published verified** reviews only (not live unfiltered scans).
- **LOCKED — Admin surface:** moderation queue (approve/reject/hide) required when the reviews feature is built; report/hide tooling for auto-publish paths is **not** the launch model because auto-publish is rejected.

## 2026-07-23 — Public track-order lookup

- **LOCKED — Option A: defer at launch; later verify with order number + email/phone.** Completes the earlier (2026-07-07) “track order is deferred” bullet with the **when-built** verification model.
- **LOCKED — Not at launch:** no public `/track-order` (or equivalent) page, API, or pending-intent flow. Launch tracking for customers = **authenticated account order history** (+ support channel). Build only after order/payment/**shipping status** lifecycles exist.
- **LOCKED — When built:** lookup requires **order number AND** a matching **email or phone** on the order (exact match policy at API). **Reject order-number-only** public lookup (guessable/shareable). Rate-limit + generic “not found” responses (anti-enumeration). Return a **minimal tracking DTO** (status timeline / carrier refs as appropriate) — not full address book dump, payment instrument details, or admin-only fields.
- **LOCKED — Guest-checkout seam:** verification shape stays compatible with future guest orders (no account required for lookup) without forcing “authenticated-only forever.” Authenticated users may still use account order history as the primary path.
- **LOCKED — No pending-intent for track-order at launch** (nothing to replay). When the feature ships, public lookup is a direct form → verified API read, not a guest intent queue.

## 2026-07-23 — Audit logging scope and retention

- **LOCKED — Option A: broad admin/security audit** with tiered retention. Not “sensitive modules only.” Not unbounded forever retention without policy.
- **LOCKED — Default floor:** every **admin mutating** API write creates an `auditLogs` row (actor, action, entityType, entityId, timestamp, important diffs). Explicit launch coverage includes at least: catalog (product/category/facet/SEO), pricing/MRP/sale, stock/inventory adjustments, purchase invoice post/void, order status, payment/refund state, shipping/tax/gateway/currency/PayPal-commission/notification-channel config, role/permission/user-admin changes, admin login failures/lockouts, session revocation/reuse-detection, and relevant admin draft-restore conflicts.
- **LOCKED — Retention defaults:**
    - Financial / security audit: **7 years** (accountant may lengthen; do not silently shorten without owner/accountant decision).
    - Catalog / general admin mutation audit: **5 years**.
    - Raw analytics events (separate from `auditLogs`): **90 days** after aggregate rollup, then TTL/delete or cold-archive.
- **LOCKED — Redaction:** never persist secrets, passwords, full session/refresh tokens, card PAN/CVV, gateway Working Keys, or similar in audit payloads. Prefer field-level diffs over huge before/after documents; compact/cold-archive when disk or retention policy requires.
- **LOCKED — Viewer:** admin audit log list/filter (`GET /admin/audit-logs`) is in scope when auth/admin hardening lands — high-privilege RBAC.
- **LOCKED — Distinction:** `auditLogs` ≠ raw `analyticsEvents`. Analytics stay short-lived after rollup; audit stays long-lived per tiers above.

## 2026-07-23 — Admin PIN UX, setup, reset, and lockout

- **LOCKED — Option A expanded (owner):** PIN is managed from authenticated **Security Settings after password proof**, and is **also offered optionally during admin invite/onboarding** (Option B convenience). Admin may skip onboarding PIN setup and configure later. **Not** Option C (PIN-only-for-idle).
- **LOCKED — Preferred login method:** each admin chooses **`password` | `pin`**. UI = **Bootstrap / theme form-switch (toggle)** on **both** (1) onboarding PIN section and (2) Security Settings PIN section. Preferring `pin` requires a set PIN; otherwise force/keep `password`.
- **LOCKED — Usage:** 6-digit PIN allowed for **full admin login** and **idle soft-lock / quick-resume**. Quick-resume shows only the preferred method (existing 2026-07-07 lock). Password remains the recovery path (always).
- **LOCKED — Strength:** reject weak/sequential/repeated PINs (denylist + pattern checks). Hash with password-grade seriousness (separate `pinCredentials` or equivalent); never plaintext. Same cookie-session security as password login.
- **LOCKED — Lockout:** **5** failed PIN attempts → disable PIN login/quick-resume for **15 minutes** or until successful **password** login; **audit** the event. Password change and role/permission changes invalidate PIN sessions / quick-resume (token/permission version bumps).
- **LOCKED — Storefront:** admin PIN is **admin/staff only** — never a storefront customer feature.

## 2026-07-24 — Brand naming law (all identifiers and prose)

- **LOCKED — Full brand only, never bare `saha`.** The brand is **Saha Textile**. Every project identifier — Docker containers/volumes/projects, database names, env values, service names, package/app names, mock-data brand strings, file names, deploy paths — uses the full form: `saha-textile` (kebab), `saha_textile` (snake), or `Saha Textile` (prose). Bare `saha` (e.g. `saha_local`, `saha-mongo`, `saha_mongo_data`, `/etc/saha/`) is **forbidden** and was scrubbed repo-wide on 2026-07-24. <!-- naming-law:allow -->
- **LOCKED — Enforcement is mechanical:** `scripts/check-naming.sh` runs in the root `pnpm lint` pipeline and fails on any bare-`saha` token. Allowlisted: geography data (Sahara, Sahalin, Saharsa, Saharanpur, the town "Saha" in Haryana within vendor-derived country/state/city datasets) and **`SAHATX`** — the MSG91/TRAI **DLT sender header is capped at 6 characters by the regulator**, so this abbreviation is a documented exception. <!-- naming-law:allow -->
- **LOCKED — Cookie names are the compact exception:** session/CSRF/preference cookies use the short `st_` prefix (`st_access`, `st_refresh`, `st_csrf`, `st_guest`, `st_locale`, `st_currency`; `__Host-st_*` variants per the auth plan) — compact on purpose, and containing no bare `saha`. <!-- naming-law:allow -->
- **Scope note:** applies to all tools/agents (Cursor, Claude Code, Codex, humans) and all future files; also encoded in `AGENTS.md` §5 so it is always in agent context.

## 2026-07-24 — Config injection, MSG91 primary reinforce, Spaces SGP, auth orientation

- **LOCKED — Config injection model (roadmap §0b executed).** Server secrets → **API runtime only** (local gitignored `apps/api/.env`; deploys = GitHub Actions encrypted secrets → root-owned env / Compose secrets). Public runtime config → Angular **`public/config.json` fetched at app init** (`runtime-config.ts` + `provideAppInitializer` in storefront and admin; mutable `environment` filled after fetch). **No `fileReplacements` bake-in for deploy URLs**; committed `config.json` holds localhost defaults only; deploys write the real file at container start (§0d).
- **LOCKED — MSG91 primary reinforced.** `NOTIFICATION_PROVIDER=console|msg91` behind `NotificationPort`; MSG91 is the primary SMS/WhatsApp/Email (incl. OTP) provider. Resend/SES/SMTP exist only as `EMAIL_FALLBACK_PROVIDER` options — **optional email fallback, never primary**. Brevo-as-primary shapes removed from code and examples.
- **LOCKED — Spaces region SGP only.** `SPACES_REGION=sgp1`, endpoint `https://sgp1.digitaloceanspaces.com`; all `blr1` references scrubbed.
- **LOCKED — Auth orientation.** Target remains API-set httpOnly cookie sessions + double-submit CSRF (Chunk D). Interceptors already send `withCredentials: true`; the localStorage Bearer path is explicitly **transitional** and is removed as the happy path in Chunk D. Cookie/CSRF env names (`st_access`/`st_refresh`/`st_csrf`/`x-csrf-token`) are reserved now so deploy tooling stays stable.
- **LOCKED — Local port map.** Storefront `:4200`, admin `:4300`, API `:4000`; CORS allowlist matches. Mongo = self-hosted Docker 8.3 single-node `rs0` (host-port overridable per machine via gitignored `docker/mongo/.env`, canonical default 27017).

## 2026-07-25 — G-CORE-CONTRACTS: core-domain ↔ contracts dependency direction

Context: AGENTS §3 says "`packages/core-domain` depends on NOTHING external," yet most core ports
referenced contract shapes (`Product`, `User`, `Order`, …). Chunk A verified the coupling is
**`import type` only** — the compiled `core-domain/dist` contains **zero runtime**
`require`/`import` of `@saha-textile/contracts` or zod; contracts appear only in `.d.ts` files.
Owner was presented Options A (strict independence + duplicate entity layer + mappers),
B (full runtime coupling, zod into core), C (ratify type-only). **Owner picked C (2026-07-25).**

- **LOCKED — Option C: type-only coupling, ratified + mechanically enforced.**
    - `packages/core-domain` **may** reference `@saha-textile/contracts` shapes via
      **`import type` only** (compile-time, runtime-erased). It must **never** import contracts
      as a runtime value, and must **never** depend on zod at runtime.
    - `packages/core-domain` continues to forbid **all** imports of `@nestjs/*`, `mongoose`,
      `fastify`, provider SDKs (Meilisearch/AWS/PayPal/CCAvenue/Shiprocket/MSG91/etc.), and
      `@saha-textile/adapters-*` — value **or** type.
    - **Enforcement:** ESLint flat-config boundary rules in `packages/core-domain`
      (`no-restricted-imports` + import-kind awareness) fail lint on any violation; delivered in
      Chunk B alongside this lock. TypeScript `verbatimModuleSyntax`-style discipline keeps
      `import type` honest.
    - **Interpretation of AGENTS §3:** "depends on nothing external" is read as **runtime/build
      dependency purity** — the swappability guarantee (Mongo→Postgres = adapter + DI only) is the
      protected property. Compile-time type sharing with the project-owned contracts package does
      not violate it. AGENTS §3 wording to be annotated at next constitution touch (not urgent).
    - **Direction of authorship:** `contracts` (zod) remains the single source of truth for shapes;
      core consumes inferred types. No duplicate entity layer, no DTO↔domain mappers at launch
      scale (~40 collections would double-type otherwise — rejected as boutique-inappropriate).
    - **Escape hatch (future):** if a future need demands a zod-free consumer of core, revisit by
      introducing core-owned entity types then — Option A can be adopted incrementally per domain
      without a big-bang rewrite, since the runtime surface is already pure.
