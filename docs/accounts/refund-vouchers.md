---
title: Refund vouchers
description: Cancel and refund a paid order before its invoice; the refund voucher (Rule 51) made with each refund, tried again or paid by bank transfer when the gateway refuses.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: refund voucher RF rule 51 advance cancel paid order cancel and refund gateway refund retry bank transfer customer advance gateway clearing
source_of_truth:
    - packages/contracts/src/refund-vouchers.ts
    - packages/core-domain/src/invoicing/refund-voucher-rules.ts
    - packages/adapters-db-mongo/src/repositories/returns.repository.ts
    - apps/api/src/returns/refund-vouchers.service.ts
    - apps/api/src/returns/refund-vouchers.controller.ts
    - apps/api/src/documents/refund-voucher-print.ts
    - apps/admin/src/app/features/order/details/order-status-popup.ts
    - apps/admin/src/app/features/accounts/refund-voucher-page.ts
---

# Refund vouchers

Money paid for an order that is cancelled before anything was invoiced is an advance returned with no supply. The law wants a refund voucher against the receipt (CGST Rule 51). Once a tax invoice exists, the credit note is the tax document and the refund is paid against it instead (see [Returns and credit notes](./returns-and-credit-notes.md)).

## Cancel and refund (C1)

On a paid order before Packed, Update status › Cancelled shows what was paid, its receipt, and that it has no invoice. The Refund choice is either:

- **To the original payment, through the gateway**: offered only when every payment came through the gateway.
- **By bank transfer**: choose the cash or bank ledger it is paid from and type its reference (UTR).

"What this changes" lists the order (cancelled, held pieces free to sell), the payment, the refund voucher against its receipt, and the cancellation and refund message to the customer.

The cancel itself is the order's own Cancelled step, unchanged (stock released, the customer told). The API then gives back each received payment in full, each with its own voucher. A paid order that already has an issued tax invoice is refused (`refund_after_invoice_needs_credit_note`).

## The voucher (C2)

| Field              | Detail                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Number             | `RF/26-27/000003` (the RF series in Settings › Document numbers)                             |
| Date               | The refund's date                                                                            |
| Against receipt    | The payment's RC number and date                                                             |
| How                | Gateway refund with our own reference, or Bank transfer with its UTR                         |
| Status             | Refunded · Waiting for the gateway (no answer yet) · Failed: try again (the gateway refused) |
| Tax on the advance | None: an advance for goods carries no GST                                                    |
| Can be cancelled   | No. A voucher is made with the refund and never edited, deleted or cancelled                 |

A failed or waiting voucher offers **Try again** (the gateway is asked again with the same reference, so it can never refund twice) and **Pay by bank transfer** (from a cash or bank ledger, with its UTR). The page shows the edit log (issue, the gateway's answer, retries, payment by hand, prints) and what it changed.

The gateway reference is `RF` followed by the payment's id with everything but letters and digits removed, at most 30 characters (CCAvenue's limit). Credit-note refunds use the same rule with `CN`.

## Posting

Once the money has gone back (refunded):

| Debit            | Credit                                                              |
| ---------------- | ------------------------------------------------------------------- |
| Customer advance | Gateway clearing (gateway refund) or the chosen cash or bank ledger |

The payment is marked Refunded in the same transaction. Nothing is posted while a voucher waits or has failed.

Receipt vouchers do not post to the books; Customer advances therefore holds only the refund side of an advance.

## API

| Method | Path                                                    | Permission                       |
| ------ | ------------------------------------------------------- | -------------------------------- |
| POST   | `/admin/orders/:id/cancel-and-refund`                   | `order.edit` and `refund.action` |
| GET    | `/admin/accounts/refund-vouchers/:id`, `…/log`, `…/pdf` | `accounts.index`                 |
| POST   | `/admin/accounts/refund-vouchers/:id/retry`             | `refund.action`                  |
| POST   | `/admin/accounts/refund-vouchers/:id/by-hand`           | `refund.action`                  |

Refusals: `nothing_to_refund`, `refund_after_invoice_needs_credit_note`, `refund_payment_not_by_gateway`, `refund_needs_cash_or_bank`, `refund_needs_a_location`, `refund_voucher_already_refunded`, `refund_voucher_not_by_gateway`, `refund_voucher_changed`.

## Collection

`refundVouchers`: one per refunded payment (unique `paymentId`), RF numbers unique. The order's Documents card lists them with view and print.
