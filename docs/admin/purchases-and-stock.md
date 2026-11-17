---
title: Purchases and stock
wide: true
description: Suppliers, purchase orders, purchase entries, purchase returns, stock with held pieces and approvals, counts, opening stock, reports, the settings page, the product and category form rules, and fabric sold by the metre in the admin, the API and the shop.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-17'
source_of_truth:
    - packages/contracts/src/purchasing.ts
    - packages/contracts/src/inventory.ts
    - packages/contracts/src/catalog-write.ts
    - packages/contracts/src/cart.ts
    - packages/core-domain/src/purchasing
    - packages/core-domain/src/catalog/cart-line.ts
    - packages/adapters-db-mongo/src/repositories/purchasing.repository.ts
    - apps/api/src/purchasing
    - apps/api/src/catalog/catalog.service.ts
    - apps/api/src/catalog/taxonomy.service.ts
    - apps/api/src/cart/cart-lines.service.ts
    - apps/admin/src/app/features/purchasing
    - apps/admin/src/app/features/stock
    - apps/admin/src/app/features/setting/purchases
    - apps/admin/src/app/features/product/form-product
    - apps/storefront/src/app/core/catalog/metre-length.ts
---

# Purchases and stock

Stock is never typed. It moves only through documents: purchase entries, purchase returns, orders, adjustments, holds, counts and a one-time opening stock. Every movement is a ledger row with a reason, a person and, for stock that came in, a cost layer. The approved screens are in the purchases and stock brief (revisions 1–3) and the fabric-by-the-metre shop brief.

## Menus and routes

| Menu                  | Route                                                                  | Permission                                      |
| --------------------- | ---------------------------------------------------------------------- | ----------------------------------------------- |
| Purchases › Suppliers | `/suppliers`                                                           | `supplier.index`                                |
| Purchase orders       | `/purchase-orders`                                                     | `purchase_order.index`                          |
| Purchase entries      | `/purchase-entries` (labels at `/purchase-entries/:id/labels`)         | `purchase.index`                                |
| Purchase returns      | `/purchase-returns`                                                    | `purchase_return.index`                         |
| Opening stock         | `/opening-stock`                                                       | `stock.opening`                                 |
| Stock                 | `/stock`, `/stock/items/:id`, `/stock/held`                            | `stock.index`                                   |
| Approvals             | `/stock/approvals`                                                     | `stock.approve`                                 |
| Stock counts          | `/stock-counts`, `/stock-counts/:id`                                   | `stock_count.count`                             |
| Reorder and reports   | `/stock/reorder`, `/stock/reports` (`?tab=unpaid`), `/stock/movements` | `stock_report.index`                            |
| Settings              | `/setting/purchases`                                                   | `setting.index` to read, `setting.edit` to save |

The Stock menu group and its Approvals item show how many requests wait. The bell lists approvals waiting, decisions on the reader's own requests (opening one marks it seen), late purchase orders the reader made, unpaid bills near the input-credit limit and held stock past its reminder. Both read `GET /admin/stock/alerts`; the API sends each part only to people who may act on it.

## Numbers

Internal numbers come from `numberCounters`, one counter per series and financial year, allocated inside the posting transaction: `PE/26-27/000014` (purchase entry, on posting), `PO/…` (purchase order, on creation), `OS/…` (opening stock, on posting) and `SC/…` (stock count, on start). The financial year follows the India date and resets on 1 April. Debit-note and challan formats (`DN/…`, `DC/…`) are placeholders until the CA approves them. Formats live in `InventorySettings.numberFormats`.

## Quantities and money

- **Units.** A product is sold by the piece or by the metre (`Product.soldBy`). Every stored quantity is a whole number of its unit: pieces, or tenths of a metre. `2.55 m` is refused; `42.5 m` is stored as `425`.
- **Buckets.** On hand, held (on hand but not for sale), in orders (0 until `DEC-STOCK-RESERVE` is built) and free to sell (on hand − held − in orders). The shop reads only free to sell.
- **Cost.** Before GST for a regular supplier, the full price for composition or unregistered suppliers; freight on a bill is shared across lines by value. Cost and stock value are sent only to holders of `stock.cost`.

## Settings › Purchases and stock

`GET` and `POST /admin/settings/inventory`. The page holds:

| Setting                | Who may change it | Notes                                                                                                        |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| Who may do each step   | Super admin only  | Make the draft, check goods, post, record payment: anyone with the step's permission, or one role holding it |
| Second person per step | Super admin only  | Check, post and payment can each need a person other than the one before                                     |
| Books closed up to     | Super admin only  | Nothing may be dated on or before it; moving it earlier asks first. Opening stock posts on its own day       |
| Price-change warning   | `setting.edit`    | % above the last bill                                                                                        |
| Margin floor           | `setting.edit`    | % after GST; lines under it warn                                                                             |
| Held stock reminder    | `setting.edit`    | Days before a held row turns yellow and reaches the bell                                                     |
| Unpaid bill alert      | `setting.edit`    | Days after the bill date                                                                                     |
| Default payment terms  | `setting.edit`    | For a new supplier                                                                                           |
| Default delivery place | `setting.edit`    | Fills Deliver to on a new purchase order                                                                     |

"Super admin" is the `admin` operator tier. A change to the step rules or the books-closed date from anyone else is refused (403) and written to the audit log. A step role must hold the step's permission. A step whose role was deleted is closed until the super admin chooses again, so a deleted role never opens a step to everyone.

## Opening stock

`/opening-stock` reads a CSV with the headings SKU, Quantity (pieces, or metres for fabric), Cost each, Received on (`2026-03-14` or `14/03/2026`; empty means today) and Note. `POST /admin/opening-stock/check` sorts every row into Ready, Cost missing, Unknown SKU, Already has stock, Wrong quantity, Date after today or SKU twice in the sheet, and returns the number the load would get. A missing cost can be typed in the row. Posting (`POST /admin/opening-stock`, with a request key) is allowed only when every row is ready, once per SKU.

The received date only places pieces in the ageing bands; the load enters the books on the posting day, so a received date may lie before the books-closed date.

On a local database, `pnpm --filter @saha-textile/api seed:local-opening-stock -- --i-am-local` moves the demo catalogue's typed stock into opening-stock loads with a demo cost (55% of the selling price unless `--cost-pct` says otherwise). A second run changes nothing.

## Product and category forms

- **Inventory tab.** Sold by (fixed once the product has stock, stock history or orders), the stock figures (on hand, held, free to sell) with Stock history, Adjust and Receive stock for the product and for each variant, and a read-only stock status worked out from free to sell. The typed stock box is kept in the code behind `typedStockBox` until its removal is approved; the API ignores a typed quantity.
- **Metre fields.** Shortest cut (required, 1.0 m for a new metre product), up to four quick lengths with a label in every language (labels count as language to-dos), width in inches, and weight per metre (required; an order line weighs length × this). A metre product's low-stock level is typed in metres and stored in tenths.
- **HSN and Can be returned** sit beside Categories. The first category is the main one. Choosing a different main category refills both; when that replaces a different HSN the popup offers Put back, Enter manually (a box with a tick for Enter and a cross for Esc) and Keep. An HSN has 4, 6 or 8 digits, checked in the form and by the API. "Can be returned" follows the main category unless the product sets Yes or No.
- **Category form.** HSN and Can be returned. Changing a saved category's HSN asks whether the products that follow it (their HSN is the category's old code or empty) take the new one; products with their own HSN are named and left alone. `GET /admin/catalog/categories/:id/hsn-impact` returns both groups.

## Fabric sold by the metre in the shop

- Cards show the price per metre (`₹180.00 / m`); a card's Add opens the product popup with a length.
- The product page reads "per metre", offers the quick lengths on the theme's option buttons plus Other, and takes a typed length snapped to 0.1 m with a note. − and + change it by 0.5 m between the shortest cut and what is free to sell. Below the shortest cut the box turns red and buying is off. A line under the box shows length × price.
- The cart, phone cart, mini cart and sticky bar show and edit lengths (`2.5 m`). At the shortest cut the minus removes the line. A metre line counts once in the bag.
- The server prices a metre line as price per metre × length, rounded to the paisa, plus add-ons once per line, and refuses a length below the shortest cut. A piece line holds at most 99.
- Product data for search engines carries a `UnitPriceSpecification` with unit code `MTR`.
- What happens when a cut would leave a scrap shorter than the shortest cut (decision M3) waits on the business owner; nothing is built for it yet.
