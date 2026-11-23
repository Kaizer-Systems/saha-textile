---
title: E-invoice and e-way bill
description: The five paths for e-invoices (IRN and signed QR) and e-way bills, the settings that choose them, and how the order page uses them.
status: implemented
audience: [backend, frontend, operator]
last_verified: '2026-11-23'
search_keywords: e-invoice IRN signed QR e-way bill EWB IRP IRIS NIC GSP Masters India by hand portal
source_of_truth:
    - packages/contracts/src/edocs.ts
    - packages/core-domain/src/edocs/edoc-rules.ts
    - packages/core-domain/src/ports/edocs.port.ts
    - packages/adapters-gst-edocs/src
    - apps/api/src/edocs
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# E-invoice and e-way bill

An e-invoice is a tax invoice registered with an Invoice Registration Portal (IRP). The IRP returns an IRN (64 hexadecimal characters, the SHA-256 of the supplier GSTIN, the financial year, the document type and number), an acknowledgement number and time, and a signed QR code. Printing those on the tax invoice is what makes it an e-invoice; there is no separate document.

An e-way bill (EWB) is a separate document for goods on the move: Part A describes the goods, Part B the transport.

## Where each applies

| Document | Applies to | Never |
| --- | --- | --- |
| E-invoice | Buyers with a GSTIN (B2B), exports and SEZ, from a GSTIN that the portal shows as enabled (aggregate turnover above ₹5 crore in any year since 2017-18) | Shoppers without a GSTIN |
| E-way bill | Goods of the threshold value or more on the move (₹50,000; inter-State, and in West Bengal intra-State as well): shop parcels, business sales, stock transfers, goods sent to a tailor or an exhibition | Services-only documents |

An e-invoice-enabled supplier's B2B or export tax invoice gets its e-way bill only through the e-invoice system (with the IRN or later by IRN); the e-way bill API refuses it.

## Five paths, one set of buttons

Settings › E-invoice and e-way bill chooses a path per document for the business's GSTIN. The order page shows **Generate e-invoice** and **Generate e-way bill** in every path; once done, they turn into the printed result.

| Path | Document | How it works | Cost |
| --- | --- | --- | --- |
| By hand | Both | Generate opens a popup. E-invoice: the portal upload file (INV-01 JSON), then the portal's signed file is uploaded back, or the IRN, acknowledgement and date are typed (no QR then). E-way bill: the details to type on the portal, then the number (12 or 14 digits), dates and the portal's PDF. | Free |
| Direct | E-invoice | `IrpDirectEInvoiceGateway`: an IRP that speaks NIC's API (IRIS IRP 6 on its free plan; NIC from ₹100 crore turnover). | Free |
| Provider | E-invoice | `MastersIndiaEInvoiceGateway`: a GST Suvidha Provider. | Paid |
| Direct | E-way bill | `EwbDirectGateway`: NIC's e-way bill API (about 10,000 e-way bills a month per GSTIN, up to 3 whitelisted Indian addresses). | Free |
| Provider | E-way bill | `MastersIndiaEWayBillGateway`. | Paid |

An automatic path can be chosen only after its keys pass **Test**. When it doesn't answer (`EDocUnavailableError`), Generate opens the by-hand popup and the activity log records why. A duplicate IRN (error 2150) is answered by fetching the existing IRN by document details.

## Keys

Keys are entered in Settings and sealed with AES-256-GCM under the server key `EDOC_KEYS_KEY` in the `edocKeys` collection; they are never returned, shown again or logged. Without `EDOC_KEYS_KEY` only the by-hand path is offered.

| Path | Needs |
| --- | --- |
| Direct e-invoice | API user name and password made on the IRP for API use (its own email), client ID and secret, the IRP's public key (PEM), the IRP's base address, 1–4 whitelisted Indian addresses, a sandbox test report |
| Direct e-way bill | Same, on the e-way bill portal under Registration › API |
| Provider | The provider's user, password, client ID and secret, and an API user made on the government portal "for GSP" |

## Data

| Collection | Holds |
| --- | --- |
| `edocSettings` | One per GSTIN: the path per document, e-invoice enabled-from date, e-way bill threshold, and each path's key summary (never the secrets) |
| `eDocuments` | One per IRN or e-way bill: document, buyer, value, IRN, acknowledgement, signed QR, e-way bill number, validity, Part B, how made, cancellation. One active record of a kind per document |
| `edocCalls` | The activity log: time, GSTIN, path, action, document, result, code and message |
| `edocKeys` | The sealed secrets of each automatic path |

## API

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/admin/edocs/settings` | `setting.index` |
| PUT | `/admin/edocs/settings` | `edocs.settings` |
| PUT | `/admin/edocs/keys` | `edocs.settings` |
| DELETE | `/admin/edocs/keys/:path` | `edocs.settings` |
| POST | `/admin/edocs/keys/:path/test` | `edocs.settings` |
| GET | `/admin/edocs/documents?kind=eInvoice\|eWayBill` | `order.index` |
| GET | `/admin/edocs/activity` | `edocs.settings` |

The order page keeps its existing endpoints: `POST /admin/orders/:id/e-invoice/raise` and `/e-way-bill/raise` go through `EDocsOrderBridge`, and `PUT /admin/orders/:id/e-invoice` and `/e-way-bill` record what was entered by hand.

## Printing

An invoice with an IRN prints the e-invoice band at the foot of every page: the signed QR (about 31 mm), the IRN, the acknowledgement number and date, and the e-way bill number. The renderer's `footerHtml` carries it (Chromium's footer template). An IRN typed without the signed file prints "QR pending". Invoices without an IRN keep their usual foot.

Copies follow CGST Rule 48: Original for recipient, Duplicate for transporter, Triplicate for supplier.

## Time limits

| Rule | Limit |
| --- | --- |
| Cancel an IRN | Within 24 hours, and only with no active e-way bill on it |
| Cancel an e-way bill | Within 24 hours, by its generator |
| Extend an e-way bill | From 8 hours before to 8 hours after it ends, up to 360 days from generation |
| E-way bill after the document date | Within 180 days |
| E-way bill validity | One day per 200 km (20 km for over-dimensional cargo); each day ends at midnight, the first at the midnight after generation |
| Report an e-invoice | Within 30 days of the document date from ₹10 crore turnover |
