# Verdict on the Codex-generated planning files

> **What this is.** You asked me to read every `codex-*` file in `angular-context/`, judge them against our plan / motto / structure / aim, and give you one consolidated verdict — including **every question Codex asked you**, the options Codex offered (verbatim), and **my recommended call** on each. You said you've read none of them yourself, so this file is self-contained.
>
> **Files assessed (all in `project-context/angular-context/`):**
>
> 1. `codex-faq-architecture-and-admin-plan.md` (renamed 2026-07-02 from `codex-qna-architecture-and-admin-plan.md`, ~10 KB) — per the owner correction this is the **FAQ/editorial-targeting** module, not customer Q&A.
> 2. `codex-auth-architecture-db-and-request-plan.md` (~54 KB) — Auth, sessions, security, OAuth, PWA.
> 3. `codex-catalog-db-architecture-assessment-and-plan.md` (~98 KB) — Catalog, category, product, search, pricing, tax, FX, inventory/COGS, reporting DB architecture.

> **Codex reconciliation note (2026-07-04).** This verdict file is now partly historical. The owner subsequently locked the previously open catalog/infrastructure calls: **no Atlas/M0 production path**, self-hosted **Docker MongoDB 8.3** with single-node replica set, self-hosted **Meilisearch**, multi-placement category DAG, all five product patterns, toggle-based option semantics, Fastkart display styles separated from business meaning, and **Meilisearch-backed category/sidebar facets via `categoryFacetConfigs`**. Where older text below says "M0 conflict", "Atlas", "build bundle seam only", or "Level 3 launch + Level 4 fast-follow", treat that as superseded by `owner-decisions-log.md` and `catalog-search-db-decisions-explainer.md` as updated on 2026-07-04.

---

## 1. Bottom line (overall verdict)

**All three are high-quality, security-conscious, and strongly aligned with our plan — adopt them, with the reconciliations now recorded in the owner log.** They don't contradict our architecture (hexagonal, NestJS/Fastify, self-hosted Docker MongoDB, INR-canonical pricing + backend recompute + PayPal gross-up, Transloco i18n, SEO, status/archival, `SearchPort` + self-hosted Meilisearch, Fastkart-as-reference-only). Mostly they go **deeper** than our KB where our KB only sketched (auth internals, catalog DB, COGS/reporting, FAQ/Q&A targeting) and they **upgrade** us in two places (cookie-session security; richer category model).

