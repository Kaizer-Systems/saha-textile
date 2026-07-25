# Owner Decisions — Saha Textile

**Status:** Authoritative record of currently locked owner decisions.

**Last reconciled:** 2026-07-26

This file contains current decisions only. Superseded intermediate positions remain available in Git history, not inline where they can be mistaken for current direction.

Unanswered questions live only in `pending-decisions.md`. When an answer is confirmed, record the final rule here, reconcile dependent sources, and remove it from the pending file.

## Authority and interpretation

1. This file governs locked intent.
2. `AGENTS.md` governs repository-wide operating and architectural rules.
3. Tested code/runtime governs claims about what exists now.
4. Zod contracts/OpenAPI govern API shapes.
5. Adapter models, validators, indexes, and migrations govern persistence shapes.
6. `project-progress.md` governs current delivery status.
7. Portal documentation is a derived maintained view and never overrides these sources.

## Project scope and brand

- Saha Textile is a single-store boutique e-commerce platform, not a marketplace.
- No multi-vendor, seller commissions, warehouse-management system, or recommendation ML.
- Fastkart is a UI and behavior reference only. Its code is never forked.
- Full brand naming is mandatory: `saha-textile`, `saha_textile`, or “Saha Textile”; never bare `saha`. <!-- naming-law:allow -->
- Allowed compact exceptions:
    - `st_*` and `__Host-st_*` cookie names;
    - TRAI/DLT sender `SAHATX`;
    - genuine geography data containing “Saha”. <!-- naming-law:allow -->
- `scripts/check-naming.sh` mechanically enforces the naming law.

## Architecture and dependency direction

- Architecture is hexagonal/ports-and-adapters.
- Angular apps consume only the API over HTTP.
- Provider SDKs, Mongoose documents, persistence rows, and vendor payloads stay at adapter edges.
- Replacing MongoDB with PostgreSQL or replacing a payment/shipping/provider integration must not require changes to core use cases or Angular UI.
- `packages/contracts` is the single source of truth for shared Zod/API shapes.
- `packages/core-domain` may import contract shapes through `import type` only.
- Core must have no runtime dependency on contracts/Zod and no import—type or value—of NestJS, Fastify, Mongoose, provider SDKs, or adapter packages.
- ESLint boundary rules must enforce this direction.
- Resolved implementation gate `G-CORE-CONTRACTS`: the type-only contracts direction above is final.
- Canonical product price is always INR.

## Applications and frontend foundations

- Storefront: Angular 21 + AnalogJS SSR/SSG, file-based routing, PWA.
- Admin: Angular 21 private application; no SEO requirement.
- API: NestJS 11 on Fastify 5.
- Developer portal: Docusaurus, derived from repository evidence.
- Styling: Bootstrap 5, ng-bootstrap, SCSS.
- Client state:
    - TanStack Angular Query owns server fetch/cache/mutation state.
    - SignalStore/local signals own compact feature/UI state.
    - Classic NgRx Store/Effects/Entity owns heavily mutated workflows such as cart.
- Forms use typed Angular reactive/signal forms.
- Transloco owns runtime UI translations.

## Catalog, products, categories, and search

- Categories use a multi-placement DAG through category placements; do not force a strict single-parent tree.
- Imported WooCommerce category junk is cleaned rather than preserved as target truth.
- Product model supports:
    - simple products;
    - SKU/variation products;
    - tailoring/customization;
    - related/cross-sell/upsell relationships;
    - true bundle/composite products.
- Product option semantic roles are independent of display style.
- Semantic roles:
    - `filter_only`;
    - `variation_axis`;
    - `named_add_on`;
    - `bundle_component_option`.
- An option is a variation axis only when it changes SKU, stock, price row, image, base identity, or purchasability.
- Color, size, fabric, design, waist, liter, and other axes are product-specific toggles; none is globally variation-driving.
- Canonical display styles:
    - `rectangle`;
    - `circle`;
    - `image_swatch`;
    - `color_swatch`;
    - `radio`;
    - `dropdown`.
