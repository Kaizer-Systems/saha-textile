---
title: Product list bulk actions and drafts
wide: true
description: Ticks that stay on every admin list, the product list's six bulk actions (Go Live, Take off shop, Put on sale, Discontinue, Duplicate, Delete), the row's Status switch, Save as draft on the product form and the Products › Drafts screen.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-20'
source_of_truth:
    - packages/contracts/src/product-bulk.ts
    - packages/contracts/src/product-draft.ts
    - packages/core-domain/src/ports/product-draft.repository.ts
    - packages/adapters-db-mongo/src/repositories/product-draft.repository.ts
    - apps/api/src/catalog/product-bulk.service.ts
    - apps/api/src/catalog/product-drafts.service.ts
    - apps/api/src/catalog/admin-product-drafts.controller.ts
    - apps/api/src/events/event-products.service.ts
    - apps/admin/src/app/shared/ui/table/table.ts
    - apps/admin/src/app/features/product/product.ts
    - apps/admin/src/app/features/product/bulk/product-bulk-popup.ts
    - apps/admin/src/app/features/product/bulk/product-sale-popup.ts
    - apps/admin/src/app/features/product/form-product/form-product.ts
    - apps/admin/src/app/features/product/form-product/product-draft-state.ts
    - apps/admin/src/app/features/product/product-drafts/product-drafts.ts
---

# Product list bulk actions and drafts

The product list acts on many products at once, and the product form keeps unfinished work as a draft. The design follows the approved Product Bulk Actions brief; the owner's answers are recorded in the decisions log: Delete only for products that never went live (Q1 = A), "discount" means a timed sale (Q2 = A), the Approve and Store columns removed (Q3 = B), and the stored status `draft` shown as "Not live yet" (Q4 = A).

## Ticks that stay (every list)

A tick belongs to the row, not the page. The shared table (`shared/ui/table`) keeps its picks through search, clearing the search, page, sort and page-size changes. A list that passes `selectionKey` (Products, Blog, Search words) also keeps them in `sessionStorage` under `saha-textile:table-picks:<key>`, so they survive opening a row and coming back in the same browser tab. Clear, a finished action, or closing the tab ends them.

While anything is ticked the table shows:

- **the selection bar** — the Media page's `.fm-bulk`: "N selected (M on this page)", the page's bulk buttons, a **More** menu for rarer ones, **Show list** and **Clear**. On a phone it is pinned to the bottom of the screen and every action sits in one **Actions** menu;
- **chips** — the Media page's `.fm-chip`, one per pick with its photo and a ✕, newest first, six at most and then "+N more". A pick an action could not do turns amber (`.fm-chip.warn`) and names why on hover;
- **the picked list** — the Media page's upload tray (`.fm-tray`) opened under the bar: every pick with photo, detail, status pill and ✕, and a count per status at the foot.

The header box ticks or unticks the rows on the current page only. A table may cap one action with `maxPicks` (Products: 200). Rows the table can name come from `pickView`; otherwise a pick shows its `name` or `title`. Pages that act on picks call `pickedRows()`, `dropPicks()`, `markPicks()` and `clearPicks()`.

## The product list

Columns: No., Image, Name, SKU, Price, Stock and Status. The Status column's switch is on only for a live product, with the status in words beside it: Live, Not live yet (never been live), Off shop (taken off after being live) or Discontinued (switch locked). Switching on runs Go Live; switching off takes the product off the shop. Both ask first through the table's confirmation.

Your drafts of changes show as a "Draft of changes" chip under the product's name.

## The six bulk actions

Each action asks first with a **dry run** — the same call with `dryRun: true`, which changes nothing — and names how many it will change, which it skips and why, and the products that need work. After the action, products done or skipped are unticked; products it could not do stay ticked with an amber chip.

| Action        | Route (`POST /admin/catalog/products/bulk/…`) | Right                                                     | What happens                                                                                                                                                                                                          |
| ------------- | --------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go Live       | `go-live`                                     | `product.edit`                                            | The form's Go Live check per product; a product with an empty field in any language stays as it is and names the gaps.                                                                                                |
| Take off shop | `take-off`                                    | `product.edit`                                            | Live products become `disabled`; search drops them; their pages answer "not found".                                                                                                                                   |
| Discontinue   | `discontinue`                                 | `product.edit`                                            | Cannot be undone. Old links answer 410, or 301 to one live product or collection that is not in the batch.                                                                                                            |
| Duplicate     | `duplicate`                                   | `product.create`                                          | A copy that is not live yet, "Copy of …" in every language, codes ending `-C1` (or the next free number), no stock, no barcode, in no sale; same photos, prices, options, categories, questions and offered products. |
| Delete        | `delete`                                      | `product.destroy`                                         | Only a product never live, never stocked (no stock history), on no order and named by no launch or sale. Everything else is refused with "discontinue it instead". The row's bin icon runs the same check.            |
| Put on sale   | `POST /admin/events/sale-products`            | `event.edit` (existing sale) or `event.create` (new sale) | See below.                                                                                                                                                                                                            |