| File    | Verdict                                  | One-line reason                                                                                                                                                                              |
| ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q&A     | ✅ **Adopt**                             | Clean, correctly separates Q&A from FAQ, sensible targeting; low risk.                                                                                                                       |
| Auth    | ✅ **Adopt (it's an upgrade)**           | Correctly moves us from "JSON bearer tokens" to **httpOnly cookie sessions + CSRF + rotating refresh** — the model our KB always intended but our current Phase-3 API doesn't yet implement. |
| Catalog | ✅ **Adopt the models, phase the build** | Excellent and complete, but proposes ~25 collections; build the lean operational set first. One real conflict to resolve: **"M0 forever."**                                                  |

**Historical caveats from the original verdict, now reconciled:**

1. **MongoDB "M0 forever" conflict — resolved 2026-07-04.** Production is self-hosted Docker MongoDB 8.3 on the droplet, not Atlas M0. Local dev also uses Docker MongoDB 8.3 with a single-node replica-set profile.
2. **Scope/phasing discipline — retained.** The model reserves seams for all required modules, but implementation should still be phase-driven and test-gated.
3. **Reconcile into one source of truth — in progress.** Accepted decisions are being folded into the KB, roadmap, Fastkart plans, and API prompt.

**Net:** these files make our plan _better_ and save us a lot of design work. Nothing in them asks us to compromise the locked stack or the hexagonal structure.

---

## 2. How they measure against our motto/structure/aim

**Where they match us (no action needed):** hexagonal ports/adapters; contracts-first (zod); INR canonical + backend-only currency math + `G=(N+f)/(1−p)` PayPal gross-up + gateway-by-currency (INR→CCAvenue, else→PayPal) + FX history + order-line price snapshots; Transloco/`{en,bn}` everywhere; SEO localized routes + canonical/hreflang + server-rendered structured data; product status/archival; `SearchPort` + self-hosted Meilisearch for launch; Fastkart as UI/behaviour reference only; loyalty-points-as-future-seam; admin-first.

**Where they upgrade us (good — adopt):**

- **Auth → cookie sessions.** Our KB security floor already says "httpOnly, Secure, SameSite cookies + rotating refresh." Our _current code_ (Phase 3) returns bearer tokens in JSON for Angular to hold. Codex correctly flags this and specifies the cookie/CSRF/opaque-rotating-refresh model end-to-end. This is a genuine security improvement and is consistent with what we wrote — **but it implies refactoring the existing `apps/api` auth code** (see §5).
- **Catalog → category placements + first-class variants + COGS.** Richer than our KB's single-`parentId` + embedded-variants sketch, and better: multi-placement DAG handles the real duplicate-path reality on the live site; first-class `productVariants` cleans up SKU/stock/search; FIFO cost layers unlock real margin reporting. All compatible with our hexagonal model.
- **Catalog filters → explicit facet layer.** Fastkart's sidebar/off-canvas filters are kept as UI reference, but public filter visibility/order/counts/SEO now come from `categoryFacetConfigs`; listing filters query Meilisearch through `SearchPort`, not ad hoc Mongo queries.

**Where to be cautious:** over-scoping at launch (§4); and keeping these from becoming a competing plan (§5). The old M0 conflict (§3.C.1) is resolved by the self-hosted MongoDB decision.

---

## 3. Decision register — every question, with my call

> Format: the question → **Codex's options (verbatim, condensed)** → Codex's recommendation → **MY CALL**. Where Codex gave no options, I give a direct call.

### 3.A — FAQ file (`codex-faq-...`, renamed from `codex-qna-...`) · 3 questions

**A.1 — Can customers submit public product questions at launch?**

- Options: (a) **Admin-managed only** — lower moderation/spam risk, faster launch, less community content; (b) **Customer submission with moderation** — more authentic content, but needs spam control + moderation queue + notifications.
- Codex rec: Admin-managed only.
- **MY CALL: Admin-managed only at launch** ✅. Matches our admin-first, lean-launch motto and avoids a moderation/spam burden on day one. The model already carries an `author.type` of `customer|guest`, so the seam is there — turn it on post-launch once moderation tooling exists.

**A.2 — Should inherited category Q&A show on every product under that category?**

- Options: (a) **Yes** (with per-Q&A surface controls + admin preview) — less repeat setup, matches category-level knowledge, but a bad category assignment over-displays; (b) **No** — precise product pages, but more admin repetition.
- Codex rec: Yes.
- **MY CALL: Yes — with per-Q&A `surfaces` controls + the admin target-preview/dedup guard** ✅. The preview ("estimated covered products, duplicates removed") mitigates the over-display risk. Saves real admin effort.

**A.3 — Should Q&A and FAQ stay separate in admin navigation?**

- Options: (a) **Separate** (shared reusable editor components) — clear editorial-FAQ vs targeted-Q&A distinction, more nav items; (b) **Combined** — one place, but targeting/moderation rules get cluttered.
- Codex rec: Separate.
- **MY CALL: Separate pages, shared reusable table/dropdown/editor components** ✅. We _already_ built separate admin stubs (`questions.page.ts` + `faqs.page.ts`), and "reuse the component, separate the screen" is exactly our motto.

### 3.B — Auth file (`codex-auth-...`) · 5 questions (+ confirmations in §3.D)

**B.1 — Should admin MFA be mandatory at launch?**

- Options: (a) **No MFA at launch, seam only** — fastest, simple, no paid dependency, lower admin protection until MFA lands; (b) **TOTP at launch** — free, strong, no SMS cost, more UI/API work + lost-device support; (c) **Passkeys at launch** — modern/phishing-resistant, more complexity + device testing.
- Codex rec: No MFA at launch, seam only.
- **MY CALL: No MFA at launch, build the TOTP seam — and ship TOTP shortly after launch as the first admin hardening** ✅ (a, leaning toward b soon). TOTP is free (no SMS) and is the right first MFA; passkeys later. Don't leave admin password-only for long once you're handling real orders.

**B.2 — Google/Facebook: backend redirect only, or provider JS buttons too?**

- Options: (a) **Backend redirect (authorization-code) flow** — secrets stay server-side, uniform for SSR/PWA, easier audit, slightly less "native" button UX; (b) **Frontend provider SDK + backend verification** — nicer One-Tap/FB button UX, more CSP/COOP + edge cases; (c) **Both** — best UX, most surface to build/test.
- Codex rec: Backend redirect first.
- **MY CALL: Backend redirect (authorization-code) flow only at launch** ✅. Keeps client secrets out of the Angular bundle, fits our hexagonal/port approach, works identically under SSR + PWA. Add JS buttons later _only_ if signup-conversion data justifies it.

**B.3 — Final production domain topology?**

- Options: (a) **Separate subdomains** — `www.sahatextile.com`, `admin.sahatextile.com`, `api.sahatextile.com` — clean deploy boundaries, host-bound `__Host-` cookies, clear CORS allowlist, but needs credentialed CORS; (b) **Same-origin reverse-proxy paths** — simpler browser cookie/CORS, but more proxy routing complexity and fuzzier app boundaries.
- Codex rec: Separate subdomains.
- **MY CALL: Separate subdomains (`www` / `admin` / `api`)** ✅. Cleanest security boundaries; the reverse-proxy plan now uses **Nginx** at the origin behind Cloudflare, mapping domains to containers. Worth the one-time CORS-credentials setup.

**B.4 — Should phone be collected during registration?**

- Options: (a) **Checkout/address stage only** — less signup friction, phone tied to shipping need, phone-login can't launch until later; (b) **Registration optional** — builds phone dataset early, adds form friction; (c) **Registration required** — best contactability, highest conversion risk.
- Codex rec: Checkout/address only.
- **MY CALL: Collect phone at the checkout/address stage, optional, not at registration** ✅. Minimises signup friction; phone is needed for shipping anyway. Keep the phone-identity + phone-OTP seam in the model for a future SMS-based feature.

**B.5 — Should offline account/order data be cached (PWA)?**

- Options: (a) **No sensitive offline cache** — safest, simplest compliance, account/order pages need network; (b) **Short-lived account cache** — better repeat-visitor UX, PII in IndexedDB, logout-purge/expiry become critical; (c) **Encrypted local cache** — stronger, but browser key management is hard, not worth launch complexity.
- Codex rec: No offline account/order cache.
- **MY CALL: No offline account/order cache at launch** ✅. Offline = public catalogue + guest/cart only (exactly our PWA plan). No tokens or PII in IndexedDB/SW cache — matches our security floor.

### 3.C — Catalog file (`codex-catalog-...`) · 8 questions + 1 inventory decision

**C.1 — Is MongoDB Atlas M0 truly permanent for production? — SUPERSEDED 2026-07-04**

Owner decision: Atlas/M0 production is removed. Use self-hosted Docker MongoDB 8.3 on the DigitalOcean droplet with a single-node replica set, private Docker network binding, persistent volume/bind mount, backups, resource caps, and local Docker Desktop parity. The older option table below is retained as historical context only.

**Historical option table:**

- Options: (a) **Strict M0 forever** — zero DB cost, forces discipline; _cannot_ safely retain unlimited rich archives or run heavy search in Mongo, needs cold archive or reduced retention; (b) **M0 for hot operational catalog + cold archive in DigitalOcean Spaces** — keeps "free Mongo," keeps orders intact, avoids paying for rarely-read archives; needs archive/restore tooling, slower archived-detail inspection; (c) **Paid Mongo tier when the business grows** — operationally simplest, supports richer indexes/archives/growth; recurring cost, violates the "always M0" instruction.
- Codex rec: Option B if "M0 forever" is non-negotiable.
- **MY CALL: Build for Option B now, pre-approve Option C as the documented upgrade trigger.** Be clear-eyed: **M0's 512 MB genuinely cannot hold 500–1,000 active + 2,000+ archived rich product docs + orders + analytics + COGS layers indefinitely** — our own KB already says so. So: design the **B** architecture (M0 = lean hot data; rich archives + old analytics → Spaces cold storage; self-hosted search off-Mongo; order-line snapshots stay in Mongo forever), **and** write down the trigger ("when active catalog, index size, or analytics outgrow M0 → move to M2/M5 shared ~$9–25/mo, then M10 ~$57/mo"). This honours your "stay free as long as possible" wish _without pretending M0 is free-forever-safe_.
    - **Action needed from you:** confirm the constraint. You told _me_ (earlier) production keeps MongoDB Atlas with a paid tier acknowledged; you told _Codex_ "always free M0." Pick one: **(i)** "free as long as honestly possible, then a small paid tier" → that's my recommendation, do Option B + the C trigger; or **(ii)** "$0 DB is an absolute hard rule" → then Option B is mandatory and we must accept the archive-tooling cost and retention limits. **Do not pick A-as-written (M0 forever with no archive plan)** — it breaks at this catalog scale.

**C.2 — Search engine choice — RESOLVED 2026-07-04**

Owner decision: self-host **Meilisearch** on the droplet behind `SearchPort`. MongoDB remains the source of truth; Meilisearch stores rebuildable searchable projections only. Typesense remains a future adapter possibility, not a launch option. Atlas Search is not a fallback because Atlas is no longer in the production architecture.

**C.3 — Categories: true multi-parent DAG, or strict tree + collections?**

- Options: (a) **True multi-placement DAG via `categoryPlacements`** — matches overlapping reality, handles duplicate display names under different paths, strong SEO redirect control; more complex admin UI + cycle prevention; (b) **Strict taxonomy tree + separate collections/tags** — easier mental model, cleaner breadcrumbs; needs cleanup of overlapping Woo assignments, some merchandising paths become collections.
- Codex rec: A if overlaps are intentional; B if many overlaps are Woo cleanup debt.
- **MY CALL: Option A (multi-placement DAG) + a one-time taxonomy cleanup during migration.** The live site genuinely has the same node under multiple paths and products in many categories, so the DAG is the honest model and it's strictly more capable than our KB's single-`parentId`. _But_ don't import all 77 Woo terms — migrate the ~26 real public categories and treat the rest as cleanup debt. So: adopt A, and clean the data on the way in.

**C.4 — What does "multi-level compounded product" mean for Saha Textile? — UPDATED 2026-07-04**

Owner decision: build the domain model/contracts for **all five** patterns: simple, variation/SKU, tailoring/customization, bought-together/cross-sell/upsell relations, and true bundle/composite. Launch sequencing may still phase the deepest bundle UI, but the schema/API should not require later redesign.

Historical option table:

- Options: (a) **Tailoring/customisation only** — already covered by add-on templates, no inventory complexity, no kits/sets; (b) **Bought-together/cross-sell only** — simple relations, no bundle inventory, not a true compound cart item; (c) **True bundle/composite product** — supports sets/kits/optional groups, needs bundle validation + inventory resolution + order snapshots.
- Codex rec: Build the model seam for C, implement A + B first unless real bundle examples exist.
- **MY CALL: Reserve the bundle seam (C), implement A + B at launch** ✅. Tailoring add-ons (A) are already our core saree pattern; bought-together/cross-sell (B) is cheap relational data. Only build true bundles (C) when a real "saree + stitched blouse as one kit" SKU actually exists.

**C.5 — Should color become a variation axis? — UPDATED 2026-07-04**

Owner decision: not just Color — **every option axis is toggle-based per product**. Product upload chooses semantic role (`filter_only`, `variation_axis`, `named_add_on`, `bundle_component_option`) separately from visual display style. Fastkart visual styles are retained as `displayStyle` only: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`.

Historical option table:

- Options: (a) **Product-by-product semantic role (`semanticRole`)** — matches live data (Salwaar color is filter-only while design drives variations), supports future color-affects-stock products; admin form needs an explicit toggle; (b) **Always a variation axis** — simpler mental model, but causes variant-matrix explosion and contradicts the live Store API.
- Codex rec: Option A.
- **MY CALL: Option A — per-product option `semanticRole`** ✅. Definitely. Forcing color to always be a variation axis would explode the variant matrix and contradicts how the real products behave. This matches the locked KB model: global attribute masters stay reusable, each product decides whether the option is `variation_axis`, `filter_only`, `named_add_on`, or `bundle_component_option`.

**C.6 — What tax policy should launch with?**

- Options: (a) **Tax-inclusive displayed prices** — simpler customer experience, matches Indian retail expectation, needs clear invoice tax breakdown; (b) **Tax-exclusive displayed prices** — cleaner accounting, worse checkout surprise; the live site's custom JS muddies the current policy.
- Codex rec: Confirm with accountant/client before contracts are finalised.
- **MY CALL: Default to Option A (tax-inclusive display) with a clear GST breakdown on the invoice — but get your accountant to confirm before we freeze the order/tax contracts.** Tax-inclusive is the Indian-retail norm and the better customer experience. This is genuinely a business/compliance decision (GST, HSN), so treat my "A" as the working default pending accountant sign-off, not a locked engineering choice.

**C.7 — How long must archived product detail remain in Mongo? — UPDATED 2026-07-04**

Owner decision: keep archived products fully in Mongo at launch. Design the compressed JSON-to-Spaces + Mongo stub seam now, but build/run it only when droplet disk pressure is real. Order-line snapshots remain in Mongo permanently.

Historical option table:

- Options: (a) **Forever in Mongo** — easiest admin lookup, incompatible with M0-forever + fashion churn; (b) **12–24 months rich archive in Mongo, older archives in Spaces** — compatible with M0, preserves restore path, needs archive/restore tooling.
- Codex rec: Option B under the M0 constraint.
- **MY CALL: Option B — keep ~12–24 months of rich archived detail in Mongo, push older archives to Spaces cold storage; order-line snapshots stay in Mongo permanently** ✅. This is the same compromise as C.1 and keeps the catalog honest on M0. (If you choose a paid Mongo tier in C.1, you can lengthen this window — but B is still good hygiene.)

**C.8 — Who maintains search synonyms/transliterations? — UPDATED 2026-07-04**

Owner decision: self-host Meilisearch and expose the full Level 1-4 feature surface from day one. Seed data may start small, but DB/API/admin must support aliases, Bengali/transliteration, no-result analytics, suggestions, and admin dictionary tuning immediately.

Historical option table:

- Options: (a) **Admin-managed dictionary** — business can tune `banarasi/benaroshi`, Bengali aliases, campaign terms; needs admin UI; (b) **Developer-managed seed file only** — simpler launch, slower to adapt; (c) **Hybrid: seeded dictionary + admin edits driven by no-result analytics** — best long-term quality, more build work.
- Codex rec: Option C.
- **MY CALL: Option C (hybrid) — ship a seeded dictionary at launch, with admin dictionary and no-result analytics supported from day one** ✅. Best Bengali↔English quality over time; start with the seed and keep the admin tuning surface/contracts ready so data can improve whenever the admin has time.

**C.9 — Inventory valuation method (§19.4, framed as a required decision, no option table).**

- Codex rec: **FIFO hidden cost layers** (unit-level margin/COGS without customer-facing batch/MRP complexity). Alternative: **weighted-average cost** (simpler reports, no per-unit cost traceability).
- **MY CALL: FIFO hidden cost layers** ✅. For a boutique that wants real gross-margin / category-profitability / purchase reporting, FIFO is the right default and stays invisible to customers. Choose weighted-average only if you explicitly don't care about per-unit cost traceability — you do, given the reporting ambitions in these docs.

---

## 4. Codex decisions that weren't framed as questions — my endorsements/flags

These are calls Codex _made_ (not asked). I'm surfacing them so you can see them, since you hadn't read the files.

- **Provider scope (auth §2):** Google login ✅, Facebook login ✅, email OTP via `EmailPort` (**Resend primary, no Brevo** — LOCKED 2026-07-02) ✅, **phone OTP modelled but not implemented (paid SMS)** ✅, **X/Twitter excluded** ✅. — **Endorse all.** These match our KB's auth cost-matrix exactly. Only request `openid email profile` (Google) and `public_profile,email` (Facebook); store Google `sub` / Facebook user-id as the identity key (not email). Correct.
- **Architecture correction (auth §1.3, §5):** move browser auth from "JSON bearer tokens stored by Angular" to **API-set `httpOnly` cookie sessions + double-submit CSRF + opaque rotating refresh with reuse-detection.** — **Endorse, and treat as a required refactor of our current Phase-3 auth code** (see §5). This is the model our KB always intended.
- **Password length (auth §15.1):** admin ≥ 12; customer "8 or 10 (UX decision)". — **My call: customer minimum 10** (length over complexity rules) + a small common-password denylist. Minor, but pick 10.
- **PayPal commission lives in `Settings > Payments > PayPal Commission` (catalog §20.2)**, versioned with effective dates + audit + calculator preview. — **Endorse.** It's pricing policy, not product data; our KB already wants admin-editable per-currency PayPal markup.
- **Weekly analytics → persisted "insight sets" + "badge assignments"; product-card badges (Sale/Featured/Hot/Most-Bought/Most-Searched…) read stable curated collections, not live analytics (catalog §6, §18, §23).** — **Endorse and keep in the day-one architecture.** The first UI/reporting slice may be phased, but the DB/events/jobs/contracts must support weekly inferred sets so storefront banners and product-card markers can consume them later without model churn.
- **Separate `orders / payments / shipments / returns / refunds` collections with immutable line snapshots (catalog §23).** — **Endorse.** Matches our "snapshot price/tax/shipping onto the order" KB rule.

### Scope/phasing — my one structural caution

Between them, these files define **~38 MongoDB collections** (auth ~13; catalog ~25). Adopting the _shapes_ is right (our motto: reserve seams now). Building them _all_ at launch is not. **Recommended launch-lean set, defer the rest:**

- **Build at/near launch:** `users` + the core auth set (`authIdentities`, `passwordCredentials`, `authSessions`, `otpChallenges`, `oauthStates`, `passwordResetTokens`, `emailVerificationTokens`, `adminInvites`, `securityAuditLogs`, `authRateLimits`, `consentEvents`); `categories` + `categoryPlacements` + `categoryFacetConfigs` + `categoryRedirects`; `tags`; `attributeDefinitions`; `addonTemplates`; `products` + `productVariants`; `orders` (+ `payments`/`shipments` snapshots); `currencies` + `currencyExchangeRates` + `paypalCommissionRules`; `searchDictionary` (seed) + search index; `questionAnswers`.
- **Defer to post-launch phases:** FIFO `inventoryCostLayers` + `purchaseInvoices`, `analyticsDailyAggregates`/weekly rollups, `productInsightSets` + `productBadgeAssignments`, `searchQueryAggregates` admin tuning, `returns`/`refunds` workflow depth, RBAC `roles`/`userRoleAssignments` (keep the simple `role` enum at launch). Reserve their seams in the model; don't build the machinery before there's data to feed it.

---

## 5. Cross-cutting risks & what to do about them

1. **Reconcile, don't fork.** These three files are parallel artifacts from a different tool. Once you confirm the calls above, the _accepted_ decisions should be folded into our single source of truth (`saha-textile-technical-knowledgebase.md` §data-model + the execution roadmap), and the codex files kept as reference appendices. Otherwise we'll drift between "the codex plan" and "our plan." I can do that reconciliation on your go-ahead.
2. **Existing auth code impact.** Our Phase-3 `apps/api` auth returns JSON bearer tokens and the guard reads `Authorization: Bearer`. Adopting the cookie-session model means a real (worthwhile) refactor: add `@fastify/cookie`, a CSRF guard, cookie-set/clear in a session service, a cookie-first JWT guard (bearer fallback for non-browser), and refresh rotation + reuse detection. Plan it as its own phase before storefront/admin auth UIs are wired.
3. **The old M0 conflict (C.1) is resolved.** Data-model freeze can proceed using self-hosted Docker MongoDB 8.3, full archived-product retention in Mongo at launch, and a later cold-archive seam only when droplet disk pressure becomes real.
4. **Tax policy (C.6) needs a human, not us.** Get accountant confirmation on tax-inclusive vs exclusive + GST/HSN before the order/tax contracts are frozen.
5. **Don't over-trust the live-site scrape as final truth.** Codex pulled real WooCommerce data (23 products, 26 public categories, 77 raw terms, the design/no-stitching variation rows). Useful and credible, but the KB's own caveat stands: verify final category parentage and exact attribute/term names with you/the client before migrating, and clean the Woo debt (C.3).

---

## 6. Net recommendation & next steps

- **Adopt all three plans.** They're competent, secure, and aligned; the auth one is a genuine upgrade.
- **Make these calls (my recommendations, all marked ✅ above):** Q&A — admin-managed, inherited-with-preview, separate pages. Auth — no-MFA-seam (TOTP soon), backend-redirect OAuth, subdomains, phone-at-checkout, no offline account cache, customer-pw-min-10, cookie sessions. Catalog — self-hosted Docker MongoDB 8.3, self-host Meilisearch, placement-DAG + Woo cleanup, category/sidebar facets via `categoryFacetConfigs`, all five product patterns, color/options per-product, tax-inclusive (pending accountant), archived products retained in Mongo at launch, hybrid search dictionary, **FIFO** inventory.
- **Then:** (1) you confirm/adjust the calls; (2) I reconcile the accepted decisions into our KB + roadmap as the single plan; (3) we sequence the build lean (§4) — cookie-auth refactor → catalog/variants/placements → search → checkout/pricing → reporting/COGS later.

The only remaining owner/accountant decision from this older verdict is **C.6 (tax policy)**. **C.1 (M0 budget)** is now resolved: production leaves Atlas and uses self-hosted Docker MongoDB 8.3 on the droplet.
