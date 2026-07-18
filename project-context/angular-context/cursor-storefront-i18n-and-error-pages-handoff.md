# Cursor Handoff — Storefront: 500 page + i18n (Transloco) coverage & sanity sweep

> **You are Cursor, working in `apps/storefront` of the `saha-textile` pnpm/turbo monorepo.**
> You have little prior context on this project. This document is your complete brief. Read all of it
> before touching code. When something is ambiguous, **STOP and ask the owner — do not assume**
> (see §8). Another Claude session is simultaneously building the PDP; stay in your lane (§9).

---

## 0. Ground truth (read this first — it corrects a common misconception)

The auth pages, account pages, maintenance page, and 404 page are **already ported, already moved
into the correct folder hierarchy, already routed, and already guarded.** You do **NOT** need to
move, relocate, or re-wire them. That work was completed in earlier phases (restructure + file-based
routing). If you catch yourself "moving a page into place," you are doing the wrong task — stop.

Current, verified state:

| Group                                                 | Component location (`apps/storefront/src/app/…`)                    | Route file (`…/pages/`)                                               | Guard           |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------- |
| Login                                                 | `features/auth/login/`                                              | `pages/auth/login.page.ts`                                            | —               |
| Register                                              | `features/auth/register/`                                           | `pages/auth/register.page.ts`                                         | —               |
| Forgot password                                       | `features/auth/forgot-password/`                                    | `pages/auth/forgot-password.page.ts`                                  | —               |
| OTP verify                                            | `features/auth/otp/`                                                | `pages/auth/otp.page.ts`                                              | —               |
| Update password                                       | `features/auth/update-password/`                                    | `pages/auth/update-password.page.ts`                                  | —               |
| Account shell (layout)                                | `features/account/account.ts` + `sidebar/`                          | `pages/account.page.ts`                                               | **`AuthGuard`** |
| Dashboard                                             | `features/account/dashboard/`                                       | `pages/account/dashboard.page.ts`                                     | via shell       |
| Orders (+ details)                                    | `features/account/orders/`                                          | `pages/account/order.page.ts`, `…/order/details/[id].page.ts`         | via shell       |
| Addresses                                             | `features/account/adresses/`                                        | `pages/account/addresses.page.ts`                                     | via shell       |
| Wallet / Point / Bank details / Refund / Notification | `features/account/{wallet,point,bank-details,refund,notification}/` | `pages/account/*.page.ts`                                             | via shell       |
| Maintenance                                           | `features/maintenance/`                                             | `pages/maintenance.page.ts`                                           | —               |
| 404                                                   | `features/page/error404/`                                           | `pages/404.page.ts` **and** `pages/[...not-found].page.ts` (wildcard) | —               |

So your actual scope is **three things only**:

- **Task A (§3):** Create the **500 (Internal Server Error)** page — the only net-new page.
- **Task B (§4):** i18n (Transloco) **coverage** for the auth pages, account pages, and error/maintenance pages — make every _static_ string translatable, leave _customer data_ alone.
- **Task C (§5):** i18n **sanity sweep** of already-built pages: home, category/collection, PDP, and the 4 Customer-Service static pages — including their child/shared components.

Do them in that order.

---

## 1. Non-negotiable project rules (extracted from the KB — follow rigidly)

These are locked decisions from the project knowledge base and prior migration phases. Cursor does
not get to relitigate them.

**Stack / architecture**

1. **App platform: AnalogJS (Angular 21 on Vite + Nitro SSR).** SSR is mandatory and must stay working.
2. **Routing is file-based (Analog).** URL = file path under `src/app/pages/`. A page file is a _thin
   wrapper_: it imports the real component from `features/…` and `export default`s it, optionally with
   `export const routeMeta = {…}`. **Never put real UI logic in a `pages/*.page.ts` file.** Copy the
   exact comment header pattern already used in sibling page files.
