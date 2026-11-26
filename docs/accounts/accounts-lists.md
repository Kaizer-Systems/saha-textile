---
title: Accounts menu, lists and Overview
description: Accounts › Overview, Day book, Sales and purchases and the Vouchers tabs; the period presets, chips, picks bar, one-PDF print and CSV export they share; the voucher form's Receipt, Payment, Contra and Journal tabs.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: accounts overview day book vouchers tabs receipts payment vouchers contra journal credit notes debit notes refund vouchers self-invoices stock adjustments sales and purchases tax invoices purchase bills period presets financial year picks print export CSV voucher form contra deposit slip waiting for someone
source_of_truth:
    - packages/contracts/src/accounts-lists.ts
    - packages/core-domain/src/ports/accounts-lists.port.ts
    - packages/core-domain/src/ledger/overview-rules.ts
    - packages/adapters-db-mongo/src/repositories/accounts-lists.reader.ts
    - apps/api/src/ledger/accounts-lists.ts
    - apps/api/src/ledger/accounts-overview.ts
    - apps/api/src/ledger/accounts-prints.ts
    - apps/admin/src/app/features/accounts/accounts-list-page.ts
    - apps/admin/src/app/features/accounts/accounts-list-columns.ts
    - apps/admin/src/app/features/accounts/accounts-overview.ts
    - apps/admin/src/app/features/accounts/accounts-period.ts
    - apps/admin/src/app/features/accounts/voucher-form.ts
---

# Accounts menu, lists and Overview

The Accounts menu opens with **Overview**, then **Day book**, **Sales and purchases**, **Vouchers**, **Ledgers**, **E-invoices**, **E-way bills** and **Periods and locks**. Cash and bank, GST, Fixed assets, Reports and Import join the menu as those parts are built.

## Overview

`/accounts/overview` shows eight cards. Balances are as of today; the month picker (This month or Last month) chooses the GST and month cards:

| Card              | What it shows                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Cash in hand      | Balance of every ledger under the cash group, with how many ledgers                           |
| Bank              | Balance of the bank ledgers, with their names                                                 |
| Customers owe us  | Balance of the customers (debtors) group                                                      |
| We owe suppliers  | Balance of the suppliers (creditors) group                                                    |
| GST for the month | Output GST less input GST posted in the month; due on the 20th of the next month, or a credit |
| The month         | Open or locked (every part of the books locked), and the last locked month                    |
| Profit this year  | Income less expenses from 1 April of this financial year to today                             |
| Stock at cost     | Balance of the stock-in-hand ledger, and stock in transit when there is any                   |

Balances come from the posted vouchers (`LedgerService.balances`), found by group and ledger roles, so a renamed ledger still counts, and follow the locations the person may see. **Waiting for someone** lists voucher drafts, credit-note drafts, self-invoices due soon, stock adjustments waiting for approval and refund vouchers that failed, each with a link to the tab where it is worked on. The cash-box, bank-line and cash-on-delivery rows arrive with those parts of the books.

## The lists

Every list is one table on the shared admin table, read from the posted documents by one reader (`MongoAccountsListsReader`), so the Vouchers tabs, Sales and purchases and the Day book look and behave the same:

- **Period**: Today, Last 7 days, Last 30 days, This month, Last month, This quarter, Last quarter, This financial year (1 April to 31 March), Last financial year, Last 12 months, or a custom range. Days are Indian days.
- **Chips** with a count each, for the period.
- **Search** on the server, in each tab's own fields: number, party, order number, reference or narration.
- **Totals** for the period under the table.
- **Picks bar**: tick rows, then **Print** (one PDF of the picked documents, each from a new page, in the order picked, on the tab's document format) or **Export** (CSV of the picked rows). Drafts and documents with no print are left out of the PDF.
- **Export CSV** at the top exports the whole period.
- Row icons open the document and print it; a draft voucher opens in the voucher form.

A stock adjustment's value at cost and the input tax it reversed show only to people who may see cost, as on its own page.

### Vouchers tabs

`/accounts/vouchers/<tab>`; `/accounts/vouchers` opens Receipts.

| Tab               | Chips                                                               | Reads                                                                                 |
| ----------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Receipts          | All · Against orders · On account · Refunded                        | Order payments with a receipt number, business receipts, receipts typed by hand       |
| Payment vouchers  | All · Reverse charge · Supplier bills · Cancelled                   | Payment vouchers and payments typed by hand                                           |
| Contra            | All                                                                 | Contra vouchers                                                                       |
| Journal vouchers  | All · Set-offs · Reversals · ITC reversed                           | Journals, reversals, input-tax reversals, set-offs and reversals on business accounts |
| Credit notes      | All · Drafts · Waiting for the buyer · Issued · Cancelled           | Credit notes                                                                          |
| Debit notes       | All                                                                 | Debit notes                                                                           |
| Refund vouchers   | All · Refunded · Waiting for the gateway · Failed                   | Refund vouchers, including the shop's own ([Refund vouchers](./refund-vouchers.md))   |
| Self-invoices     | All · Drafts · Due soon · Unpaid · Paid                             | Self-invoices ([Self-invoices and payment vouchers](./self-invoices.md))              |
| Stock adjustments | All · Waiting for approval · Posted · Reversed, and a reason filter | Numbered stock adjustments                                                            |

Draft vouchers (journal, receipt, payment, contra) show in their kind's tab with the status Draft and no number.

### Day book

`/accounts/day-book` lists every voucher of the period by date, with chips All · Receipts · Refunds · Credit notes · Payments · Self-invoices · Journals · Stock adjustments, and the columns Date, Voucher, Number, Party, Against, Money in, Money out, Stock, By and Status. **Export for the CA** downloads it as CSV.

### Sales and purchases

`/accounts/sales-and-purchases/<tab>` has two tabs with their counts:

- **Tax invoices**: chips All · Online · Staff orders · Business (with a GSTIN); status Issued, Part credited, Credited or Cancelled, worked out from the issued credit notes against each invoice; the e-invoice IRN and e-way bill number when there are any. The counter chip arrives with counter mode.
- **Purchase bills**: chips All · Posted · Void.

Both filter by location (Every location, or one).

## The voucher form

**New voucher** has four tabs, in this order: Receipt, Payment, Contra and Journal. A card on the right says what the chosen kind means.

**Contra** moves money between your own cash and bank ledgers: From, To, Amount, an optional deposit slip number and a narration. It is saved as its two lines (To debited, From credited) and can't be posted with From and To the same. The slip number is kept on the bank line as "Deposit slip …", so a saved draft opens with it.

## API

| Method | Path                              | Permission       |
| ------ | --------------------------------- | ---------------- |
| GET    | `/admin/accounts/overview?month=` | `accounts.index` |
| GET    | `/admin/accounts/lists/:tab`      | `accounts.index` |
| GET    | `/admin/accounts/day-book`        | `accounts.index` |
| POST   | `/admin/accounts/lists/:tab/pdf`  | `accounts.index` |

The list query is `from`, `to`, `chip`, `reason`, `location`, `search`, `page` and `pageSize` (at most 100); a period that ends before it starts is refused with `period_backwards`.
