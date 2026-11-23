---
title: Returns and credit notes
description: Returns checked piece by piece, credit notes taken from the invoice line, price adjustments, parcels brought back, Cancel and debit notes, and Refund now.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-23'
search_keywords: return credit note debit note price adjustment undelivered parcel refund s.34 deadline rule 53 restock damaged write off cancel super admin
source_of_truth:
    - packages/contracts/src/returns.ts
    - packages/core-domain/src/invoicing/credit-note-rules.ts
    - packages/core-domain/src/ports/returns.repository.ts
    - packages/adapters-db-mongo/src/repositories/returns.repository.ts
    - apps/api/src/returns
    - apps/api/src/documents/credit-note-print.ts
    - apps/admin/src/app/features/order/details/order-returns.ts
    - apps/admin/src/app/features/accounts/return-page.ts
    - apps/admin/src/app/features/accounts/credit-note-page.ts
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

| Rule                     | Detail                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Deadline (CGST Act s.34) | 30 November after the end of the invoice's financial year                                                  |
| One note, one invoice    | Several notes may quote one invoice; together they never give back more than it, in pieces or money        |
| Part of a line           | Each piece's share of the line; the last pieces take what is left, so the notes add up to the line exactly |
| Delivery share           | ₹0 until the CA answers B7.3 ("free delivery" or "waits for the CA")                                       |
| Written-off pieces       | Not added back; the input tax reversal comes with numbered stock adjustments (D5)                          |

## Posting

| Debit                                                   | Credit                           |
| ------------------------------------------------------- | -------------------------------- |
| Sales returns (taxable value), Output CGST/SGST or IGST | Sundry debtors (total), rounding |
| Stock in hand (restocked and damaged pieces at cost)    | Cost of goods sold (the same)    |

Refund: debit Sundry debtors, credit Gateway clearing (gateway) or the chosen cash or bank ledger (by hand). A gateway refund uses our own reference, `cn:<credit note id>`, so a retry never refunds twice.

## Undoing a credit note

- **Cancel**: a super admin only, while the note's month isn't marked filed for its GSTIN, its books are open, and no refund has been paid. Everything is reversed (pieces out, their cost layer and hold, the opposite posting on the note's date) and the return goes back to Checked. The number stays, marked cancelled.
- **Debit note**: once the month is filed or closed, a `DN/` note in the current month undoes it: the opposite posting, and the pieces out of stock again.

## API

| Method | Path                                                 | Permission                    |
| ------ | ---------------------------------------------------- | ----------------------------- |
| GET    | `/admin/orders/:id/returns`                          | `order.index`                 |
| POST   | `/admin/orders/:id/returns`                          | `order.edit`                  |
| POST   | `/admin/orders/:id/price-adjustment`                 | `order.edit`                  |
| POST   | `/admin/orders/:id/parcels/:shipmentId/undelivered`  | `order.edit`                  |
| GET    | `/admin/returns/:id`                                 | `order.index`                 |
| POST   | `/admin/returns/:id/step`, `/check`, `/credit-note`  | `order.edit`                  |
| GET    | `/admin/accounts/credit-notes`, `…/:id`, `…/:id/pdf` | `accounts.index`              |
| PUT    | `/admin/accounts/credit-notes/:id` (draft)           | `accounts.post`               |
| DELETE | `/admin/accounts/credit-notes/:id` (draft)           | `accounts.post`               |
| POST   | `/admin/accounts/credit-notes/:id/issue`             | `accounts.post`               |
| GET    | `/admin/accounts/credit-notes/:id/cancel-checks`     | `accounts.index`              |
| POST   | `/admin/accounts/credit-notes/:id/cancel`            | `accounts.post` (super admin) |
| POST   | `/admin/accounts/credit-notes/:id/debit-note`        | `accounts.post`               |
| POST   | `/admin/accounts/credit-notes/:id/refund`            | `refund.action`               |
| GET    | `/admin/accounts/debit-notes/:id`, `…/:id/pdf`       | `accounts.index`              |

## Collections

`orderReturns` (one per return; saved only when nobody saved it since), `creditNotes` (drafts by version; a number unique within its GSTIN once issued), `debitNotes`.