3. **Analog gotcha — no parenthesis route groups.** Do not create `(group)` folders under `pages/`;
   the Angular Vite plugin fails to transform files reached through `(...)` paths. Page files are flat
   or plainly nested only.
4. **Page files must be plain JS-valid TS** — no `RouteMeta` type annotations on `routeMeta`, no fancy
   type imports in page files. Look at existing page files and match them exactly.
5. **State management (already in place — do not swap):** TanStack Query (`injectQuery`) for server
   reads; NgRx **SignalStore** in `core/state/` for app-shell/session (auth, account, setting, etc.);
   classic NgRx Store/Effects/Entity for cart/wishlist/compare. You will mostly _consume_ these, not
   add new ones. If a task seems to need new global state, that's a signal to STOP and ask.
6. **i18n library is Transloco (`@jsverse/transloco`) — FINAL.** ngx-translate and `@angular/localize`
   message-compilation are both banned. Runtime switching only.
7. **UI is a verbatim Fastkart port.** Do **not** hand-write, redesign, or "improve" markup, styling,
   or class names. Preserve the existing DOM/CSS exactly. i18n work wraps strings in a pipe; it must
   **not** change layout, classes, or visual output.

**SEO-safe DOM (do not regress)** 8. Inactive/collapsed content must stay in the server-rendered DOM (crawlable), toggled by CSS — never
lazily mounted/destroyed. (e.g. FAQ accordion uses `[destroyOnHide]="false"`; PDP tabs are plain
Bootstrap `.tab-pane`, deliberately **not** `ngbNav`.) If your i18n edits are near tabs/accordions,
don't "tidy" them into ngbNav.

**Code conventions** 9. **Path aliases:** `@core/*`, `@features/*`, `@shared/*`, `@data-access/*`, `@layout/*`. Use them for
cross-boundary imports; keep same-directory imports relative. Match the import grouping/order you
see in existing files. 10. **Indentation: match the file you're editing.** Storefront uses **2-space** indentation (the linter
enforces it) — note this differs from the admin app. Templates are 1-tab in some `.html`; follow
the file. 11. Component class files are named `*.ts` (not `*.component.ts`), selector `app-*`, standalone with an
explicit `imports: [...]` array. To use the pipe, add `TranslocoModule` to that array.

**Build / verify discipline** 12. **Node 24 is required** (`nvm use`; the repo `.nvmrc` says 24). pnpm rejects the v22 that some
non-interactive shells resolve. Run everything from the repo root with pnpm/turbo filters. 13. After **every** logical chunk: build must stay green (client + SSR + Nitro), typecheck 0 errors,
lint 0 errors. See §7 for exact commands and the i18n-specific check. 14. Vite dep-optimization caches aggressively: if you add/remove a dep or hit a stale SSR error,
`rm -rf node_modules/.vite` and restart the dev server (a reload is not enough — Nitro caches a
failed SSR eval).

---

## 2. The i18n doctrine — **static vs. dynamic** (the single most important rule)

