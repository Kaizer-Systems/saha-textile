---
title: Returns and credit notes
description: Returns checked piece by piece, credit notes taken from the invoice line, price adjustments, parcels brought back, Cancel and debit notes, Refund now, the edit log, one editor at a time, and the order's Documents card.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: return credit note debit note price adjustment undelivered parcel refund s.34 deadline rule 53 restock damaged write off input tax s.17(5)(h) cancel super admin edit log document lock take over return note documents card
source_of_truth:
    - packages/contracts/src/returns.ts
    - packages/core-domain/src/invoicing/credit-note-rules.ts
    - packages/core-domain/src/ports/returns.repository.ts
    - packages/adapters-db-mongo/src/repositories/returns.repository.ts
    - apps/api/src/returns
    - apps/api/src/documents/credit-note-print.ts
    - apps/api/src/ledger/edit-log.ts
    - apps/admin/src/app/features/order/details/order-returns.ts
    - apps/admin/src/app/features/accounts/return-page.ts
    - apps/admin/src/app/features/accounts/credit-note-page.ts
    - apps/admin/src/app/features/accounts/edit-log-rows.ts
    - apps/admin/src/app/features/order/details/order-documents.ts
    - apps/admin/src/app/shared/components/document-lock/document-lock.ts
---

# Returns and credit notes

A return changes nothing in stock or the books until its credit note is issued. A credit note quotes one tax invoice and takes its lines and tax from that invoice's lines, never from today's product.

## The flow

1. **Start a return** on a delivered order (order page, Returns and credit notes). It is allowed until the return window closes: delivery day plus `accounts.returns.windowDays` (7 by default). Pick pieces (no more than bought less already asked back, and only lines that can be returned), why, how it comes back, and where the refund goes. The return is numbered as the order's child, `ST-2611-482190/R1`, and starts as Asked.
2. **Pickup booked**, then **Received**. A parcel the customer sends goes straight to Received.
3. **Check each piece**: back to stock (for sale), damaged and kept (on hand but held, reason `damaged`, shown in Stock › Held), or written off (not added back).
4. **Make the credit note**: a draft with the checked pieces' share of their invoice lines, a delivery share line, the s.34 deadline, and the pieces' own cost.
5. **Issue** (one transaction): the `CN/` number for the invoice's GSTIN, pieces back at the invoice's location in a cost layer at their own cost (held when damaged), the posting, and the return moves to Credit note.
6. **Refund now**: back through the gateway, or paid by hand. The return moves to Refunded.

A **price adjustment** is a credit note without goods: each line lowered by an amount, with the tax taken out at the line's rate. A **parcel brought back** undelivered gets a credit note for all of its invoice's pieces, back to stock.

## Rules

| Rule                     | Detail                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deadline (CGST Act s.34) | 30 November after the end of the invoice's financial year                                                                                                                                                                                                     |
| One note, one invoice    | Several notes may quote one invoice; together they never give back more than it, in pieces or money                                                                                                                                                           |
| Part of a line           | Each piece's share of the line; the last pieces take what is left, so the notes add up to the line exactly                                                                                                                                                    |
| Delivery share           | ₹0 until the CA answers B7.3 ("free delivery" or "waits for the CA")                                                                                                                                                                                          |
| Written-off pieces       | Not added back; Issue takes back their input tax (s.17(5)(h), decision D9), see Posting                                                                                                                                                                       |
| Fabric by the metre      | Return lines carry the invoice line's unit (`MTR`). Quantities stay in tenths of a metre; the order's returns card, the return page, the credit note page and the counter exchange show and take metres (2.3 typed is 23 kept), and the price reads per metre |

## Posting

| Debit                                                   | Credit                           |
| ------------------------------------------------------- | -------------------------------- |
| Sales returns (taxable value), Output CGST/SGST or IGST | Sundry debtors (total), rounding |
| Stock in hand (restocked and damaged pieces at cost)    | Cost of goods sold (the same)    |
| Stock loss (written-off pieces' input tax)              | Input CGST and Input SGST        |

The input tax line is a voucher of its own: each written-off piece's cost times the line's GST rate, split into CGST and SGST (purchases are taken as made within the State until the CA answers B7.6). Nothing is posted when no piece was written off. Cancel and debit notes post its opposite.

Refund: debit Sundry debtors, credit Gateway clearing (gateway) or the chosen cash or bank ledger (by hand). A gateway refund uses our own reference, `CN` and the note's id in letters and digits only (at most 30, CCAvenue's limit), so a retry never refunds twice.

