# Saha Textile Pending Decision Worksheet

Status: Owner-fillable worksheet, not locked source of truth yet.

Date prepared: 2026-07-10

Purpose:

This document expands the pending decision calls surfaced from the Angular-context KB into a fillable worksheet. Each decision includes:

1. What needs to be decided.
2. Why it matters.
3. Recommended route.
4. Options in priority order.
5. Pros and cons for each option.
6. Owner answer space.

How to fill:

- For each decision, write `A`, `B`, `C`, or `Custom`.
- If choosing `Custom`, describe the desired rule.
- If you agree with the recommended route, write `A` unless the recommendation says otherwise.
- Short answers are fine. Example: `A, but COD cap should be INR 5000`.

Important:

- This worksheet intentionally does not lock decisions by itself.
- Once answers are confirmed, the final decisions should be written into `owner-decisions-log.md`, then reconciled into the relevant KB files.

---

## 01. Invoice, Order, Tax-Invoice, And Purchase-Invoice Numbering

### 01.1 Decision Needed

Choose the human-readable numbering policy for:

1. Customer order numbers.
2. Tax invoice numbers.
3. Purchase invoice numbers.
4. Any future credit note, refund note, or return document sequence.

### 01.2 Why This Matters

This affects checkout, invoicing, GST/accounting records, audit logs, admin search, customer order emails, PDFs, and future migration safety. The KB already warns this is a must-ask gate before building checkout/invoicing.

India GST invoice numbering constraints to respect:

1. Must be unique.
2. Must be consecutive/gapless for the relevant accounting period where legally required.
3. Must be at most 16 characters for tax invoice numbers.
4. Can use alphanumeric characters plus `/` and `-`.
5. Should not delete invoices to "fix" gaps. Use cancel/void status instead.

### 01.3 Recommended Route

Use separate FY-reset sequences for each document family:

- Order number: `STO/26-27/0001` or shorter equivalent.
- Tax invoice number: `ST/26-27/0001`.
- Purchase invoice internal number: `STP/26-27/0001`.

If the invoice number length is too close to 16 characters, use shorter prefixes such as `S/26-27/0001`.

### 01.4 Options

#### Option A - Recommended: FY-reset counter with separate sequences

Format example:

- Tax invoice: `ST/26-27/0001`
- Order: `O/26-27/0001`
- Purchase invoice: `P/26-27/0001`

Pros:

1. Best fit for Indian FY reporting.
2. Easier accountant/admin reconciliation.
3. Keeps order, sale invoice, and purchase invoice sequences cleanly separate.
4. Works naturally with the locked IST/FY policy where FY starts on 1 Apr.
5. Future credit notes/refund notes can get their own sequence without corrupting order numbers.

Cons:

1. Needs careful sequence service and transaction handling.
2. Must handle FY rollover correctly at midnight IST on 1 Apr.
3. Must be careful with 16-character invoice limit.

Implementation notes:

1. Store sequence records in a `sequences` collection.
2. Increment inside Mongo transaction where the document is created.
3. Never reuse cancelled numbers.
4. Each document family gets its own sequence key.

#### Option B - Perpetual counter

Format example:

- `ST/00000042`

Pros:

1. Simple to implement.
2. No FY rollover edge case.
3. Easy global search.

Cons:

1. Less natural for Indian FY accounting.
2. Admin reports need date filters rather than number pattern for FY separation.
3. Does not communicate financial period in the number.

#### Option C - Date-based number

Format example:

- `ST/260710/0042`

Pros:

1. Human-readable date context.
2. Easy to eyeball approximate order/invoice date.

Cons:

1. Can become awkward with gapless legal sequences.
2. Daily counters can create operational confusion.
3. More fragile around late-night IST/customer-time differences.

### 01.5 Owner Answer

Owner choice:

Notes:

---

## 02. Tax Classes, GST Slabs, And HSN Granularity

### 02.1 Decision Needed

Decide how detailed the tax model should be for products, variants, invoices, and purchase invoices.

### 02.2 What Is Already Locked

1. Customer-facing prices are tax-inclusive.
2. Stored catalog selling prices are tax-inclusive.
3. Invoices still need a clear tax breakdown.
4. Order lines must snapshot tax values so later tax edits do not mutate historical orders.

### 02.3 Recommended Route

Use product/variant-level tax class assignment with category defaults. Store HSN on the product/variant where needed, and snapshot resolved tax class, HSN, rate, taxable base, and tax amount on every order line.

### 02.4 Options

#### Option A - Recommended: Category default plus product/variant override

Pros:

1. Best balance of admin ergonomics and correctness.
2. Category defaults reduce repetitive product setup.
3. Product/variant overrides handle exceptions.
4. Supports fabric vs stitched garment differences if applicable.
5. Good for future accounting/reporting exports.

Cons:

1. Requires tax-class admin UI.
2. Requires validation that every published product resolves to a tax class.
3. Needs accountant/client confirmation of GST/HSN mapping.

#### Option B - Product/variant-level only

Pros:

1. Most explicit.
2. No ambiguity from category placement.
3. Strong for multi-category products.

Cons:

1. More admin work per product.
2. Higher risk of missing tax data during upload.
3. Bulk upload/import must be more careful.

#### Option C - One global GST/tax rule

Pros:

1. Fastest to build.
2. Simple checkout math.
3. Least admin UI.

Cons:

1. Too brittle if GST slabs differ by product type.
2. Not future-proof for stitched/customized goods.
3. Harder to correct later after orders exist.

### 02.5 Owner Answer

Owner choice:

HSN requirement:

Accountant confirmation needed:

Notes:

---

## 03. Launch Payment Methods

### 03.1 Decision Needed

Choose which payment methods launch, and what limits apply.

### 03.2 What Is Already In The KB

1. INR checkout should go through CCAvenue when live credentials exist.
2. Non-INR checkout should go through PayPal.
3. Payment providers remain behind `PaymentGatewayPort`.
4. Real provider wiring happens only after credentials/access are available.

### 03.3 Recommended Route

Launch with online payments as the primary path, keep COD as an optional controlled method for domestic India, and do not build split/partial payments at launch.

### 03.4 Options

#### Option A - Recommended: Online payments plus capped COD

Pros:

1. Good conversion for India.
2. COD is available but controlled.
3. Online payments remain the clean default.
4. COD cap protects high-value inventory.
5. Fits boutique operations without overbuilding.

Cons:

1. COD requires order confirmation and cancellation handling.
2. COD increases failed delivery/return risk.
3. Admin needs COD status visibility.

Recommended COD constraints if chosen:

1. Domestic India only.
2. Maximum order value cap, for example INR 5,000 or INR 10,000.
3. Disable COD for custom stitched / made-to-order / non-returnable items if needed.
4. Optional phone confirmation before dispatch.

#### Option B - Online payments only

Pros:

1. Simplest operationally.
2. Lower fake-order risk.
3. Cleaner payment reconciliation.
4. Better fit for custom products.

Cons:

1. May reduce conversion with Indian customers who expect COD.
2. No fallback for customers uncomfortable with online payment.

#### Option C - Online payments plus COD plus manual UPI proof

Pros:

1. Maximum customer flexibility.
2. Useful if gateway onboarding is delayed.
3. UPI manual can work for small owner-operated launch.

Cons:

1. Manual proof review adds admin workload.
2. Risk of fake/duplicate payment screenshots.
3. Requires pending-payment order flow.
4. Less elegant than a proper gateway flow.

### 03.5 Owner Answer

Owner choice:

COD cap, if any:

Manual UPI allowed:

Notes:

---

## 04. Shipping Model

### 04.1 Decision Needed

Choose how shipping is calculated at launch and how provider quotes fit in.

### 04.2 Recommended Route

Use zone plus weight tiers with a free-shipping threshold, and keep Shiprocket/provider quotes behind `ShippingPort` for later or sandbox mode.

### 04.3 Options

#### Option A - Recommended: Zone plus weight tiers with free-shipping threshold

Pros:

1. Predictable for customers and admin.
2. Does not block launch on provider credentials.
3. Works for domestic India immediately.
4. Can still hand off to Shiprocket later.
5. Supports free shipping campaigns cleanly.

Cons:

1. May not match exact courier cost every time.
2. Needs zone/rate setup in admin.
3. International rates still need special handling.

Suggested launch structure:

1. Domestic India zones.
2. Weight bands.
3. Free shipping threshold.
4. Optional remote-area surcharge later.
5. International shipping disabled or manual quote until provider flow is ready.

#### Option B - Flat domestic rate

Pros:

1. Easiest to communicate.
2. Fastest to build.
3. Good if products have similar shipping cost.

Cons:

1. Can undercharge heavy orders.
2. Can overcharge small orders.
3. Weak future fit for larger catalog.

#### Option C - Live provider quote only

Pros:

1. Most accurate courier pricing.
2. Better for weight/location differences.
3. Reduces manual rate maintenance.

Cons:

1. Requires live provider readiness.
2. Checkout depends on third-party quote uptime.
3. Needs fallback when provider fails.

### 04.4 Owner Answer

Owner choice:

Free-shipping threshold:

International shipping at launch:

Notes:

---

## 05. Returns And Refunds Policy

### 05.1 Decision Needed

Define return window, non-returnable products, refund method, and whether returns are a self-service portal or manual workflow.

### 05.2 Recommended Route

Use a simple manual return/refund workflow at launch, with structured policies and reason codes in the DB.

### 05.3 Options

#### Option A - Recommended: 7-day return window with exclusions

Pros:

1. Clear customer policy.
2. Structured enough for admin and reporting.
3. Avoids overbuilding a full RMA portal.
4. Supports non-returnable custom/stitching rules.
5. Fits boutique operations.

Cons:

1. Manual support still required.
2. Policy must be displayed clearly.
3. Edge cases need owner/admin judgment.

Suggested rules:

1. 7 days from delivery.
2. Damaged/wrong item eligible.
3. Custom stitched/altered items non-returnable unless defective.
4. Clearance/final-sale items optionally non-returnable.
5. Refund to original method where possible, otherwise store credit/manual adjustment.

#### Option B - Case-by-case manual returns only

Pros:

1. Maximum owner flexibility.
2. Minimal system complexity.
3. Good for early boutique operations.

Cons:

1. Less clear to customers.
2. Harder to automate emails/statuses.
3. Weaker reporting.

#### Option C - Full self-service RMA portal at launch

Pros:

1. Most polished customer workflow.
2. Reduces support messages later.
3. Strong structured data.

Cons:

1. Too much launch scope.
2. Requires more status logic, uploads, courier flow, refund automation.
3. Not necessary for the current scale.

### 05.4 Owner Answer

Owner choice:

Return window:

Non-returnable categories/items:

Refund methods:

Notes:

---

## 06. Promotion And Coupon Stacking

### 06.1 Decision Needed

Define how automatic promotions, manual coupons, sale prices, flash sales, cart discounts, and product/category discounts interact.

### 06.2 Recommended Route

Allow one coupon per order. Allow automatic promotions only when they are explicitly marked stackable. Exclude sale/clearance items by default unless a promotion overrides that rule.

### 06.3 Options

#### Option A - Recommended: One coupon plus controlled automatic stacking

Pros:

1. Predictable discount behavior.
2. Reduces accidental deep discounting.
3. Still supports elegant campaigns.
4. Easier customer explanation.
5. Works well with scoped promotions.

Cons:

1. Requires priority/stackable fields.
2. Admin must understand the stacking toggle.
3. Testing matrix is larger than no-stacking.

Recommended rules:

1. One manual coupon per order.
2. Product sale price applies first.
3. Automatic promotion can stack only if `stackable = true`.
4. Coupon can exclude sale/clearance items.
5. Use best-price selection when multiple automatic promos compete.
6. Snapshot all applied promotions on order lines.

#### Option B - No stacking at all

Pros:

1. Safest financially.
2. Easy to build.
3. Easy to explain.

Cons:

1. Less flexible marketing.
2. Harder to run polished campaigns.
3. May frustrate customers expecting coupon over sale.

#### Option C - Multiple coupons and multiple promotions

Pros:

1. Maximum marketing power.
2. Supports complex campaign strategies.

Cons:

1. High risk of discount leaks.
2. Harder admin UX.
3. More complicated checkout explanations.
4. Not needed for boutique launch.