The architecture requires that **every visible _static_ string** flips language when the user switches
locale (Fastkart's demo only translates part of the UI; we translate all of it). But **customer/CMS
data must never be sent through Transloco** — it is real data (a person's name, their email, a product
title, a CMS body), not a UI label.

**Decision rule for each string you encounter:**

- **Static UI chrome** (labels, buttons, headings, placeholders, table headers, validation messages,
  toasts, empty-state text, "Hello", "Hi", "My Dashboard", "Add to cart"…) → **must be a Transloco key.**
- **Dynamic data** (the user's name, email, phone, address, order id, wallet balance, product name/
  description, CMS `[innerHTML]` bodies, anything coming from an API/store/JSON) → **render raw**
  (optionally with formatting pipes like `titleCase`, `currencySymbol`, `date`). **Never** pipe it
  through `transloco`.

**This is already done correctly in two places — use them as your reference for what "right" looks
like** (do not rewrite these; copy the pattern):

`features/account/dashboard/dashboard.html`:

```html
{{ 'hello' | transloco }},
<b class="text-title">{{ (user$ | async)?.name! | titleCase }}</b>
```

→ `hello` is static (key); the name is customer data (raw + `titleCase`). ✅

`layout/header/widgets/my-account/my-account.html`:

```html
{{ 'hi' | transloco }}, {{ ((isAuthenticated$ | async) ? (user$ | async)?.name : 'user' | transloco) }}
```

→ `hi` is static (key); the name is customer data (raw); the _fallback_ word `'user'` shown when logged
out is static (key). ✅

**Cascade rule (owner-emphasized):** when you make a page i18n-compliant, you must follow it into
**every dependency that renders as part of that page** — child components, shared/reusable widgets
(`@shared/ui/*`), the header/footer chrome if in scope, modals, breadcrumbs, buttons, alerts. A page is
only "done" when the **fully rendered result**, including all nested components, has zero untranslated
static strings. Translating the page shell but leaving a child widget hardcoded is **not done**.

**Strings hiding in TypeScript, not just templates.** Some static strings are set in component `.ts`
files, e.g. in `login.ts`:

```ts
public breadcrumb: IBreadcrumb = { title: 'Log in', items: [{ label: 'Log in', active: true }] };
```

Those `'Log in'` literals never pass through the pipe and will not translate. The coverage pass must
catch **TS-origin static strings too**: breadcrumb titles, alert/toast messages, validation-error text
built in code, hardcoded option lists, etc. **How to translate a TS-origin string is a pattern
decision — see §8 item 3; ask the owner before inventing one, because a wrong choice here gets
copy-pasted everywhere.**

---

## 3. Task A — Create the 500 (Internal Server Error) page

**Goal:** an `/500` page that is a structural twin of the 404 page, in the same folder tier, so error
pages are consistent.

**Reference (read first):** `features/page/error404/error404.{ts,html,scss}` and its routes
`pages/404.page.ts` + `pages/[...not-found].page.ts`. Note the 404's message text and back-button text
come from `SiteConfigStore` (`siteConfig$.error_page.*`) — i.e. CMS-driven, not hardcoded — and the
breadcrumb `title: '404'` is a plain literal.

**Steps:**

1. Create `features/page/error500/error500.{ts,html,scss}` by duplicating the 404 component.
    - Class `Error500`, selector `app-error500`, `templateUrl: './error500.html'`, `styleUrls: ['./error500.scss']`.
    - Change the breadcrumb `title`/label from `'404'` to `'500'`.
    - Keep the same layout/markup/classes (verbatim structure — just the 500 variant).
2. Create the route: `pages/500.page.ts` — thin wrapper, same comment-header pattern as the other page
   files, `import { Error500 } from '@features/page/error500/error500'; export default Error500;`.
3. Build + verify (§7). The page must render at `/500` with SSR intact and console clean.

**Two things you must resolve by asking (do NOT guess) — see §8 items 1 & 2:**

- There is a `assets/images/inner-page/404.png` but **likely no `500.png`.** Ask which asset to use.
- `SiteConfigStore.error_page` models **one** error page (used by 404). There is no separate
  server-error content slot. Ask whether the 500 message should (a) reuse the same `error_page` config,
  or (b) use a dedicated static Transloco fallback string (e.g. key `internal_server_error_message`).
  Do not wire it up until answered.

> Note: this is a SPA — nothing auto-navigates to `/500` yet. You are creating the page + route so it
> exists and is reachable; wiring real server-error interception is a later/API-phase concern. Do not
> build error interceptors as part of this task.

---

## 4. Task B — i18n coverage: auth + account + error/maintenance pages

**Scope (components + every child/shared component they render):**

- Auth: `features/auth/{login, register, forgot-password, otp, update-password}`
- Account: `features/account/{account (shell), sidebar, dashboard, orders (+ orders/details), adresses,
wallet, point, bank-details, refund, notification}`
- Error/maintenance: `features/page/error404`, the new `features/page/error500`, `features/maintenance`

**Method, per component:**

1. Open the `.html` and the `.ts`. Inventory every human-visible string.
2. For each string, apply the **§2 static-vs-dynamic rule**. Static → wrap in `{{ '<key>' | transloco }}`
   (attributes/placeholders: `placeholder="{{ '<key>' | transloco }}"`). Dynamic/customer data → leave
   raw (add a formatting pipe only if the design already implies one).
3. Ensure the component's `@Component.imports` array includes `TranslocoModule` (see `login.ts` for the
   pattern). Add it if missing.
