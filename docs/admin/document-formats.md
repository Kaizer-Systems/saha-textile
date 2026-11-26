---
title: Settings › Document formats
wide: true
description: How every printable document is laid out — one active format per document, the format builder, the renderer that turns a format and a document into HTML and PDF, and which screens print on it.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-23'
source_of_truth:
    - packages/contracts/src/document-formats.ts
    - packages/core-domain/src/documents/specs.ts
    - packages/core-domain/src/documents/formats.ts
    - packages/adapters-db-mongo/src/models/document-format.model.ts
    - packages/adapters-db-mongo/src/repositories/document-format.repository.ts
    - packages/adapters-db-mongo/src/migrations/document-formats.ts
    - apps/api/src/documents
    - packages/core-domain/src/documents/words.ts
    - apps/admin/src/app/features/setting/document-formats
---

# Settings › Document formats

A **document format** is the layout one kind of document prints with: its blocks in order, each block showing only fields that document has, plus the paper (A4, A5 or an 80 mm counter roll). Formats are data in the `documentFormats` collection, so the same record feeds the builder's preview, the PDF and every print.

## Documents

Seventeen documents, in four groups:

| Group              | Documents                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Sales              | Tax invoice, Credit note, Debit note, Receipt voucher, Refund voucher, Delivery challan                              |
| Orders and parcels | Packing slip, Return note                                                                                            |
| Purchases          | Purchase order, Goods receipt (purchase entry), Purchase return note, Self-invoice (reverse charge), Payment voucher |
| Stock and accounts | Stock adjustment, Stock count sheet, Opening stock, Journal voucher                                                  |

`DOCUMENT_SPECS` in core lists, for each document, the blocks it may hold and each block's fields. **Locked fields** are the ones the law needs (GSTIN, HSN, the tax split, place of supply, the document number and date); they stay ticked. **Required blocks** (seller, details, lines, totals, signature on GST documents) can't be hidden. A block type appears once per format, except text blocks.

Block types: logo and seller, title and copy label, document details, addresses, e-invoice (IRN, ack, QR), e-way bill, items table, HSN summary, totals and round off, amount in words, payment, notes (a field of the document such as its reason), text (words the shop types), declaration and signature, footer and page numbers.

## One active format per document

Exactly one format per document is active. A partial unique index on `doc` where `active: true` enforces it, and switching runs in one transaction: the old format goes off, the new one on.

- **Switch on** (`POST /admin/document-formats/:id/switch-on`) answers with the format that went off, and the page says "Tax invoice now prints with "Compact". "Saha Textile standard" was switched off."
- **Switch off** (`POST …/switch-off`) is always refused with a reason the page shows under that document's table: `document_format_only_format` (make another layout first) or `document_format_switch_another`.

The release step `0016-document-formats` seeds **Saha Textile standard** for every document (switched on) and, for the tax invoice, **Compact** (A5) and **Counter receipt** (80 mm roll), switched off. It never overwrites a stored format and never takes "active" from a document that already has one.

## The page (`/setting/document-formats`)

One table per document under its group, with "numbers like TI/26-27/000001" from Settings › Document numbers and "N formats · exactly one active". Each row: name, paper, about, last changed, the switch with an Active or Off pill, and four actions — preview the example as a PDF, edit (opens the builder), make a copy (switched off) and download the example PDF.

**Make New Layout** asks which document and whether to start from our format or blank, then opens the builder on the new, inactive layout. A blank start holds only the required blocks with their locked fields; the builder offers the rest under **More blocks**.

Reading needs `setting.index`; every change needs `setting.edit`.

## The format builder (`/setting/document-formats/:id`)

- **Left:** the layout's blocks. Drag to reorder (CDK drag and drop), the eye hides or shows a block, a lock marks a block the document needs. **Add a text block** inserts one above the signature; text blocks can be removed.
- **Middle:** the page as it prints. After each change the builder posts the unsaved blocks to `POST /admin/document-formats/:id/preview`; the server draws the document's worked example and the builder shows that HTML in a sandboxed frame with no scripts.
- **Right:** the chosen block's settings — its fields in the document's own order (locked ones ticked and disabled), and for the items table of a document that prints sets, the fixed set rows and text sizes for heading rows, piece rows and free items. With no block chosen: the layout's name, about and paper.
- **Draft / Saved**, **Preview PDF** (the unsaved layout as a PDF) and **Save format** (`PUT /admin/document-formats/:id` with the version it opened; a clash answers `document_format_changed`).

The server checks every save and preview with `checkFormatBlocks`: unknown blocks, fields the document doesn't have, a locked field left off, a required block hidden or missing, a block twice, an id twice.

## The renderer

`apps/api/src/documents/document-html.ts` turns a format and a document's data (`DocumentData`: values, address boxes, rows, totals, signatures) into one HTML page:

- the paper as a CSS `@page` rule; page numbers ("Page 1 of 2") and, on pages after the first, a running header with the document, its number and the shop;
- a set as a heading row with no amount or tax and its price in words, its pieces indented with their own HSN and tax ("share of set"), free items in green italics at ₹0 with the printed price struck, extras tagged;
- totals closing with the total, round off just above it;
- every value escaped; the running header escapes quotes, backslashes and `<` for CSS.

PDFs go through `DocumentRendererPort` (the Chromium adapter) with the Brand Kit logo and the shop's fonts as in-memory files. The shop's own name, address and GSTIN come from Settings › Shop details.

## What prints on it

| Document                                            | Where                                                                        | Endpoint                                              |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| Packing slip                                        | Orders › Order › Pack list › **Print pack list**                             | `GET /admin/orders/:id/packing-slip`                  |
| Purchase order                                      | Purchases › Purchase order PDF                                               | `GET /admin/purchase-orders/:id/pdf`                  |
| Goods receipt                                       | Purchase entry PDF                                                           | purchasing prints                                     |
| Debit note, delivery challan                        | Purchase return PDFs                                                         | purchasing prints                                     |
| Receipt voucher (order)                             | Orders › Order › Payments, the printer beside the receipt number             | `GET /admin/orders/:id/payments/:paymentId/receipt`   |
| Receipt voucher, journal voucher (business account) | Businesses › Business › Customer account, the printer beside an RC or JV row | `GET /admin/businesses/:id/documents/:documentId/pdf` |
| Stock count sheet                                   | Stock › Counts › Count, the printer beside the count number                  | `GET /admin/stock-counts/:id/sheet-pdf`               |
| Opening stock                                       | Stock › Opening stock › Posted loads, the printer beside each number         | `GET /admin/opening-stock/:id/pdf`                    |

The packing slip prints the Pack list flat: every piece with a tick box and where it came from ("Peacock Blue set, piece 1", "Free with piece 1 of …", "Line 2"), and no prices.

## Limitations

- A receipt voucher prints the place of supply from the delivery State (outside India: 96) and the amount in words (`rupeesInWords`, core documents). A count sheet follows the count's blind rule: a counter who may not see expected figures gets none on paper. Opening stock prints cost and value only for `stock.cost`.
- Tax invoices wait on the CA's answers. Credit notes and refund vouchers wait on returns and refunds, payment vouchers on supplier payments, self-invoices on reverse-charge purchases, and stock adjustments on a number series of their own: each has a format, a preview and a PDF of its worked example, but nothing issues it yet.
- The theme's invoice template remains in `purchasing/` as the fallback when no formats are present.
- HSN codes, rates and the GSTIN in the worked examples are examples.
