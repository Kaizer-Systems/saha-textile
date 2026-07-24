# Handoff → Claude Code (PDP session): i18n reconciliation for the product-config parts

> **How to use this file:** paste it into the Claude Code chat that is building the PDP
> configurator when you next touch it. It captures the i18n architecture that was **locked
> by the owner on 2026-07-18** (in the Cursor session) so the two sessions don't fight over
> the same shared files. Nothing here was changed in your PDP files yet — this is a request
> to reconcile them against the locked doctrine.

---

## 1. Context — what the Cursor session did (so you know the surrounding state)

The Cursor session completed a storefront i18n + error/status-page pass and an admin follow-up
pass. Relevant outcomes for you:

- The storefront runs **Transloco** (`en` + `fr` today; English primary, more languages added
  later — `bn` in the KB is just an example). Keys live in
  `apps/storefront/public/assets/i18n/{en,fr}.json`.
- Static labels set in component `.ts` use the reactive helper
  `translatedBreadcrumb()` (`apps/storefront/src/app/shared/util/breadcrumb-i18n.ts`) →
  `TranslocoService.selectTranslate`, so they re-translate on language switch.
- 404 / 500 / Maintenance page copy is now Machine-1 (Transloco keys), not admin-editable.
- The admin app was migrated `ngx-translate` → Transloco; `image_tile` / `radio_bar` display
  styles were exposed in the admin attribute form as **"Image V2" / "Radio Bar"**.
- Full details in `owner-decisions-log.md` (sections dated 2026-07-17 and 2026-07-18).

## 2. The locked i18n doctrine — "Machine 1 vs Machine 2"

**Single source of truth: the locale in the URL** (`core/i18n/locale.ts`). Both machines key
off it, so a language switch drives both together.

### Machine 1 — UI chrome → Transloco keys

Fixed, developer/translator-owned labels that exist regardless of catalog content: buttons,
headings, tab labels, section titles, validation/empty-state text, breadcrumb titles, and
general one-time chrome. Stored in `i18n/<lang>.json`, consumed via `| transloco`.

Owner-confirmed **Machine 1** examples: `Customer Service`, `Help Center`, `Authentication`,
`Popular Categories`, `Popular Tags`, `Overall Rating`, `Product Review`. Also the
mega-menu + footer navigation (developer-owned → Machine 1).

### Machine 2 — catalog/CMS content → DB-localized, rendered RAW (never Transloco)

Everything the shop admin authors/edits. Future storage = MongoDB localized fields
(`name: { en, fr, … }`); the **API resolves to the URL locale server-side and returns plain
strings** the client renders raw. **Interim (pre-API, English-only mock JSON): render raw — do
NOT pipe through Transloco.**

> Piping catalog data through `| transloco` is **banned**: it can never be complete, it
> pollutes `en.json`, and it spams `Missing translation …` warnings that destroy the QA signal
> (that same pass surfaced ~1,143 such warnings, most from mis-piped catalog data).

### Owner Decision 1 (LOCKED)

**Attribute/option-group labels, option/term VALUES, and all sizing/measurement fields are
ALWAYS Machine 2.** e.g. attribute names, `Blouse Design` / `Petticoat Size` group labels, term
values like `Green`, `Maroon / Zari`, `M`, `Design 1`, `Unstitched Piece`, and measurement
field labels. None of these are Transloco keys.

### Owner note on sizing/measurement (LOCKED, important for PDP)

Sizing/measurement is **NOT a standard fixed set**. Do **not** hardcode the same four fields
(`Chest / Shoulder / Waist / Sleeve`) everywhere. The owner intends measurement/sizing to be
modeled as its **own reusable entities — akin to "variation-axis definitions"** — defined once,
then **pulled into product/service setup only where relevant**, and **retrieved for PDP display
from data** (per product/service). So the measurements form should ultimately render whatever
fields the product's data specifies, and those labels are Machine 2 (raw / DB-localized).

### Owner Decision 2 (LOCKED)

Mega-menu + footer navigation are **developer-owned → Machine 1** (keyed in `en/fr.json`, not
admin-editable). Not your file, but noted so the doctrine is complete.

## 3. Files you own that need reconciliation

These `shared/ui/product-config/parts/*` (+ the shared cart-line summary) currently pipe
**Machine-2 data** through `| transloco`. Per Decision 1 they should render **raw** (remove the
pipe); revisit only when the API delivers locale-resolved strings.

| File                                                                          | Current                                                                                                                     | Action                                                                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/ui/product-config/parts/option-swatch/option-swatch.html`             | `{{ t.label \| transloco }}` (lines ~23, 40, 62, 76, 95, 109) — term values `Green` / `M` / `Design 1` / `Unstitched Piece` | **Remove `\| transloco`** (Machine 2). Keep `price_delta \| currencySymbol` as-is.                                                                    |
| `shared/ui/product-config/parts/attributes-info/attributes-info.html`         | `{{ attr.label \| transloco }}` (line ~10)                                                                                  | **Remove `\| transloco`** (Machine 2).                                                                                                                |
| `shared/ui/product-config/parts/bundle-configurator/bundle-configurator.html` | `a.label`, `group.label`, `selectedTermLabel(group)` piped (lines ~29, 98)                                                  | **Remove `\| transloco`** on all three (Machine 2).                                                                                                   |
| `shared/ui/product-config/parts/addon-group/addon-group.html`                 | `{{ 'required_addon' \| transloco }}: {{ group.label \| transloco }}` (line ~5)                                             | Keep `required_addon` (**Machine 1** — key exists); **remove `\| transloco`** from `group.label` (Machine 2).                                         |
| `shared/ui/product-config/parts/measurements-form/measurements-form.html`     | `{{ field.label \| transloco }}` (line ~14)                                                                                 | **Remove `\| transloco`** (Machine 2). Also align to the data-driven measurement-entity model above — don't assume a fixed 4-field template.          |
| `shared/ui/cart-line-config/cart-line-config.html`                            | `o.value`, `m.label` piped (lines ~12, 20, 34)                                                                              | **Remove `\| transloco`** (Machine 2). ⚠️ **Shared component** — used in cart / order summary as well as PDP; coordinate so the change is consistent. |

**Genuine Machine-1 chrome inside PDP widgets that instead needs KEYS** (these are literal
display strings piped through Transloco, so they currently warn — fix by keying them, don't
un-pipe): e.g. `product-review.html` uses `{{ 'Overall Rating' \| transloco }}` (line ~15) and
`{{ 'Edit review' … \| transloco }}` (line ~53). These should become proper keys
(`overall_rating`, `edit_review`, …) in `en/fr.json`. (The Cursor session will fold the
storefront-general chrome — including `Overall Rating` / `Product Review` — into `en/fr.json`;
flag any PDP-widget chrome you add so the keys stay in one place and don't collide.)

## 4. Scope boundary between the two sessions

- **You (PDP session):** the `product-config/parts/*` files + `cart-line-config` above.
- **Cursor session (storefront-general):** adding Machine-1 keys for the general chrome
  (Customer Service, Help Center, Authentication, Popular Categories/Tags, Overall Rating,
  Product Review), fixing the mega-menu/footer to key off `menu.ts` data, and un-piping
  Machine-2 category/tag names in home/collection/header/product-box.

Please **do not** edit `menu.ts` / footer / `i18n/*.json` category-name handling — those belong
to the storefront-general pass to avoid merge conflicts. If you must add a PDP-chrome key,
mention it explicitly so it can be reconciled into `en/fr.json` centrally.

## 5. TL;DR for the PDP session

1. Remove `| transloco` from all **term values, attribute/group labels, and measurement field
   labels** in `product-config/parts/*` and `cart-line-config` → render raw (Machine 2).
2. Treat measurement fields as **data-driven** (variation-axis-like entities), not a fixed
   4-field constant.
3. Keep/add Transloco **keys** only for genuine fixed chrome; surface any new PDP-chrome keys
   for central reconciliation into `en/fr.json`.
4. Everything admin-authored is Machine 2 and will be locale-resolved by the API later — never
   route it through Transloco.
