---
title: Counter sales
description: Counter mode in Create order at a store, Take payment split between cash, UPI and card, the tax invoice printed on A4 or the 80 mm roll, exchanges at the counter on a credit note and a new sale, and the counter summary for a store's day.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: counter sale point of sale pos store billing scan sku barcode take payment cash upi card change roll 80 mm receipt a4 tax invoice exchange return credit note counter summary cashier copy rule 46 address 269ST
source_of_truth:
    - packages/contracts/src/counter.ts
    - apps/api/src/counter
    - apps/admin/src/app/core/counter/counter.gateway.ts
    - apps/admin/src/app/features/order/create-order/counter-sale.ts
    - apps/admin/src/app/features/order/create-order/counter-payment.ts
    - apps/admin/src/app/features/cash/counter-exchange.ts
    - apps/admin/src/app/features/cash/counter-summary.ts
---

# Counter sales

A store sells over its counter from the same Create order screen. A counter sale is handed over at once: its stock leaves the store at once, its tax invoice is issued at once, and each payment lands where it was taken, all in one transaction.

## Counter mode

Create order shows **Sold at the counter** only to a person who can count cash (`cash.count`) at a store in their reach with a day-sheet cash box. With the header chip on all locations and more than one such store, a store is picked beside the switch. The page's line says whether the store's cash sheet is open; while it isn't, the sale takes UPI and card only.

| Part     | What it does                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scan     | Enter after a code adds the item whose SKU it is, marked "scanned"; the same item again adds to its line, fabric a metre at a time. Anything that isn't a SKU shows the matching product cards, and a card adds as Create order adds (a set opens Configure, variants open the picker). |
| Items    | Item, quantity, price and total as the sale will price them. A line the shop can't sell, or one whose HSN the invoice can't take, is named and payment waits.                                                                                                                           |
| Customer | Phone finds a past customer's name. The billing address is optional under ₹50,000 for a buyer without a GSTIN (CGST rule 46) and needed at ₹50,000 or more or with a GSTIN; left empty, the bill shows the store's city and State.                                                      |
| Totals   | Taxable value, CGST + SGST and the total, worked out with the invoice's own rules (a counter sale is always within the store's State).                                                                                                                                                  |

## Take payment

| Field            | Detail                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| UPI, Cash, Card  | Amounts that add up to the total, with UPI and card references. Cash starts with the whole bill when the sheet is open.                     |
| Cash handed over | The change to give is worked out; it is never a line on the sheet, only the net cash is.                                                    |
| Print            | **A4 tax invoice** prints the full invoice on its format's paper (A4 unless Settings › Document formats says otherwise), or **80 mm roll**. |

"What this changes" lists the tax invoice, the pieces leaving the store, the cash line and the books lines before anything is taken. Taking it:

- prices the lines again and refuses a total that changed meanwhile;
- refuses cash from one person at or over the limits rule set's `cash_receipt_one_person` (Income-tax s.269ST, ₹2 lakh) and cash handed over below the cash part;
- makes the order (channel `counter`, status delivered), reserves and sells the stock at the store, issues the tax invoice, and records a receipt per payment: cash into the store's day-sheet box ledger, UPI and card into the `upi_card_clearing` ledger, each posted in the same transaction;
- prints the invoice from `GET /admin/counter/sales/:orderId/print`, behind the counter's own permission so a cashier prints what they sold.

## Exchange at the counter

Cash › Exchange at the counter finds a counter bill by its order number or the tax invoice number on the roll. **Coming back** takes a quantity of each line still returnable, back to stock or kept as damaged, with the reason. **Going out instead** is scanned by SKU; left empty, it is a plain return.

One transaction then: the return is recorded, received and checked, its credit note is made and issued against the bill, the credit note is paid back in cash from the store's till, and the new items are a new counter sale paid with that cash first. The till's sheet therefore shows two lines (the refund out, the sale in) that net to the difference. Money given back is always cash from the till; a difference the buyer pays may be cash, UPI or card. Store credit kept on the buyer's account is not offered yet: a kept credit note can't be set off against a new invoice until settlements and bill allocation are built.

## Counter summary

Cash › Counter summary shows a store's day: bills and amounts by cash, UPI and card, returns and exchanges (credit notes issued that day against counter bills, shown as a minus), the new items of exchanges, the net, the bill numbers, the first and last bill, discounts given, and the day's cash sheet. A person without `cash.manage` sees the cashier's copy, with the cash amount and the net left out, as the blind count does. Print uses the browser's print.

## API

| Method | Path                                         | What                                                      |
| ------ | -------------------------------------------- | --------------------------------------------------------- |
| GET    | `/admin/counter/here`                        | Stores in reach with a day-sheet box, and each sheet open |
| GET    | `/admin/counter/scan?code=`                  | What a SKU is                                             |
| POST   | `/admin/counter/quote`                       | The items priced, with the invoice's tax                  |
| POST   | `/admin/counter/sales`                       | Sell, invoice and take payment                            |
| GET    | `/admin/counter/sales?number=`               | A counter bill by order or tax invoice number             |
| GET    | `/admin/counter/sales/:orderId`              | The bill's lines still returnable                         |
| GET    | `/admin/counter/sales/:orderId/print?paper=` | The tax invoice, `roll80` or the format's paper (PDF)     |
| POST   | `/admin/counter/sales/:orderId/exchange`     | Credit note, refund, new sale                             |
| GET    | `/admin/counter/summary?date=&locationId=`   | The store's day                                           |

Every route needs `cash.count`.

## Refusals

`location_out_of_scope`, `location_unknown`, `counter_price_changed`, `counter_payments_dont_add_up`, `counter_address_needed`, `counter_line_problem:<problem>:<sku>`, `invoice_problem:<problem>:<sku>`, `cash_receipt_over_limit`, `cash_handed_short`, `cash_sheet_not_open`, `voucher_problem:role_not_mapped:upi_card_clearing`, `tax_invoices_off`, `counter_code_unknown`, `counter_sale_not_found`, `counter_exchange_refund_in_cash`, and the returns' own `return_*` codes for what comes back. Each is shown in words.