### 06.4 Owner Answer

Owner choice:

Can coupons apply on sale items:

Can automatic promos stack:

Notes:

---

## 07. Stock Reservation Timing

### 07.1 Decision Needed

Choose when stock is reserved and when it is permanently decremented.

### 07.2 Recommended Route

Do not reserve stock at add-to-cart. Soft-reserve at checkout start for a short TTL. Hard-decrement only after order placement/payment policy succeeds.

### 07.3 Options

#### Option A - Recommended: Soft reserve at checkout start

Pros:

1. Protects serious buyers without letting abandoned carts lock stock.
2. Works well with low inventory boutique products.
3. Gives checkout a stable stock view.
4. Reservation expiry can release abandoned checkout holds.

Cons:

1. Requires reservation records or cart-line reservation state.
2. Needs expiry cleanup.
3. Requires careful payment failure handling.

Suggested TTL:

1. 10 to 15 minutes for active checkout.
2. Extend only when user is actively interacting.
3. Release on payment failure, timeout, or checkout abandon.

#### Option B - Decrement only when order is placed or paid

Pros:

1. Simple.
2. No reservation cleanup.
3. Easy to reason about.

Cons:

1. Two customers may reach checkout for the last item.
2. Higher oversell risk.
3. Worse for one-off products.

#### Option C - Reserve on add-to-cart

Pros:

1. Strongest stock protection for cart holder.
2. Fewer checkout disappointments.

Cons:

1. Abandoned carts block real inventory.
2. Bad fit for guest carts with 30-day TTL.
3. Creates support/admin frustration.

### 07.4 Owner Answer

Owner choice:

Reservation TTL:

Notes:

---

## 08. Backorder And Oversell Policy

### 08.1 Decision Needed

Decide whether customers can buy products whose stock is zero or insufficient.

### 08.2 Recommended Route

Hard-block at zero by default. Allow a per-product backorder/preorder toggle only where the business explicitly supports it.

### 08.3 Options

#### Option A - Recommended: Hard-block by default, per-product backorder toggle

Pros:

1. Safest for boutique ready-stock inventory.
2. Prevents accidental overselling.
3. Still supports future made-to-order/preorder products.
4. Easy public UX: out-of-stock means unavailable unless explicitly marked preorder.

Cons:

1. Admin must set backorder-enabled items deliberately.
2. Requires clear labels for preorder/backorder.

Recommended low-stock badge defaults:

1. Product-level threshold, fallback category threshold.
2. Default threshold: 2 or 3 units.
3. Hide exact stock from customers unless intentionally shown.

#### Option B - Always allow backorder

Pros:

1. Never loses a sale due to stock count.
2. Useful for made-to-order catalog.

Cons:

1. High fulfillment risk.
2. Bad customer experience if delays are unclear.
3. Not aligned with normal ready-stock retail.

#### Option C - Never allow backorder

Pros:

1. Cleanest inventory rule.
2. Simple checkout logic.
3. Lowest fulfillment risk.

Cons:

1. No future preorder/made-to-order flexibility.
2. Admin must manually restock before selling.

### 08.4 Owner Answer

Owner choice:

Default low-stock threshold:

Backorder allowed for any launch products:

Notes:

---

## 09. Cart-To-Order Snapshot Field Set

### 09.1 Decision Needed

Confirm exactly what is copied from cart/catalog into immutable order lines.

### 09.2 Recommended Route

Use a rich but bounded immutable snapshot. Do not store a full product clone, but snapshot everything needed for legal, customer, support, refund, and reporting history.

### 09.3 Options

#### Option A - Recommended: Rich bounded order-line snapshot

Snapshot:

1. Product id.
2. Variant id.
3. Product title at purchase time.
4. Variant display title/options at purchase time.
5. SKU.
6. Product slug/canonical path at purchase time.
7. Primary image/media key.
8. Selected variation options.
9. Selected named add-ons.
10. Measurement/customization values.
11. Quantity.
12. Unit price INR.
13. Sale price/compare-at context if relevant.
14. Discount allocations.
15. Tax class id/name.
16. HSN.
17. Tax rate.
18. Taxable base.
19. Tax amount.
20. Tax-inclusive flag.
21. Display currency.
22. FX rate/source/date.
23. Display unit price.
24. Line total.
25. Category snapshot for reporting.
26. Product status at purchase time if useful.
27. Cost layer/COGS snapshot once inventory is wired.

Pros:

1. Historical orders remain correct after catalog edits.
2. Supports invoices, refunds, analytics, and customer support.
3. Keeps snapshots durable but not wastefully huge.

Cons:

1. More mapping code.
2. Needs careful contracts.
3. Must stay stable once orders exist.

#### Option B - Minimal snapshot plus product reference

Snapshot:

1. Product id.
2. Variant id.
3. Quantity.
4. Unit price.
5. Tax.

Pros:

1. Smallest order documents.
2. Fastest to build.

Cons:

1. Catalog edits can make historical displays inaccurate.
2. Weak for invoice/support history.
3. Not future-proof.

#### Option C - Full product document copy

Pros:

1. Maximum historical detail.
2. Very easy to inspect old state.

Cons:

1. Bloats orders.
2. Copies unnecessary fields.
3. Can preserve irrelevant admin/product data.

### 09.4 Owner Answer

Owner choice:

Fields to add/remove from recommended snapshot:

Notes:

---

## 10. Address Model And Checkout Phone Requirement

### 10.1 Decision Needed

Choose how customer addresses work and whether phone is required at checkout.

### 10.2 What Is Already Locked

Phone is not required at registration. It is collected at checkout/address stage.

### 10.3 Recommended Route

Support multiple saved addresses per user, with default shipping and default billing. Require phone for shipping at checkout.

### 10.4 Options

#### Option A - Recommended: Multiple addresses with required checkout phone

Pros:

1. Normal e-commerce UX.
2. Supports repeat customers.
3. Phone requirement matches courier reality.
4. Billing can reuse shipping by default.
5. Future guest checkout seam remains possible.

Cons:

1. More address UI and validation.
2. Needs default-address logic.
3. Needs duplicate/invalid address handling.

Recommended fields:

