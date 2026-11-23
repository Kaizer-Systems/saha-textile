---
title: Tax invoices
description: Tax invoices issued when goods leave, numbered per GSTIN, with HSN and GST on every line, posted to the books, printed as the three Rule 48 copies, and registered as e-invoices.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-24'
search_keywords: tax invoice dispatch shipped GSTIN series HSN GST rate CGST SGST IGST place of supply rule 48 original duplicate triplicate e-invoice IRN e-way bill accounting tab checks
source_of_truth:
    - packages/contracts/src/tax-invoice.ts
    - packages/core-domain/src/invoicing
    - packages/core-domain/src/ports/tax-invoice.repository.ts
    - packages/adapters-db-mongo/src/repositories/ledger.repository.ts
    - apps/api/src/invoicing
    - apps/api/src/documents/tax-invoice-print.ts
    - apps/api/src/edocs/edocs-order-bridge.ts
    - apps/admin/src/app/features/order/details/order-invoices.ts
    - apps/admin/src/app/features/accounts/invoice-view.ts
---

# Tax invoices

A tax invoice is issued when goods leave. Each parcel of an order gets one invoice, and a line is never invoiced twice. The invoice is its own document (`taxInvoices`), never edited: a credit note corrects it.

Issuing is switched by **Settings › Features › Tax invoices at dispatch** (`tax_invoices`, off by default). While it is off, Shipped works without invoices.

## When an invoice is issued

| Moment                                             | What happens                                                                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mark shipped                                       | The parcel's invoice is issued inside the Shipped transaction (`InvoicesService.issueAtDispatch`). A repeat for the same parcel returns the first invoice. |
| Generate e-way bill or e-invoice on a packed order | The portal needs the invoice's number, so the invoice is issued first (`issueBeforeDispatch`), with no parcel yet. Pressing Generate again reuses it.      |
| Mark shipped after that                            | The waiting invoice is tied to the parcel (`linkShipment`) instead of a second one being issued.                                                           |

An order that isn't packed yet gets no invoice from Generate; its e-document is recorded against the order, as before invoices existed.

## Numbers

Numbers come from the `taxInvoice` series of Settings › Document numbering (`TI/26-27/000001`), with one counter per GST registration: the counter is `doc:taxInvoice@<gstRegistrationId>`. A number is unique within its GSTIN.

The registration is the ships-from location's (Settings › Locations), or the one holding the shop's GSTIN when the location has none.

## Lines and tax

Shop prices include GST. For each line the taxable value is taken out of what the buyer paid at the line's rate: taxable = total ÷ (1 + rate), worked in paise.

The rate comes from the line's HSN (`gstRateFor`) until the CA confirms the rates:

| HSN chapter                           | Rate                               |
| ------------------------------------- | ---------------------------------- |
| 50–60 (fabrics, sarees)               | 5%                                 |
| 61–63 (garments and made-up textiles) | 5% up to ₹2,500 a piece, 18% above |
| Anything else, or no HSN              | No rate: the invoice is refused    |

Every invoice is marked `ratesPendingCa`. The admin screens show it ("Rates wait for the CA" on the order's invoice card, and in the invoice's Checks); the printed copies don't carry it.

The place of supply is the delivery State (`96` abroad). The same State as the seller's registration means CGST and SGST, split in half; another State means IGST. The order's delivery charge goes on its first invoice, taxed at the highest rate on that invoice.

When a line can't be invoiced, Shipped or Generate is refused with `invoice_problem:<problem>[:<sku>]`. The admin shows it in words:

| Problem               | Meaning                                                    |
| --------------------- | ---------------------------------------------------------- |
| `hsn_missing`         | The product has no HSN code                                |
| `hsn_rate_missing`    | No rate is known for the HSN code                          |
| `no_location`         | The order has no location to ship from                     |
| `no_gst_registration` | The location has no GST registration and the shop has none |

## Posting

The invoice posts one voucher in the same transaction (`invoicePosting`, idempotency key `taxInvoice:<id>`), at the ships-from location:

| Debit                                                      | Credit                                      |
| ---------------------------------------------------------- | ------------------------------------------- |
| Customer advances (paid before dispatch) or Sundry debtors | Sales (taxable value)                       |
| Cost of goods sold (the pieces' cost, oldest layers first) | Output CGST and SGST, or Output IGST        |
|                                                            | Rounding off (when the total is rounded up) |
|                                                            | Stock in hand (the same cost)               |

## Prints

`GET /admin/orders/:id/invoices/:invoiceId/pdf?copy=original|duplicate|triplicate|all` renders the invoice on the active tax invoice format. The copy label sits under the title, in Rule 48's order: Original for recipient, Duplicate for transporter, Triplicate for supplier. `all` puts the three in one file, each from a new page, without a page counter running across them. An invoice with an IRN carries the e-invoice band in its foot.

## E-invoices

E-documents are recorded against the invoice (`documentId` is the invoice's id). With a tested automatic e-invoice path, Generate sends the invoice as it is (`saleFromTaxInvoice`): the same number, date, lines and totals, with the delivery charge as one service line (SAC 996812). A duplicate (error 2150) fetches the existing IRN; a refusal is shown with its code; no answer opens the by-hand popup. See [E-invoice and e-way bill](../gst-edocs/overview.md).

The automatic e-way bill needs Part B (transporter or vehicle) from the courier booking, which isn't connected; Generate e-way bill opens the by-hand popup and names the invoice to enter on the portal.

## Screens

- **Order page › Tax invoice card:** each invoice with its number and day, **Print** and **Download** with the three copies or all three, **Email to buyer** (shown, waiting for invoice emails), and **Accounting** for people who may see the books.
- **Accounts › the invoice's page** (`/accounts/invoices/:id`, `accounts.index`): Details, Accounting (the lines it posted, by ledger and location), Checks, Edit log and Prints, with "Checks it passed" beside: period open, number in series with no gap, place of supply, stock at cost, GST rates, and cancel (always through a credit note).

## API

| Method | Path                                               | Permission       |
| ------ | -------------------------------------------------- | ---------------- |
| GET    | `/admin/orders/:id/invoices`                       | `order.index`    |
| GET    | `/admin/orders/:id/invoices/:invoiceId/pdf?copy=`  | `order.index`    |
| GET    | `/admin/orders/:id/invoices/:invoiceId/accounting` | `accounts.index` |
| GET    | `/admin/accounts/invoices/:id`                     | `accounts.index` |
| GET    | `/admin/accounts/invoices/:id/accounting`          | `accounts.index` |

## Cancelling

An issued invoice isn't cancelled from here. Until the CA answers question B6.4 (cancel before dispatch, or a credit note), every correction is a credit note, which quotes the invoice.