4. Handle **TS-origin static strings** (breadcrumb titles, toast/alert text, validation messages) per
   the pattern the owner confirms in §8 item 3.
5. Add each new key to **both** `public/assets/i18n/en.json` **and** `public/assets/i18n/fr.json`
   (§6). English value = the original literal; provide a French translation (if unsure of a French
   term, add the key with a best-effort value and list it for owner review — do not skip the key).
6. **Cascade:** if the component renders `@shared/ui/*` widgets, `@layout/*` chrome, or feature child
   components that still contain hardcoded static strings _visible on this page_, fix those too (§2
   cascade rule). If a shared widget is used app-wide, translating it here benefits every page — good,
   but keep the change scoped to string-wrapping only.

**Key-naming conventions (match existing `en.json`):** flat, `snake_case`, human-derived from the
English text — e.g. `email_address`, `email_is_required`, `welcome_to_fastkart`, `my_dashboard`,
`total_orders`. Reuse an existing key if the exact same string already has one (grep `en.json` first —
do not create duplicates like `log_in` + `login` for the same label).

**Do not translate (leave raw):** user name/email/phone/address, order numbers, wallet/point balances,
dates, currency amounts, product names, and any `[innerHTML]` CMS content.

---

## 5. Task C — i18n sanity sweep of existing pages

After Tasks A & B, verify (and fix any gaps in) i18n on these **already-built** pages. This is an
audit-and-fill pass, not a rebuild — many strings are already keyed; you are closing gaps.

**Pages to sweep, each including all child/shared/reusable components rendered on it (cascade rule §2):**

1. **Home** — the default `/` home (`pages/index.page.ts` → its feature component) and every widget it
   composes (`@shared/ui/*`, theme widgets, header, footer).
2. **Category / collection** — `/collections` (`features/shop/collection/…`): sidebar filters, sort bar,
   product-box cards, pagination, breadcrumb, empty/no-data states.
3. **PDP (product detail)** — `features/shop/product-detail` / `features/shop/product/…`: gallery labels,
   add-to-cart/wishlist/compare buttons, quantity/variation labels, the Description/Review/Q&A tab
   headers, breadcrumb, related-products heading. **Coordinate — another session is actively editing
   PDP (§9): do the PDP sweep last, keep it to string-wrapping only, and if you hit an active-edit
   collision, pause that file and flag it.**
4. **The 4 Customer-Service static pages** — `/privacy-policy`, `/terms-conditions`, `/refund-returns`,
   `/shipping-policy`. All four re-export the shared `features/page/static-page/static-page.ts`, which
   renders CMS body via `[innerHTML]` (that body is **dynamic data — do NOT translate it**). Here the
   i18n concern is only the _static chrome_: breadcrumb + any surrounding labels. Verify the breadcrumb
   title handling and confirm no static label is hardcoded. Expect this to be light.

For each page: load it in the dev browser, switch language en→fr, and confirm every static string flips
while customer/CMS data stays put. Use the missing-translation console check in §7.

---

## 6. Where translations live & how to add them