1. Full name.
2. Phone.
3. Alternate phone optional.
4. Address line 1.
5. Address line 2 optional.
6. Landmark optional.
7. City.
8. State.
9. Postal code.
10. Country.
11. Address type label: home, work, other.
12. Default shipping flag.
13. Default billing flag.

#### Option B - One saved address per user

Pros:

1. Simpler account UI.
2. Faster to build.

Cons:

1. Weak repeat-customer UX.
2. Later migration needed for multiple addresses.
3. Billing/shipping separation becomes awkward.

#### Option C - Full billing and shipping separation from day one

Pros:

1. Most complete.
2. Useful for gift orders and B2B-like flows.
3. Clean accounting for different billing identity.

Cons:

1. More checkout complexity.
2. More validation and UI.
3. May be overkill at launch.

### 10.5 Owner Answer

Owner choice:

Phone required at checkout:

Billing same as shipping by default:

Notes:

---

## 11. SKU Strategy

### 11.1 Decision Needed

Choose how product and variant SKUs are created and controlled.

### 11.2 Recommended Route

Auto-generate globally unique SKUs with an admin override.

### 11.3 Options

#### Option A - Recommended: Auto-generate with admin override

Example:

- Product code: `SAR-000123`
- Variant SKU: `SAR-000123-D1-BLK`

Pros:

1. Reduces admin typing.
2. Keeps SKUs consistent.
3. Supports imported legacy SKU corrections.
4. Works well with variation axes.
5. Globally unique SKU makes search/admin operations simpler.

Cons:

1. Needs generation rules.
2. Needs collision checks.
3. Admin override must be validated.

#### Option B - Admin-entered only

Pros:

1. Maximum business control.
2. Easy to match existing physical labels.

Cons:

1. Typos and duplicates likely.
2. Slower product creation.
3. More validation errors.

#### Option C - System-only immutable SKU

Pros:

1. Cleanest consistency.
2. No duplicate admin input.

Cons:

1. Less flexible with legacy stock.
2. Harder if supplier/internal SKU already exists.
3. Admin may need a separate display code anyway.

### 11.4 Owner Answer

Owner choice:

Desired prefix format:

Admin override allowed:

Notes:

---

## 12. Per-Variant Override Fields

### 12.1 Decision Needed

Decide which fields a product variant can override from its parent product.

### 12.2 Recommended Route

Allow variants to override selling price, sale price, stock, media, weight/dimensions, barcode, and SKU. Keep core content inherited unless a clear future need appears.

### 12.3 Options

#### Option A - Recommended: Practical commerce overrides

Variant override fields:

1. SKU.
2. Price.
3. Sale price.
4. Compare-at/MRP.
5. Stock.
6. Primary image/gallery subset.
7. Weight.
8. Dimensions.
9. Barcode.
10. Availability/status.

Pros:

1. Covers real variable-product needs.
2. Supports design/image/price differences.
3. Supports shipping differences.
4. Avoids duplicating full content per variant.

Cons:

1. More complex variant form.
2. Needs inheritance display in admin.

#### Option B - Minimal overrides

Variant override fields:

1. SKU.
2. Price.
3. Stock.
4. Image.

Pros:

1. Simple admin UI.
2. Enough for many products.

Cons:

1. Weak for shipping/barcode/MRP.
2. May require schema changes later.

#### Option C - Every field overrideable

Pros:

1. Maximum flexibility.
2. Can model variant-specific content/SEO.

Cons:

1. Admin UI becomes noisy.
2. Easy to create inconsistent product pages.
3. More translation burden.

### 12.4 Owner Answer

Owner choice:

Fields to include/exclude:

Notes:

---

## 13. MRP, Compare-At Price, Sale Price, And Price Range Display

### 13.1 Decision Needed

Choose how MRP/regular price/sale price are stored and displayed.

### 13.2 Recommended Route

Store MRP/compare-at and sale/current selling price per variant. On listing cards, show a single price when all purchasable variants resolve to one effective price; show a range when they differ.

### 13.3 Options

#### Option A - Recommended: Variant-level MRP and sale price

Pros:

1. Correct for design/stitching options with different prices.
2. Allows accurate strike-through display.
3. Supports variant-specific discounting.
4. Works with immutable order snapshots.

Cons:

1. Requires more variant data entry.
2. Product cards need min/max price logic.
3. Admin import must map prices carefully.

Display rules:

1. If one effective price: show `₹2,100`.
2. If price range: show `₹1,200 - ₹2,100`.
3. If sale active: show sale price plus strike-through MRP.
4. Do not show misleading "from" unless design supports it.

#### Option B - Product-level MRP only

Pros:

1. Simpler admin entry.
2. Cleaner product form.

Cons:

1. Wrong when variants have different regular prices.
2. Weak for real Saha design/stitching pattern.
3. Requires exceptions later.

#### Option C - No MRP, only effective selling price

Pros:

1. Clean minimal UI.
2. No fake discount risk.
3. Fast to implement.

Cons:

1. Loses common Indian retail sale convention.
2. No strike-through sale display.
3. Harder to run visual promotions.

### 13.4 Owner Answer

Owner choice:

Show strike-through MRP:

Show product-card price ranges:

Notes:

---

## 14. Add-On Price Deltas And Measurement Validation

### 14.1 Decision Needed

Define launch rules for named add-ons like blouse design and measurement fields.

### 14.2 What Is Already Locked

1. Saree-attached blouse design is a named add-on group, not a forced saree variant matrix.
2. Default option can be `No Design`.
3. Future groups like `Aachol/Churni Design` are allowed.
4. Measurement fields are captured per cart/order line.

### 14.3 Recommended Route

Use reusable add-on templates with price deltas and structured measurement schemas. Validate min/max/step/unit both client-side and server-side.

### 14.4 Options

#### Option A - Recommended: Structured add-on templates

Pros:

1. Best long-term fit for tailoring/customization.
2. Avoids product-by-product hardcoding.
3. Supports conditional measurement requirements.
4. Snapshots cleanly on order lines.
5. Admin can reuse templates.

Cons:

1. Needs template UI.
2. Needs measurement validation rules.
3. Requires careful cart signature logic.

Recommended measurement fields:

1. Chest.
2. Waist.
3. Shoulder.
4. Sleeve length.
5. Blouse length.
6. Armhole optional.
7. Notes optional.