Every route takes up to 200 product ids. Each product is done on its own inside one request — one failing never stops the others — and every change writes an activity-log line (`catalog.product.take-off`, `catalog.product.duplicate`, `catalog.product.delete` and the existing go-live and discontinue lines).

## Put on sale

The products join a sale from Events as product lines of their own, so they get everything sales already do. The popup lists the sales that have not ended (running first, then scheduled and drafts) and **New sale with these products**:

- **% off** and **₹ off** take one number for every product;
- **Fixed sale price** gives every product its own price box; a product with colours can take one price or a price per colour (stored as the rule's `skuPrices`). "Same price for all" only fills the empty boxes. A price above today's is red and the button waits.

Every price in the popup comes from the sale engine through a dry run, so it is what the shop will charge. A product already in another sale over the same time, a rule that cannot apply to a product's price, or a discontinued product is left out and named. Adding to a running sale changes prices straight away. A new sale is a draft named "Sale from the product list · <date>"; the admin lands on it in Events to give it its name, dates and message and press Publish.

The sale form itself now uses the full page width, and its Discounts table never wraps (it scrolls sideways on a narrow screen); a product priced per colour shows a price box per SKU.

## Save as draft

**Save as draft** sits beside Save Product / Update Product on every tab. It keeps whatever is on the form — empty fields and mistakes included — and runs no checks. A draft is kept in its own collection (`productDrafts`), so the shop, search, sitemap, sales and stock never see it; nothing deletes it on a timer.

A draft holds the form's own values, the text of every language-bound field in every language, and the lists beside the form (options, photos, FAQ, metre settings, shipping charges, bundle). `product-draft-state.ts` flattens two such snapshots into one value per field path (`raw.sku`, `raw.variations.<id>.price`, `text.name.bn`, `state.images`) to find what changed.

- **New product.** The address becomes `/product/create?draft=<id>`, so refreshing or bookmarking keeps it. Save Product runs every check, creates the product and removes the draft.
- **Changes to an existing product** (live, off shop or not live yet). The draft keeps the whole form, a link to the product and the changed fields with their values when the draft began. The product is not touched. Changed fields get an amber outline and "Changed · was: …" under them; their tabs get an amber dot. **Update Product** runs every check and writes the product (which now differs only in the changed fields), then removes the draft. **Discard draft** throws the copy away. There is one draft of changes per product per person.
- **When someone else saved the product after the draft began**, opening the draft lays its changed fields over the product as it is now, and Update Product first asks, per field both changed, which value to keep ("Mine" / "Theirs"). The full checks still run after.
- **Leaving with unsaved work** asks "Keep your work on this product?" — Leave without saving, Stay, or Save as draft and go. Closing the browser tab shows the browser's own "Leave site?" box.
- Opening a product that has a draft says so: yours with Continue draft and Discard draft, a colleague's as a note. A draft is never applied without asking.

Rights: a new-product draft needs `product.create`, a draft of changes `product.edit` (checked by the API per draft); listing needs `product.index`. Saves and discards write `catalog.product-draft.save` and `catalog.product-draft.discard` audit lines. Deleting a product removes its drafts.

## Products › Drafts

`/product/drafts`, under Products in the menu with a count of your drafts. One list for both kinds: New product and Changes (with the product's status), the picture, "Where it stands" (what still blocks Save, or ready), and the last save. **Mine / Everyone's** is the same switch as Media favourites; Everyone's names who saved each draft, so someone can finish a colleague's work. ✎ or a click opens the form exactly as it was left; 🗑 asks first and discards the draft only.

API: `GET /admin/catalog/product-drafts?scope=mine|everyone&productId&search&page&pageSize`, `GET /admin/catalog/product-drafts/:id`, `POST /admin/catalog/product-drafts` (new, or the person's existing draft of changes for that product), `POST /admin/catalog/product-drafts/:id`, `DELETE /admin/catalog/product-drafts/:id`. A draft's form is capped at 512 KB.