- Visual display style never determines business behavior.
- A standalone blouse may use design as a variation axis.
- A saree’s included blouse piece remains part of the base saree; `Blouse Design` is a named add-on group with `No Design` default and optional pricing/media/measurement requirements.
- Multiple named add-on groups are supported.
- Archived, disabled, and discontinued products remain in MongoDB at launch and disappear from public listing/search/sitemap surfaces.
- A future compressed cold-archive seam may move rich historical catalog data to Spaces only when real disk pressure justifies it.
- Search uses self-hosted Meilisearch behind `SearchPort`.
- MongoDB is source of truth; Meilisearch is a rebuildable denormalized index.
- Launch search surface includes typo tolerance, aliases, transliteration support, suggestions, no-result analytics, and admin dictionary tuning.
- Category/listing facets come from Meilisearch through `SearchPort`.
- Category/placement facet configuration controls public filters, order, style, counts, and mobile/desktop visibility.
- Arbitrary faceted URLs are `noindex,follow` and canonicalize to the base listing unless explicitly modeled as SEO landing pages.

## Pricing, inventory, and commerce records

- Selling/catalog prices are stored and displayed tax-inclusive.
- Tax-exclusive bases are reverse-calculated only where invoices/reporting require them.
- Inventory valuation uses FIFO cost layers.
- FIFO/COGS details are never customer-facing.
- Manual inventory adjustments require a fixed reason code:
    - `damage`;
    - `lost_missing`;
    - `manual_recount_correction`;
    - `supplier_shortage`;
    - `return_restocked`;
    - `return_not_restocked`;
    - `internal_use_sample`;
    - `photoshoot_display_use`;
    - `system_migration_correction`;
    - `other`.
- Notes are optional for the first nine and mandatory for `other`.
- Orders, payments, shipments, returns, and refunds are separate collections connected by durable identifiers.
- Order lines are immutable purchase-time snapshots.
- Multi-document commerce writes use MongoDB transactions.
- Weekly analytics produce persisted insight sets and stable badge assignments; storefront cards/rails do not run live analytics joins.

## Cart, pending intents, and offline behavior

- Guest add-to-cart is available.
- Guest checkout is not available at launch.
- `Proceed to checkout` forces login/signup, merges the guest cart, then resumes checkout.
- Guest carts are server-authoritative and stored in `carts`.
- Guest identity uses an opaque random `st_guest` httpOnly cookie; only its hash is stored server-side.
- Guest cart TTL is 30 days sliding from last activity.
- Guest-to-user cart merge is transactional.
- Invalid/unavailable merge lines are reported, not silently dropped.
- Pending intent stores one latest account-bound action per guest/session.
- Pending-intent TTL is at most 30 minutes unless a feature requires less.
- Auth success order is:
    1. merge guest cart;
    2. revalidate pending action;
    3. replay if allowed;
    4. clear intent;
    5. return to the relevant continuation.
- Wishlist and Save for Later are separate account-bound concepts.
- Notify Me is account-bound and product/variant-aware.
- Product Q&A does not require login.
- Reorder/Buy Again is already an authenticated flow and is not a pending intent.
- Public track order is not available at launch.
- When built later, track order requires order number plus matching email or phone, with rate limits and anti-enumeration.
- IndexedDB/Cache Storage are browser-side cache/queue mechanisms, never backend infrastructure or source of truth.
- Offline mode covers previously cached public catalog plus offline cart mutations.
- Never cache auth tokens, refresh tokens, payment data, admin data, or account/order PII offline.
- Storefront privacy UI exposes a clear-local/offline-data action.

## Authentication, sessions, and admin security