Recommended validation:

1. Unit: inches.
2. Decimal step: 0.25 or 0.5.
3. Min/max per field.
4. Required only when stitched/design option requires it.

#### Option B - Product-specific measurement fields

Pros:

1. Flexible per product.
2. Faster for small catalog.

Cons:

1. Repetition across products.
2. Harder to report/validate consistently.
3. More admin mistakes.

#### Option C - Free-text measurement notes only

Pros:

1. Fastest to launch.
2. Customer can explain unusual needs.

Cons:

1. Poor validation.
2. Fulfillment ambiguity.
3. Bad for structured order display.

### 14.5 Owner Answer

Owner choice:

Launch add-on price deltas:

Measurement fields:

Notes:

---

## 15. Product Relations

### 15.1 Decision Needed

Decide how related products, cross-sells, upsells, substitutes, bought-together products, and storefront rails are populated.

### 15.2 Recommended Route

Use curated relations first, with analytics fallback where curated data is missing.

### 15.3 Options

#### Option A - Recommended: Curated relations plus analytics fallback

Pros:

1. Preserves brand/merchandising control.
2. Prevents random low-quality recommendations.
3. Uses analytics when admin has not curated.
4. Fits boutique elegance.

Cons:

1. More implementation than curated-only.
2. Needs rules for fallback ranking.

#### Option B - Curated only

Pros:

1. Highest quality control.
2. Simple to explain.
3. No surprising recommendations.

Cons:

1. Admin work required for every product.
2. Sparse new products may have empty related sections.

#### Option C - Analytics only

Pros:

1. Scales automatically.
2. Learns from behavior.

Cons:

1. Bad for low traffic at launch.
2. Can feel generic.
3. Less owner control.

### 15.4 Owner Answer

Owner choice:

Relation types to launch:

Notes:

---

## 16. Bundle And Composite Product Nesting

### 16.1 Decision Needed

Decide whether bundle/composite products can contain other bundles.

### 16.2 Recommended Route

Support simple bundles/composites, but disallow nested bundles at launch.

### 16.3 Options

#### Option A - Recommended: No nested bundles at launch

Pros:

1. Keeps inventory validation sane.
2. Avoids complex recursive pricing.
3. Still preserves bundle/composite architecture.
4. Better scoped for boutique catalog.

Cons:

1. Cannot model set-inside-set products.
2. Would need later enablement if business truly needs nesting.

#### Option B - Allow maximum depth 2

Pros:

1. Supports limited nested kits.
2. Still bounded.

Cons:

1. More complex order snapshots.
2. More complex stock checks.
3. More admin confusion.

#### Option C - Unlimited nesting

Pros:

1. Maximum theoretical flexibility.

Cons:

1. Overbuilt for this store.
2. Easy to create circular/invalid products.
3. Harder testing.
4. Not recommended.

### 16.4 Owner Answer

Owner choice:

Any real launch product requiring nested bundles:

Notes:

---

## 17. Media, DigitalOcean Spaces, Image Derivatives, And Upload Workflow

### 17.1 Decision Needed

Choose how product/category/banner/media uploads are stored, transformed, served, and referenced.

### 17.2 What Is Already Locked

1. DigitalOcean Spaces is used for media.
2. Region is SGP.
3. MongoDB stores references/metadata, not binary media files.
4. Spaces can also later store cold archive JSON blobs.

### 17.3 Recommended Route

Use Spaces as the origin/CDN-backed media store. Upload through API-issued signed upload URLs or API-mediated upload flow. Store media metadata in Mongo. Generate responsive image derivatives and keep the original.

### 17.4 Options

#### Option A - Recommended: Spaces plus responsive derivative pipeline

Pros:

1. Best storefront performance.
2. Better Core Web Vitals.
3. Keeps droplet disk clean.
4. Supports product cards, PDP zoom, swatches, banners, and admin thumbnails.
5. Future-proof for AVIF/WebP.

Cons:

1. Needs upload and derivative worker logic.
2. Needs image metadata collection.
3. Needs cleanup policy for unused uploads.

Recommended derivative set:

1. Original retained.
2. Thumbnail for admin/selectors.
3. Product card size.
4. PDP gallery medium.
5. PDP zoom large.
6. Optional AVIF/WebP where conversion is safe.

Recommended metadata:

1. Storage key.
2. Public/CDN URL or resolvable key.
3. MIME type.
4. Width/height.
5. Size.
6. Alt text per locale.
7. Usage references.
8. Created by/admin id.
9. Status: temporary, active, orphaned, archived.

#### Option B - Spaces originals only, browser/CSS resizing

Pros:

1. Fastest to build.
2. Simple storage model.
3. Still keeps media out of Mongo.

Cons:

1. Large images hurt performance.
2. Poor mobile bandwidth usage.
3. Less polished product experience.

#### Option C - Proxy all media through API

Pros:

1. Strong access control.
2. Centralized logging.

Cons:

1. Wastes API/droplet bandwidth.
2. More latency.
3. Bad fit for public product media.
4. CDN becomes less effective.

### 17.5 Owner Answer

Owner choice:

Derivative sizes/formats:

Alt text required before publish:

Notes:

---

## 18. Manual Stock Adjustment Reason Codes

### 18.1 Decision Needed

Choose the reason-code taxonomy for manual inventory adjustments outside normal purchase invoice/order flows.

### 18.2 Recommended Route

Use fixed reason codes plus optional notes.

### 18.3 Options

#### Option A - Recommended: Fixed taxonomy plus notes

Pros:

1. Clean reports.
2. Prevents vague stock changes.
3. Supports audit trails.
4. Still allows explanation through notes.

Cons:

1. Admin must choose a reason.
2. Taxonomy may need occasional expansion.

Recommended reason codes:

1. Damage.
2. Lost/missing.
3. Manual recount/correction.
4. Supplier shortage.
5. Return restocked.
6. Return not restocked.
7. Internal use/sample.
8. Photoshoot/display use.
9. System migration correction.
10. Other, with mandatory note.

#### Option B - Free-text only

Pros:

1. Flexible.
2. Very fast to build.

Cons:

1. Poor reporting.
2. Inconsistent wording.
3. Harder fraud/error review.

