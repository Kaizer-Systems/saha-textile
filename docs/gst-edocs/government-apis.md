---
title: Government e-invoice and e-way bill APIs
description: NIC's e-invoice API (auth v1.04, core v1.03), IRIS IRP 6, and NIC's e-way bill API v1.03 as the direct adapters use them.
status: implemented
audience: [backend]
last_verified: '2026-11-23'
search_keywords: NIC IRP auth v1.04 generate IRN cancel SEK AppKey RSA AES ECB GENEWAYBILL VEHEWB CANEWB EXTENDVALIDITY IRIS IRP 6 einv-apisandbox
source_of_truth:
    - packages/adapters-gst-edocs/src/nic-crypto.ts
    - packages/adapters-gst-edocs/src/irp-direct.ts
    - packages/adapters-gst-edocs/src/ewb-direct.ts
    - packages/core-domain/src/edocs/edoc-rules.ts
---

# Government e-invoice and e-way bill APIs

Sources: the NIC e-invoice API developer portal (einv-apisandbox.nic.in, current version 1.04 for authentication and GSTIN details, 1.03 for the rest), the IRIS IRP knowledge base (einvoice6.gst.gov.in) and the NIC e-way bill API portal (docs.ewaybillgst.gov.in/apidocs, version 1.03), read on 23 November 2026.

## Session encryption (both systems)