- Files: `apps/storefront/public/assets/i18n/en.json` and `…/fr.json`. Flat JSON, `snake_case` keys.
- Loaded by `core/i18n/transloco-loader.ts` from `${environment.baseURL}assets/i18n/<lang>.json`
  (absolute URL — required for SSR; don't change it).
- Config in `app.config.ts`: `provideTransloco({ availableLangs: ['en','fr'], defaultLang: 'en', … })`.
- **Every new key goes into BOTH `en.json` and `fr.json`.** A key present in en but missing in fr will
  render the key literal (or fall back) in French — that's a bug.
- Bengali (`bn`) is planned but **not yet wired** — do **not** add a `bn.json` or a third lang unless the
  owner tells you to (§8 item 4).

---

## 7. Definition of done & verification (run from repo root, Node 24)

Run these after each task and before declaring done:

```bash
nvm use                                   # Node 24
pnpm --filter @saha-textile/storefront build      # client + SSR + Nitro must exit 0
pnpm --filter @saha-textile/storefront typecheck  # 0 errors  (or: nx/ng typecheck as wired)
pnpm --filter @saha-textile/storefront lint        # 0 errors/warnings
```

(If a script name differs, check `apps/storefront/package.json` `scripts` and use the real one — do not
invent scripts.)

**i18n-specific runtime check (the important one):**

1. Start the dev server (`pnpm --filter @saha-textile/storefront dev`, or the `dev` script; Node 24).
2. Open each affected page in the browser. Transloco logs **`Missing translation for '<key>'`** to the
   console for any key you referenced but didn't add to the active lang's JSON. **Zero such warnings =
   pass.** Fix every one.
3. Toggle the language switcher (en↔fr) and eyeball: all static chrome flips; names/emails/prices/CMS
   bodies do not.
4. Confirm SSR still active (`ng-server-context="ssr"` in view-source) and no console errors/overlays.

**Done means:** build green, typecheck clean, lint clean, zero missing-translation warnings on every
touched page, language toggle visibly correct, layout/markup visually unchanged from before your edits.

---

## 8. STOP-and-ask list (do not assume — get an owner answer first)

1. **500 page image asset** — is there a `500.png` (or which image) to use in `assets/images/inner-page/`?
   If none exists, should I reuse `404.png` for now or wait for an asset?
2. **500 message source** — reuse the existing `SiteConfigStore.error_page` content (same as 404), or a
   dedicated static Transloco fallback key (e.g. `internal_server_error_message`)? Do not wire until told.
3. **TS-origin string translation pattern** — for static strings set in component `.ts` (breadcrumb
   titles like `'Log in'`, toast/validation text): the standard is either (a) store a **key** and pipe
   it in the template/child component, or (b) translate imperatively via `TranslocoService.translate(key)`
   in the component. There isn't an established convention visible yet. **Which pattern does the owner
   want?** Pick one and apply it uniformly — do not mix both.
4. **Languages** — stay on `en` + `fr` only for this pass? (bn planned but not wired — confirm it stays
   out of scope.)
5. **French values** — for new keys, is best-effort French acceptable (flagged for review), or should
   fr values be left as the English string / a placeholder pending a translator?
6. **Ambiguous static-vs-dynamic calls** — if you find a string you genuinely can't classify (e.g. a
   label that might be CMS-driven), list it and ask rather than guessing.

If anything else is unclear, ask. A wrong assumption that gets pattern-copied across dozens of files is
far more expensive than a question.

---

## 9. Do-NOT list (stay in scope / avoid collisions)

- **Do NOT** move, rename, or re-route the auth/account/maintenance/404 components — they're already
  placed (§0).
- **Do NOT** change markup, CSS classes, layout, or component structure. i18n = wrap strings only.
  UI is a locked verbatim Fastkart port.
- **Do NOT** translate customer data or CMS `[innerHTML]` content.
- **Do NOT** swap/introduce state libraries, convert file routes to Angular Router, add route groups,
  or "modernize" anything.
- **Do NOT** add `bn.json` or a third language.
- **Do NOT** touch the PDP component files aggressively — another Claude session is actively building
  PDP. Do the PDP i18n sweep **last**, string-wrapping only, and pause + flag on any collision.
- **Do NOT** delete anything or refactor beyond the three tasks. No opportunistic cleanups.

Work task-by-task, keep the build green between tasks, and check in with the owner at each STOP-and-ask
point.