#### Option C - Fixed codes only, no notes

Pros:

1. Very clean analytics.
2. Simple UI.

Cons:

1. Not enough context for unusual cases.
2. Admin may choose wrong code just to proceed.

### 18.4 Owner Answer

Owner choice:

Reason codes to add/remove:

Notes:

---

## 19. Customer Ledger, Store Credit, Wallet, And Points

### 19.1 Decision Needed

Decide whether `customer-ledger` is only a record/reporting surface at launch, or an active balance that customers can spend.

### 19.2 Recommended Route

Launch ledger-only with a store-credit seam. Do not launch wallet top-ups or loyalty points engine yet.

### 19.3 Options

#### Option A - Recommended: Ledger-only plus future store-credit seam

Pros:

1. Keeps launch accounting simpler.
2. Avoids wallet liability complexity.
3. Still lets admin view refund/adjustment history.
4. Preserves future points/store-credit model.

Cons:

1. Customers cannot spend store credit automatically at launch.
2. Refund-to-credit would be manual/deferred.

#### Option B - Active store credit at launch

Pros:

1. Useful for refunds/exchanges.
2. Customers can redeem balance.
3. Good retention tool.

Cons:

1. Requires balance ledger correctness.
2. More checkout complexity.
3. More accounting/liability considerations.

#### Option C - Full wallet plus top-up plus loyalty points

Pros:

1. Most feature-rich.
2. Strong retention/marketing possibilities.

Cons:

1. Too much launch scope.
2. Payment/accounting complexity.
3. Can degrade premium boutique simplicity.

### 19.4 Owner Answer

Owner choice:

Store credit at launch:

Points at launch:

Notes:

---

## 20. Reviews Policy

### 20.1 Decision Needed

Define who can review, what review content is allowed, and moderation rules.

### 20.2 What Is Already Partly Locked

Reviews require login and verified purchase. Guests/non-logged-in users see login-to-review.

### 20.3 Recommended Route

Allow logged-in verified purchasers to submit star rating plus text plus optional images. Moderate before public publish.

### 20.4 Options

#### Option A - Recommended: Verified purchase plus moderation

Pros:

1. Highest trust.
2. Lower spam risk.
3. Good fit for premium boutique presentation.
4. Supports image reviews without public abuse.

Cons:

1. Admin review queue required.
2. Reviews do not appear instantly.

#### Option B - Verified purchase, auto-publish

Pros:

1. Less admin work.
2. Faster social proof.
3. Still blocks fake non-purchaser reviews.

Cons:

1. Risk of inappropriate content.
2. Needs report/hide tooling.
3. Image reviews are riskier.

#### Option C - Anyone can review

Pros:

1. More review volume.
2. Lower friction.

Cons:

1. Lower trust.
2. Higher spam risk.
3. Not recommended for this brand standard.

### 20.5 Owner Answer

Owner choice:

Allow review images:

Moderation required:

Notes:

---

## 21. Public Track-Order Lookup

### 21.1 Decision Needed

Decide whether to build public order tracking and how identity is verified.

### 21.2 Current KB Status

Track order is deferred. It should be decided after full order/payment/shipping flow exists.

### 21.3 Recommended Route

Defer launch implementation, but when built use order number plus email/phone verification.

### 21.4 Options

#### Option A - Recommended: Defer, then order number plus email/phone verification

Pros:

1. Avoids premature workflow before shipping statuses exist.
2. Protects customer privacy.
3. Good guest-checkout seam later.
4. Works for both logged-in and future guest orders.

Cons:

1. No public track-order page at launch.
2. Customers must log in or use email/support until built.

#### Option B - Authenticated-only tracking

Pros:

1. Safest and simplest.
2. Reuses account order history.
3. No public lookup abuse.

Cons:

1. Less convenient.
2. Less future-friendly for guest checkout.

#### Option C - Public order number lookup only

Pros:

1. Very convenient.
2. Easy UX.

Cons:

1. Privacy risk.
2. Order numbers can be guessed/shared.
3. Not acceptable for detailed order data.

### 21.5 Owner Answer

Owner choice:

Build at launch:

Verification method:

Notes:

---

## 22. Soft Delete, Hard Delete, And Data Retention

### 22.1 Decision Needed

Choose when records are soft-deleted, hard-deleted, archived, or TTL-cleaned.

### 22.2 Recommended Route

Soft-delete/status-delete all durable business records. Hard-delete only transient TTL data or explicit legal/privacy purge flows.

### 22.3 Options

#### Option A - Recommended: Soft-delete durable records, TTL transient records

Pros:

1. Strong auditability.
2. Protects orders, catalog history, and admin accountability.
3. Safer rollback/restoration.
4. Works with product archive policy.

Cons:

1. Queries must filter status/deletedAt.
2. Storage grows over time.
3. Admin UI needs restore/archive semantics.

Recommended durable records:

1. Products.
2. Categories.
3. Orders.
4. Payments.
5. Shipments.
6. Returns/refunds.
7. Users, except privacy purge rules.
8. Promotions.
9. Tax/payment/shipping config versions.

Recommended transient TTL records:

1. OTP challenges.
2. OAuth state.
3. Password reset tokens.
4. Pending intents.
5. Expired guest carts.
6. Raw noisy analytics events after rollup.

#### Option B - Soft-delete only financial/catalog records

Pros:

1. Less storage than soft-delete everywhere.
2. Simpler for some minor collections.

Cons:

1. Inconsistent recovery model.
2. More chance of accidental permanent deletion.
3. Audit story varies by module.

#### Option C - Hard-delete broadly

Pros:

1. Less storage.
2. Simpler query filters.

Cons:

1. Dangerous for audit/history.
2. Bad for order/product references.
3. Not aligned with elevated admin standards.

### 22.4 Owner Answer

Owner choice:

Any records that should hard-delete:

Notes:

---

## 23. Audit Logging Scope And Retention

### 23.1 Decision Needed

Define what mutations are audited and how long audit logs are retained.

### 23.2 Recommended Route

Audit all admin writes plus all security-sensitive user/system actions. Keep financial/security/catalog audit for long retention, while raw analytics events can have short retention after rollup.

### 23.3 Options

#### Option A - Recommended: Broad admin/security audit

Audit:

1. Product create/update/archive/delete.
2. Category/facet/SEO changes.
3. Price/MRP/sale changes.
4. Stock and inventory adjustments.
5. Purchase invoice posting.
6. Order status changes.
7. Payment/refund state changes.
8. Shipping config changes.
9. Tax config changes.
10. Payment gateway config changes.
11. Notification/channel setting changes.
12. Role/permission/user admin changes.
13. Login failures/lockouts for admin.
14. Session revocation/reuse-detection events.
15. Admin draft restore conflicts where relevant.

Pros:

1. Strong operational accountability.
2. Supports investigation and compliance.
3. Fits the admin RBAC/security posture.

Cons:

1. More storage.
2. Needs redaction rules.
3. Needs clear audit viewer.

Recommended retention:

1. Financial/security audit: 7 years or accountant-confirmed period.
2. Catalog/admin mutation audit: 3 to 7 years.
3. Noisy raw analytics: 30 to 180 days after aggregate rollup.

#### Option B - Audit only sensitive modules

Pros:

1. Lower storage.
2. Less noise.
3. Faster to build.

Cons:

1. Gaps in investigation.
2. Product/price changes may be missed.
3. Harder to prove who changed what.

#### Option C - Audit everything forever

Pros:

1. Maximum evidence.
2. No retention edge cases.

Cons:

1. Storage/noise grows forever.
2. Not necessary for low-noise boutique scale.
3. Privacy/data-minimization concerns.

### 23.4 Owner Answer

Owner choice:

Retention periods:

Modules to exclude:

Notes:

---

## 24. ID Strategy, Slugs, Codes, And Redirects

### 24.1 Decision Needed

Confirm whether internal IDs, public slugs, business codes, and redirects follow the recommended policy.

### 24.2 Recommended Route

Use Mongo `ObjectId` as internal primary id. Use immutable human business codes where useful. Use SEO slugs for routes, and create redirects when slugs change.

### 24.3 Options

#### Option A - Recommended: ObjectId primary plus immutable business keys and slug redirects

Pros:

1. Clean database model.
2. Stable references across renames.
3. SEO-safe slug changes.
4. Works with multi-placement categories.
5. Avoids leaking internal rules into public URLs.

Cons:

1. Requires redirect collection.
2. Requires slug history validation.
3. Admin must understand slug changes create redirects.

Recommended rules:

1. `_id` is internal.
2. SKU/product code is business identifier.
3. Slug is public route identifier.
4. Old slugs redirect to new canonical slug.
5. Do not reuse old slugs for unrelated products/categories.
6. Discontinued product URL returns 410 or redirects to category depending owner policy.

#### Option B - Slug as primary business key

Pros:

1. Human-readable.
2. Easy manual lookup.

Cons:

1. Slug edits become dangerous.
2. Harder historical references.
3. Bad with redirects and duplicate names.

#### Option C - Mutable slugs with no redirect history

Pros:

1. Easiest admin implementation.
2. No redirect table.

Cons:

1. Bad SEO.
2. Broken shared links.
3. Not acceptable for polished storefront.

### 24.4 Owner Answer

Owner choice:

Discontinued URL behavior, 410 or redirect:

Notes:

---

## 25. Analytics-Driven Badge And Rail Taxonomy

### 25.1 Decision Needed

Choose storefront product-card badges and homepage/category rails fed by weekly insight sets.

### 25.2 What Is Already Locked

Weekly analytics insight sets exist. Badge assignments are persisted and stable, not computed live on every page load.

### 25.3 Recommended Route

Use a bounded, elegant set of manual plus analytics-assisted badges and rails. Avoid noisy marketplace-style labels.

### 25.4 Options

#### Option A - Recommended: Curated premium badge set

Badges:

1. New.
2. Sale.
3. Bestseller.
4. Trending.
5. Featured.
6. Low Stock.
7. Back in Stock.
8. Most Viewed, optional.
9. Most Searched, optional.

Rails:

1. New Arrivals.
2. Bestsellers.
3. Trending Now.
4. Featured Sarees.
5. Sale / Clearance.
6. Recently Viewed.
7. You May Also Like.
8. Handpicked by Saha Textile.

Pros:

1. Polished boutique feel.
2. Uses analytics without looking noisy.
3. Admin can pin/suppress.
4. Good homepage merchandising.

Cons:

1. Needs badge priority rules.
2. Needs weekly job and admin preview.

Recommended display rule:

1. Show at most one primary badge and one secondary badge on a product card.
2. Never clutter cards with many labels.

#### Option B - Manual badges only

Pros:

1. Total brand control.
2. No analytics dependency.
3. Very elegant if curated well.

Cons:

1. More admin work.
2. No automatic discovery of trending products.
3. Stale if not maintained.

#### Option C - Highly dynamic marketplace-style badges

Examples:

1. `X sold this week`.
2. `25 people viewed today`.
3. `Selling fast`.
4. `Only 1 left`.

Pros:

1. Creates urgency.
2. Can increase conversion.

Cons:

1. Can feel noisy or cheap.
2. Needs enough traffic to be meaningful.
3. Risks degrading the elevated boutique tone.

### 25.5 Owner Answer

Owner choice:

Badges to launch:

Rails to launch:

Notes:

---

## 26. Admin PIN UX, Setup, Reset, And Lockout

### 26.1 Decision Needed

Define exactly how the admin 6-digit PIN is set, used, reset, and locked after failures.

### 26.2 What Is Already Locked

1. Admin can use a 6-digit PIN as a quick-login/quick-resume alternative.
2. Weak/sequential/repeated PINs are rejected.
3. Idle lock uses password or PIN based on preferred quick-resume method.
4. Admin soft-lock preserves exact screen/form state where possible.

### 26.3 Recommended Route

PIN is set from authenticated admin security settings after password proof. PIN can be used for idle quick-resume and optionally full login. After repeated PIN failures, disable PIN quick-resume temporarily and require password.

### 26.4 Options

#### Option A - Recommended: Set in security settings after password proof

Pros:

1. Secure setup.
2. Avoids PIN setup during fragile invite/onboarding.
3. Lets admin change/reset deliberately.
4. Works cleanly with audit logging.

Cons:

1. Admin must first log in with password.
2. Slightly more settings UI.