1. A random 32-byte app key is made for each session.
2. Sign-in: the credentials JSON is Base64-encoded, then RSA-encrypted (PKCS#1 v1.5) with the system's public key, and sent as `{"Data": "…"}`.
3. The answer carries an auth token and the session key (SEK), AES-256-ECB-encrypted with the app key.
4. Later requests encrypt their JSON with the SEK (AES-256-ECB, PKCS#7) and send it Base64-encoded; answers are decrypted the same way.
    - E-invoice: the JSON bytes are encrypted.
    - E-way bill: the JSON is Base64-encoded first, then encrypted (`Encrypt(Base64(JSON), sek)`).
5. The token lives 360 minutes (60 on the e-invoice sandbox). Calling sign-in again returns the same token without extending it; `ForceRefreshAccessToken` renews it in its last 10 minutes.

## E-invoice (NIC standard; IRIS IRP 6 follows it)

| Call              | Method and path (NIC prefixes)                                            | Body or answer                                                                                                            |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Sign in           | POST `/eivital/v1.04/auth`, headers `client_id`, `client_secret`, `Gstin` | `{UserName, Password, AppKey, ForceRefreshAccessToken}` → `{AuthToken, Sek, TokenExpiry}`                                 |
| Generate IRN      | POST `/eicore/v1.03/Invoice`                                              | INV-01 v1.1 → `{AckNo, AckDt, Irn, SignedInvoice, SignedQRCode, Status, EwbNo, EwbDt, EwbValidTill}`                      |
| Cancel IRN        | POST `/eicore/v1.03/Invoice/Cancel`                                       | `{Irn, CnlRsn: "1" duplicate · "2" data entry mistake · "3" order cancelled · "4" others, CnlRem}` → `{Irn, CancelDate}`  |
| IRN by document   | GET `/eicore/v1.03/Invoice/irnbydocdetails?doctype=&docnum=&docdate=`     | Same answer as Generate; within 3 days                                                                                    |
| GSTIN details     | GET `/eivital/v1.04/Master/gstin/{gstin}`                                 | `{Gstin, LegalName, TradeName, StateCode, AddrPncd, Status: ACT·CNL·INA·PRO, BlkStatus: U·B}`                             |
| E-way bill by IRN | POST `/eiewb/v1.03/ewaybill`                                              | `{Irn, Distance, TransMode, TransId, TransName, TransDocNo, TransDocDt, VehNo, VehType}` → `{EwbNo, EwbDt, EwbValidTill}` |

Calls after sign-in carry `client_id`, `client_secret`, `Gstin`, `user_name` and `AuthToken`. Errors come as `ErrorDetails`: a list (or Base64 JSON list) of `{ErrorCode, ErrorMessage}`.

The paths are NIC's service prefixes; each IRP publishes its own host, so the base address and, if needed, the paths are settings (`IRP_PATHS`). Confirm them in the IRP's sandbox before switching the path on.

### The invoice JSON (INV-01 v1.1)

`buildEInvoiceJson` in core builds it from our invoice:

- `TranDtls`: `TaxSch` "GST", `SupTyp` (B2B, SEZWP, SEZWOP, EXPWP, EXPWOP, DEXP), `RegRev`, `IgstOnIntra`.
- `DocDtls`: `Typ` INV, CRN or DBN; `No` up to 16 characters (letters, digits, `/`, `-`; not starting with 0, `/` or `-`); `Dt` dd/mm/yyyy.
- `SellerDtls`, `BuyerDtls` (`Gstin` or `URP`, `Pos`; exports use state 96 and PIN 999999), optional `DispDtls`, `ShipDtls`.
- `ItemList` (1–1000): `SlNo`, `PrdDesc`, `IsServc`, `HsnCd`, `Qty`, `Unit` (UQC), `UnitPrice`, `TotAmt`, `Discount`, `AssAmt`, `GstRt`, `IgstAmt`, `CgstAmt`, `SgstAmt`, `CesAmt`, `TotItemVal`.
- `ValDtls`: `AssVal`, `CgstVal`, `SgstVal`, `IgstVal`, `CesVal`, `Discount`, `OthChrg`, `RndOffAmt` (±99.99), `TotInvVal`.
- `EwbDtls` when the e-way bill is made in the same call.

The IRP accepts each value within its tolerance: from one rupee below the rupee part of the calculated value to one rupee above the next rupee (`withinGovTolerance`). `eInvoiceProblems` runs the same checks before sending.

### IRIS IRP 6

- Direct API for any taxpayer whose GSTIN is e-invoice enabled; the Basic plan is free and includes the API, the e-way bill with the e-invoice, and the e-way bill by IRN within 2 days. Updating the vehicle and extending are not in Basic.
- Production access needs: the GST certificate, PAN, certificate of incorporation (companies), website, privacy policy and terms, 1–4 Indian static addresses, a contact person, the test report `EInvoiceAPITestSummary1.03`, and an OTP to the authorised signatory. The API user's email must differ from the taxpayer login; its password expires every 60 days.
- IRIS keeps data for 2 days on Basic; the API keeps its own copy of every IRN, signed invoice and signed QR.

## E-way bill (NIC, v1.03)

| Call     | Request                                                                                                                                                                                                          | Answer                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sign in  | POST `/ewaybillapi/v1.03/auth`, headers `client-id`, `client-secret`, `Gstin`; `{action: "ACCESSTOKEN", username, password, app_key}`                                                                            | `{status, authtoken, sek}`                     |
| Generate | POST `/ewaybillapi/v1.03/ewayapi` `{action: "GENEWAYBILL", data}`                                                                                                                                                | `{ewayBillNo, ewayBillDate, validUpto, alert}` |
| Part B   | `VEHEWB` `{ewbNo, vehicleNo, fromPlace, fromState, reasonCode 1 breakdown · 2 transhipment · 3 others · 4 first time, reasonRem, transDocNo, transDocDate, transMode, vehicleType}`                              | `{vehUpdDate, validUpto}`                      |
| Cancel   | `CANEWB` `{ewbNo, cancelRsnCode 1 duplicate · 2 order cancelled · 3 data entry mistake · 4 others, cancelRmrk}`                                                                                                  | `{ewayBillNo, cancelDate}`                     |
| Extend   | `EXTENDVALIDITY` `{ewbNo, vehicleNo, fromPlace, fromState, remainingDistance, transDocNo, transDocDate, transMode, extnRsnCode, extnRemarks, fromPincode, consignmentStatus M · T, transitType, addressLine1–3}` | `{ewayBillNo, updatedDate, validUpto}`         |

Action calls carry `client-id`, `client-secret`, `gstin` and `authtoken`. Errors come as `{status: "0", error: {errorCodes: "238,"}}`, sometimes Base64-wrapped.

`buildEWayBillJson` makes the GENEWAYBILL body: `supplyType` O, `subSupplyType` (1 supply, 3 export, 4 job work, 5 own use, 7 sales return, 8 others, 12 exhibition), `docType` INV or CHL, consignor and consignee with their actual states, `transactionType` (1 regular, 2 bill-to-ship-to, 3 bill-from-dispatch-from, 4 both), values, `transMode` (1 road, 2 rail, 3 air, 4 ship, 5 in transit, 6 metro rail), `transDistance` as text (0 asks the system for the PIN-to-PIN distance), and up to 250 items. Road needs a vehicle number; rail, air, ship and metro need the transport document number; a transporter ID alone makes Part A only.

## Testing

`packages/adapters-gst-edocs/test/edoc-adapters.test.ts` runs both direct adapters against a stand-in server that performs the same RSA sign-in and AES session encryption, so the encryption, headers and answer parsing are exercised end to end. Before switching a path on in production, run Test in Settings against the sandbox.