- Browser authentication uses API-set httpOnly/Secure/SameSite cookies.
- Use double-submit CSRF, short access lifetime, opaque rotating refresh tokens, and refresh reuse detection.
- Browser happy path is cookie-first; bearer support is limited to approved non-browser clients.
- Password minimum is 12 characters for storefront and admin, with a common-password denylist.
- Storefront auth supports email/password, Google, Facebook, and channel-direct email OTP.
- X/Twitter login is excluded.
- Phone is collected at checkout/address stage, not registration.
- Phone OTP remains a seam until enabled through the notification provider.
- OAuth UI uses provider JS buttons/One Tap where appropriate; the backend verifies provider tokens and owns the Saha Textile session.
- Minimum provider scopes only.
- Admin has no mandatory MFA at launch; preserve the seam.
- Admin supports email-or-username plus password.
- Admin may configure a six-digit PIN:
    - optional during onboarding;
    - always available in Security Settings after password proof;
    - usable for full login and idle quick-resume;
    - preferred method is `password` or `pin`;
    - weak, repeated, and sequential PINs are rejected;
    - five failed PIN attempts lock PIN use for 15 minutes or until password login;
    - PIN is password-grade hashed and audited.
- Admin inactivity uses a 15-minute soft lock while preserving the mounted route/form state.
- Password, role, permission, account-status, token-version, and reuse-detection changes invalidate quick resume.
- Protected admin deep links resume after successful login.
- RBAC failures are never queued or replayed.
- Object-level authorization is mandatory for owned resources.

## OTP and notifications

- `NotificationPort` is the customer-messaging boundary.
- MSG91 is the primary customer notification provider for email, SMS, and WhatsApp.
- Resend/SES/SMTP may exist only as optional email fallback adapters, never primary.
- Team mailboxes use Google Workspace and are separate from programmatic messaging.
- OTP is generated, stored, and verified by Saha Textile; do not use MSG91 OTP Widget or SendOTP.
- OTP code:
    - CSPRNG six digits;
    - HMAC-SHA256 with server pepper at rest;
    - 10-minute expiry;
    - maximum five attempts;
    - single active challenge per identifier and purpose;
    - atomic consume and attempt updates;
    - never logged.
- OTP send responses are generic and anti-enumerating.
- Notification kill-switches are split by channel and category:
    - transactional/utility;
    - marketing.
- Disabled channel/category combinations short-circuit before calling providers.
- Marketing sends require consent and approved templates where applicable.
- Usage thresholds, spend warnings, auto-disable behavior, RBAC, and audit are required.

## Privacy and consent

- Saha Textile uses a self-hosted granular consent experience, not a paid CMP.
- Consent categories include:
    - strictly necessary;
    - functional;
    - analytics;
    - targeting;
    - marketing;
    - promotional.
- Non-essential scripts are blocked until consent.
- Consent version and timestamp are stored.
- Marketing notification consent is separate from transactional necessity.
- Data export and privacy-erasure workflows must exist.

## Reviews, FAQ, and Q&A

- FAQ is admin-authored editorial content.
- FAQ may target global, category, product, or mixed category/product surfaces with dedupe and preview.
- Product Q&A is separate from FAQ.
- Customers and guests may submit product questions.
- Guest submission includes name and email.
- Logged-in identity is prefilled but editable for the question.
- “Stay anonymous” hides public identity but not admin identity.
- Admin answers publish the Q&A and trigger an answer email.
- FAQ and Q&A use separate admin pages with shared reusable editor/table components.
- Reviews require logged-in verified purchase.
- Review content is star rating, text, and optional images.
- Reviews require admin moderation before public display.
- Rating aggregates and SEO use approved verified reviews only.

## i18n

- English is the primary locale.
- The active target locale pair is English and French.
- Bengali is an illustrative likely next locale, not a currently locked launch pair.
- Machine 1: developer-owned UI chrome uses Transloco keys.
- Machine 2: admin-authored catalog/CMS/media/measurement content uses DB-localized fields and is rendered raw after API locale resolution.
- Never send Machine-2 values through Transloco.
- TS-origin static labels use reactive Transloco translation, not one-time imperative translation.
- Mega-menu and footer navigation are currently developer-owned Machine-1 content.
- Measurement definitions are reusable data-driven Machine-2 entities, not a hard-coded universal field list.
- Adding a locale requires a checklist covering UI JSON, DB content, media alt/SEO, notification templates, SEO defaults, hreflang, and any compiled payloads.

## Media

- DigitalOcean Spaces region is SGP (`sgp1`).
- Uploads use presigned direct-to-Spaces operations; API does not proxy normal browse bytes.
- `mediaAssets` is first-class and reusable; products/content store references and attachment sort order.
- Images:
    - upload JPEG/PNG;
    - retain original;
    - create full-resolution WebP;
    - create static WebP role derivatives;
    - no AVIF at launch or for the near-term plan;
    - BullMQ plus sharp at the adapter/worker edge;
    - role names: `thumb`, `card`, `gallery`, `zoom`, `swatch_image`, `swatch_image_v2`;
    - localized alt/SEO is required for every active locale before publish;
    - orphan assets are soft-deleted and garbage-collected after grace.
- Product imagery supports Simple and Compound modes.
- Compound image rows follow the full variation-axis Cartesian matrix.
- Inactive image mode data is parked rather than destroyed.
- Attachment ordering is contiguous and attachment-owned; `#1` is primary.
- Named add-on terms may have ordered galleries without becoming inventory variants.
- Video:
    - master upload is H.264/AAC MP4 at 1080p or better;
    - BullMQ plus ffmpeg generates HLS;
    - always 480p/720p/1080p;
    - add 1440p only for 1440p source;
    - add 2160p only for 2160p source and skip 1440p in that case;
    - delete hot master after successful transcode;
    - playback uses Vidstack through a thin UI wrapper;
    - core never imports Vidstack, ffmpeg, BullMQ, or Spaces SDKs.
- YouTube latest-video discovery uses Data API v3 through `YouTubePort`, cached and refreshed daily at 00:00 IST.

## Payments, FX, and shipping

- Launch accepts online payments only.
- No COD, manual UPI proof, or split/partial payments at launch.
- Currency chooses a gateway role, not a vendor:
    - INR → Indian online gateway role;
    - non-INR → PayPal role.
- Current operational preference for INR is CCAvenue with Razorpay as preferred successor.
- Vendor selection is adapter plus DI/config only.
- Real providers are wired only when approved credentials exist; ports and stubs come first.
- PayPal foreign pricing uses versioned admin-editable percentage and fixed-fee gross-up.
- FX rates are fetched daily, persisted, audited, and served from the last valid rate when providers fail.
- Shipping is behind `ShippingPort`.
- Shiprocket is the preferred domestic and international adapter once credentials are available.
- Provider quotes always preserve returned value and currency.

## Time, accounting, and reporting

- Store all timestamps in UTC.
- Compute accounting/legal boundaries in `Asia/Kolkata`.
- Indian financial year is 1 April–31 March.
- Admin quarters are Indian financial quarters:
    - Apr–Jun;
    - Jul–Sep;
    - Oct–Dec;
    - Jan–Mar.
- Storefront timestamps display in customer-local timezone with a label.
- Admin timestamps display in IST.
- PDF invoice timestamps are frozen in IST at generation.
- Date presets are computed dynamically.

## Infrastructure, config, and deployment

- Production MongoDB is self-hosted Docker MongoDB 8.3.
- MongoDB runs as a single-node replica set for transaction support.
- MongoDB and Meilisearch are private-network-only.
- Local development uses the same MongoDB replica-set behavior.
- MongoDB has persistent storage, resource caps, health checks, restart policy, scheduled backups, and restore drills.
- Cloudflare fronts the origin.
- Nginx is the origin reverse proxy.
- API must trust configured proxies and use the configured real-client-IP header safely.
- Origin access is restricted to Cloudflare ranges where applicable.
- Server secrets are API-runtime-only.
- Local server env is gitignored `apps/api/.env`.
- Deploy secrets flow from approved GitHub encrypted secrets into root-owned runtime env/Compose secrets.
- Public Angular runtime configuration comes from `public/config.json` loaded at application initialization.
- No deploy URL `fileReplacements` and no secret in browser config.
- Canonical local ports:
    - storefront `4200`;
    - admin `4300`;
    - API `4000`.
- Repository is public; deployment images are private GHCR packages.
- Protected branches are changed only through reviewed PRs.

## Audit and retention

- Every admin mutation writes an audit record.
- Explicit coverage includes catalog, price, stock, purchase invoice, order, payment/refund, shipping/tax/payment/currency/notification config, role/permission, login failure, session revocation, and security events.
- Financial/security audit retention is seven years.
- Catalog/general-admin audit retention is five years.
- Raw analytics events are retained for 90 days after aggregate rollup.
- Never audit secrets, passwords, full tokens, card data, or gateway working keys.
- Prefer bounded field diffs over unbounded before/after blobs.

## Developer portal

- Docusaurus is the private developer portal.
- Root `docs/` Markdown/MDX is the portal’s authored content source.
- OpenAPI remains API machine truth.
- Scalar is the single planned human-facing API reference at `/api/reference`.
- `/api/openapi.json` exposes the machine-readable document.
- Do not maintain parallel Swagger UI, Redoc, or `/api/console`.
- Interactive API requests target approved development/staging only and never bypass auth, CSRF, RBAC, or rate limits.
- Portal page lifecycle values are exactly:
    - `implemented`;
    - `scaffolded`;
    - `planned`;
    - `deferred`;
    - `deprecated`.
- Portal pages declare audience, verification date, and precise source paths.
- Portal validation rejects stale/missing provenance and forbidden terminology.
- Current code/runtime and locked target intent must remain visibly distinct.
- Wave 2 delivery order is Schema Nebula → ⌘K Verbs → First Flight.
- Schema Nebula’s canonical route is `/database/schema-nebula`.
- Schema Nebula uses one star per distinct target MongoDB collection: **64 explicit nodes**, not the superseded 48-family approximation.
    - Seven stars represent models that exist today: `categories`, `products`, `promotions`, `orders`, `currencies`, `carts`, and `users`.
    - The remaining 57 stars represent target-only collections and stay visually ghosted until implementation evidence exists.
    - Related collections may be clustered visually, but must never be collapsed into one family node or described as one physical collection.
    - The broad `auditLogs` collection owns admin and security audit history; do not add a separate `securityAuditLogs` node.
    - Collection status comes from tested adapter/model evidence. A contract or architecture section alone does not make a collection implemented.
- First Flight’s canonical route is `/getting-started/first-flight`.
- First Flight is an enterprise guided onboarding journey with three acts: Launch Bay persona selection, a route-spanning spotlight HUD, and Mission Debrief.
- Its persona order is exactly beginner → frontend → backend → operator.
- Persona stops are governed data, not React literals. Every destination route and stable heading/`data-first-flight-anchor` target must resolve at build time; a missing target fails the portal build.
- First Flight progress is optional, resettable, and device-local only. It uses no telemetry and cannot write to an application API or the repository.
- First Flight active navigation state is URL-carried through the governed `firstFlight` persona and zero-based `step` parameters. This is linkable navigation state, not completion history; the route-spanning engine must not write browser storage before the separately reviewed resume/debrief pass.
- First Flight device-local persistence is explicit opt-in per persona. Its versioned payload may contain only persona id, furthest governed stop id, completion state, and an optional completion timestamp; it must never store page content, browsing/search history, source paths, user identity, free text, or analytics.
- Resume returns to the furthest governed stop recorded for that persona. Reaching or saving a later stop does not prove that earlier checkpoints were studied. Users can forget one persona through its opt-in control or reset every saved flight from Launch Bay.
- Mission Debrief appears at the final checkpoint and is derived from compiled persona, stop, and lifecycle data. It remains available for the current session without storage; completion persists only for a persona that explicitly opted in.
- First Flight delivery remains incremental: contract/compiler → Launch Bay → route-spanning engine → resume/debrief → hardening. A governed dataset alone does not make the instrument live.

## Open decisions

All unresolved owner choices are listed in `pending-decisions.md`. No open question should be added to this file.