Recommended lockout:

1. 5 failed PIN attempts.
2. Lock PIN quick-resume for 15 minutes or until password login.
3. Notify/audit the event.
4. Password change invalidates PIN sessions.
5. Role/permission change invalidates quick-resume.

#### Option B - Set PIN during admin onboarding/invite

Pros:

1. Smooth first-run setup.
2. PIN is ready immediately.

Cons:

1. More invite flow complexity.
2. Higher risk of rushed weak setup.
3. More recovery paths needed.

#### Option C - PIN only for idle resume, never full login

Pros:

1. Safer than PIN full-login.
2. Still solves the main admin idle-lock UX.
3. Lower attack surface.

Cons:

1. Less convenient.
2. Admin still needs password for initial login every fresh session.

### 26.5 Owner Answer

Owner choice:

PIN allowed for full login:

Failed attempt lockout:

Notes:

---

## 27. Missing Business Flows And Scope Confirmation

### 27.1 Decision Needed

Confirm whether any business flows not fully represented in the KB must be modeled now.

### 27.2 Recommended Route

Explicitly mark these as not at launch unless the business has a real near-term requirement. Preserve only seams for plausible future needs.

### 27.3 Sub-Decisions

#### 27.3.1 Wholesale / B2B Pricing

Option A - Recommended: Not at launch, seam only

Pros:

1. Keeps single-store B2C scope clean.
2. Avoids customer-group pricing complexity.
3. Can add later with customer groups/price lists.

Cons:

1. Manual handling needed for any wholesale inquiry.

Option B - Build wholesale accounts and tier pricing now

Pros:

1. Ready for B2B growth.
2. Structured bulk pricing.

Cons:

1. More auth, pricing, tax, and admin complexity.
2. Not justified unless business needs it soon.

Owner answer:

#### 27.3.2 Made-To-Order Lead Times

Option A - Recommended: Product-level seam, not full engine

Pros:

1. Supports future preorder/custom items.
2. Does not complicate all products.
3. Can display lead-time text when enabled.

Cons:

1. Manual fulfillment planning at launch.

Option B - Full made-to-order workflow

Pros:

1. Clear production queue.
2. Good if tailoring is central.

Cons:

1. Big admin/order-management scope.
2. Needs production statuses and deadlines.

Owner answer:

#### 27.3.3 Gift Cards

Option A - Recommended: Not at launch

Pros:

1. Avoids stored-value liability.
2. Avoids fraud/redeem complexity.

Cons:

1. No gift-card sales initially.

Option B - Digital gift cards at launch

Pros:

1. Nice gifting feature.
2. Can drive prepaid sales.

Cons:

1. Requires code generation, balance tracking, expiry policy, fraud controls.

Owner answer:

#### 27.3.4 Subscription / Repeat Orders

Option A - Recommended: Not applicable at launch

Pros:

1. Saree/textile boutique does not naturally need subscription.
2. Avoids recurring payment complexity.

Cons:

1. None unless business has a planned subscription product.

Option B - Repeat-order reminders only

Pros:

1. Lightweight retention.
2. Can be marketing automation later.

Cons:

1. Still needs consent and messaging rules.

Owner answer:

#### 27.3.5 Bulk Orders

Option A - Recommended: Inquiry form or manual support only

Pros:

1. Captures leads without full B2B pricing.
2. Good fit for boutique operations.

Cons:

1. No automatic bulk discount checkout.

Option B - Bulk discount rules in checkout

Pros:

1. Automatic pricing.
2. Better for frequent bulk sales.

Cons:

1. Adds promotion/price-rule complexity.

Owner answer:

#### 27.3.6 Custom Tailoring Service Products

Option A - Recommended: Model as named add-ons attached to products for launch

Pros:

1. Matches current blouse/design/measurement pattern.
2. Keeps checkout simple.

Cons:

1. Standalone tailoring services are not separately sold.

Option B - Standalone tailoring service products

Pros:

1. Supports service-only purchases.
2. Useful if business sells stitching independent of product.

Cons:

1. More fulfillment and pricing complexity.

Owner answer:

### 27.4 Owner Answer

Overall scope choice:

Business flows to add now:

Business flows to seam only:

Business flows to exclude:

Notes:

---

# Appendix A. Storefront Architecture Follow-Ups From The KB

These were surfaced in the KB as storefront-specific re-ask items. They are not counted in the 27 business/API/DB decision calls above, but they should be answered before the storefront build reaches implementation.

## A.1 Storefront Rendering Strategy

Recommended: Analog SSR/SSG with product/category prerender for published slugs, SSR for dynamic pages, and Nginx/CDN cache for freshness.

Options:

1. SSR/SSG hybrid with cache - recommended.
2. SSR-only.
3. Full prerender on deploy only.

Owner answer:

## A.2 Storefront Routing Style

Recommended: Analog file-based routes for the storefront, with locale-prefixed URLs.

Options:

1. Analog file-based routing - recommended.
2. Angular config router only.
3. Hybrid.

Owner answer:

## A.3 SSR Data Hydration

Recommended: TanStack Query dehydration/hydration, using Angular TransferState where it helps prevent duplicate fetches.

Options:

1. TanStack hydration plus TransferState - recommended.
2. TransferState only.
3. Client refetch after SSR.

Owner answer:

## A.4 Storefront Auth State

Recommended: httpOnly cookie sessions plus CSRF. SignalStore stores only session/user view state. No browser token storage.

Options:

1. Cookie-session view state only - recommended.
2. Store auth tokens in browser storage - rejected by KB security posture.
3. Stateless anonymous-only storefront with login redirects - too limited.

Owner answer:

## A.5 Cart And Checkout Client State

Recommended: classic NgRx Entity/Effects for cart and checkout orchestration; TanStack Query for server reads and mutations.

Options:

1. NgRx classic for cart/checkout plus TanStack server state - recommended.
2. TanStack Query only.
3. SignalStore only.

Owner answer:

## A.6 i18n Route Policy

Recommended: always locale-prefixed routes such as `/en/...` and `/bn/...`.

Options:

1. Always locale-prefixed - recommended.
2. Default locale unprefixed, other locales prefixed.
3. Cookie-only language without locale in URL.

Owner answer:
