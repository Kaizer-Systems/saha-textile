---
title: Masters India provider
description: The provider path for e-invoices and e-way bills through Masters India's plain-JSON API.
status: implemented
audience: [backend, operator]
last_verified: '2026-11-23'
search_keywords: Masters India GSP generateEinvoice cancelEinvoice ewayBillsGenerate updateVehicleNumber ewayBillCancel ewayBillValidityExtend access_token
source_of_truth:
    - packages/adapters-gst-edocs/src/masters-india.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Masters India provider

Source: docs.mastersindia.co (the plain-JSON "vanila" pages), read on 23 November 2026. The provider path suits any volume and is paid; a written quote comes before it is switched on.

## Sign-in

POST `{base}/oauth/access_token` with `{username, password, client_id, client_secret, grant_type: "password"}` returns `{access_token, expires_in}`. The token travels in the request body (`access_token`) or the query, not in a header. Payloads are plain JSON over TLS.

## Answers

`{results: {message, errorMessage, status: "Success" | "Failed" | "No Content", code: 200 | 204, requestId}}`. On success `message` is the answer; on failure the e-invoice calls put the reason in `errorMessage` (for example `2150: Duplicate IRN`) and the e-way bill calls put it in `message`.

## E-invoice

| Call          | Path                             | Notes                                                                                                                                                                                                                                                                                |
| ------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Generate      | POST `/generateEinvoice`         | snake_case body built by `mastersIndiaInvoiceBody` from the INV-01 JSON (`user_gstin`, `transaction_details`, `document_details`, `seller_details`, `buyer_details`, `value_details`, `ewaybill_details`, `item_list`); the answer uses NIC's names (`Irn`, `AckNo`, `SignedQRCode`) |
| Cancel        | POST `/cancelEinvoice`           | `{user_gstin, irn, cancel_reason "1"–"4", cancel_remarks}`                                                                                                                                                                                                                           |
| By document   | GET `/getIrnDetailsByDocDetails` | `user_gstin, document_type, document_number, document_date`                                                                                                                                                                                                                          |
| GSTIN details | GET `/gstinDetails`              | `user_gstin, gstin`                                                                                                                                                                                                                                                                  |

Their plain-JSON documentation lists e-way bill by IRN only as SOAP, so this path makes the e-way bill together with the e-invoice (`ewaybill_details`).

## E-way bill

| Call     | Path                                                             |
| -------- | ---------------------------------------------------------------- |
| Generate | POST `/ewayBillsGenerate` (body from `mastersIndiaEWayBillBody`) |
| Part B   | POST `/updateVehicleNumber`                                      |
| Cancel   | POST `/ewayBillCancel`                                           |
| Extend   | POST `/ewayBillValidityExtend`                                   |

Their pages don't publish separate sandbox and production addresses, so the base address is a setting. Some field values (state codes or names, reason texts) are not fixed by their pages; the path's Test and a sandbox generate confirm them before it is switched on.