A business buyer's own account (Customers › the business) gets an entry for each step: the credit note (the total off), the refund, a debit note or a Cancel (the total back on). Shoppers without a business account have none; their credit sits in Sundry debtors.

## Undoing a credit note

- **Cancel**: a super admin only, while the note's month isn't marked filed for its GSTIN, its books are open, and no refund has been paid. Everything is reversed (pieces out, their cost layer and hold, the opposite posting on the note's date) and the return goes back to Checked. The number stays, marked cancelled.
- **Debit note**: once the month is filed or closed, a `DN/` note in the current month undoes it: the opposite posting, and the pieces out of stock again.

## Edit log

The issued note's page shows its edit log: When, Who (with their role the first time they appear), What, Field, Before, After and Why. It is read from the audit log (books tier, 8 years) and lists the draft, every changed quantity or reason, Issue with its number, the system's posting, each print, a refused or done Cancel with the reason, the refund, a debit note, and lock take-overs and release requests. Nothing in the app can change it.

## One person edits a draft at a time

A draft is held by the person editing it (document locks, decision D10). They keep it while they are active on the page; it is released when they leave or after 2 minutes without activity. Everyone else reads the draft under a banner naming the holder and their role, since when and how long ago they were last active, with Save and Issue switched off. They can:

- **Ask them to release it**: the holder's page shows who asked and a Release it button.
- **Take over** (super admin): logged with both names.

## Documents on the order page

The order page's Documents card lists every document of the order: tax invoices, receipt vouchers, packing slips, returns, credit notes, debit notes and [refund vouchers](./refund-vouchers.md), each with its number, date and amount. The eye opens its own page (a debit note opens the credit note it undoes); the printer prints it on its format. A draft credit note has no print yet. The return page's **Print return note** prints the Return note format: what came back, in what condition, the reason, and where the refund goes.

## API

| Method | Path                                                 | Permission                    |
| ------ | ---------------------------------------------------- | ----------------------------- |
| GET    | `/admin/orders/:id/returns`                          | `order.index`                 |
| POST   | `/admin/orders/:id/returns`                          | `order.edit`                  |
| POST   | `/admin/orders/:id/price-adjustment`                 | `order.edit`                  |
| POST   | `/admin/orders/:id/parcels/:shipmentId/undelivered`  | `order.edit`                  |
| GET    | `/admin/returns/:id`                                 | `order.index`                 |
| GET    | `/admin/returns/:id/pdf` (return note)               | `order.index`                 |
| POST   | `/admin/returns/:id/step`, `/check`, `/credit-note`  | `order.edit`                  |
| GET    | `/admin/accounts/credit-notes`, `…/:id`, `…/:id/pdf` | `accounts.index`              |
| PUT    | `/admin/accounts/credit-notes/:id` (draft)           | `accounts.post`               |
| DELETE | `/admin/accounts/credit-notes/:id` (draft)           | `accounts.post`               |
| POST   | `/admin/accounts/credit-notes/:id/issue`             | `accounts.post`               |
| GET    | `/admin/accounts/credit-notes/:id/log`               | `accounts.index`              |
| GET    | `/admin/accounts/credit-notes/:id/cancel-checks`     | `accounts.index`              |
| POST   | `/admin/accounts/credit-notes/:id/cancel`            | `accounts.post` (super admin) |
| POST   | `/admin/accounts/credit-notes/:id/debit-note`        | `accounts.post`               |
| POST   | `/admin/accounts/credit-notes/:id/refund`            | `refund.action`               |
| GET    | `/admin/accounts/debit-notes/:id`, `…/:id/pdf`       | `accounts.index`              |
| GET    | `/admin/document-locks/:type/:id` (holder and role)  | signed-in admin               |
| POST   | `/admin/document-locks/ask-release`                  | signed-in admin               |

`GET /admin/orders/:id/returns` also returns the order's `documents` for the Documents card.

## Collections

`orderReturns` (one per return; saved only when nobody saved it since), `creditNotes` (drafts by version; a number unique within its GSTIN once issued), `debitNotes`.
