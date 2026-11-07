---
title: CCAvenue
slug: /payments/ccavenue
description: "The INR gateway role: HDFC's documentation and the calls this project will make."
status: planned
audience: [backend, operator]
last_verified: '2026-11-07'
search_keywords: CCAvenue HDFC VAS K R MARKETING ONLINE integration kit non-seamless initiateTransaction encResp orderStatusTracker refundOrder DoWebTrans working key access code
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/contracts/src
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/api/route-inventory.md
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue

CCAvenue is the INR online gateway, provided through HDFC Bank for merchant **K R MARKETING ONLINE**.

This page has two sections. **Section 1** is what HDFC and CCAvenue provided, transcribed in full on the pages it links to. **Section 2** is the calls this project will actually make, in the project's API-documentation format, with where each one will be used. No CCAvenue code exists, so every entry in section 2 is marked **not wired**.

## 1. Company-provided documentation

### Documents included

| File                                                        | What it is                                                                                                                       | Transcribed on                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration and Audit checklist (PDF, 3 pages)              | URL, transaction-flow, and status-API requirements, plus the seven security-audit checks.                                        | [Audit and go-live](/payments/ccavenue/audit-and-go-live)                                                                                                             |
| HDFC VAS CCAvenue integration guide (PDF, 35 pages, Public) | Hosted checkout, status enquiry, hygiene, go-live, and best practices.                                                           | [Hosted checkout](/payments/ccavenue/hosted-checkout), [Status enquiry](/payments/ccavenue/status-enquiry), [Audit and go-live](/payments/ccavenue/audit-and-go-live) |
| HDFC API Doc v1.3 (PDF), earlier copy                       | Merchant's API Implementation Guide. Superseded by the kit revision below.                                                       | [Merchant API differences](/payments/ccavenue/merchant-api#differences-from-the-earlier-copy)                                                                         |
| `Web_Integration_Non_Seamless.zip` — "integration kits"     | CCAvenue Integration Document v3.1 (47 pages) and non-seamless kits for ASP.NET, JSP, Node JS, Perl, PHP, Python, Ruby on Rails. | [Web integration kit](/payments/ccavenue/web-integration-kit)                                                                                                         |
| `API_Document_Sample_Code-New.zip` — "API sample kits"      | HDFC API Doc v1.3 (172 pages, May 2023 revision) and Status API kits for ASP.NET, Java, and PHP.                                 | [Merchant API](/payments/ccavenue/merchant-api), [Status enquiry § kits](/payments/ccavenue/status-enquiry#status-api-sample-kits)                                    |

### Credentials

Every CCAvenue document says the same three values come from the CCAvenue **M.A.R.S** account, **Settings → API Keys**:

| Value                               | Used for                                                     | Where it will live in this project          |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Merchant ID                         | `merchant_id` inside the encrypted transaction request       | `CCAVENUE_MERCHANT_ID` (server env)         |
| Access Code                         | Sent in clear beside every encrypted payload (`access_code`) | `CCAVENUE_ACCESS_CODE` (server env)         |
| Working Key (also "Encryption Key") | AES key material for every request and response              | `CCAVENUE_WORKING_KEY` (server env, secret) |

The variable names are those already catalogued in [Environment variables](/engineering-live-context/environment-variables), with `CCAVENUE_BASE_URL`; no code reads them. The merchant API also requires the server's **public IP** to be registered with CCAvenue before any API call works.

The kits ship with hard-coded keys and access codes that belong to someone else. None of them has been copied into this repository; every sample on these pages uses `<MERCHANT_ID>`, `<ACCESS_CODE>`, and `<WORKING_KEY>`.

### Environments and URLs

| Purpose                                           | Test / staging                                                                            | Production                                                                           | Source                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Hosted billing page (non-seamless)                | `https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction`        | `https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction` | Integration Document v3.1 |
| Direct Connect payload (not for us; see below)    | `https://test.ccavenue.com/transaction/transaction.do?command=initiatePayloadTransaction` | Not printed                                                                          | Integration Document v3.1 |
| Merchant API (status, refund, lookup, settlement) | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans`                                    | `https://api.ccavenue.com/apis/servlet/DoWebTrans`                                   | Merchant API guide        |

The sample code also uses `secure.ccavenue.com/transaction.do` (no `/transaction/` segment), `login.ccavenue.com`, `login.ccavenue.ae`, and a bare staging IP. They are listed on [Status enquiry § API hosts](/payments/ccavenue/status-enquiry#api-hosts-in-the-sample-code) and [Web integration kit § Kit inventory](/payments/ccavenue/web-integration-kit#kit-inventory). The printed URLs above are the documented ones.

### Encryption scheme

The PDFs say only "AES 128 bit". Every kit implements the same thing (details on [Web integration kit § 9](/payments/ccavenue/web-integration-kit#9-what-the-kit-source-code-does)):

- **AES-128-CBC** with PKCS#5/7 padding;
- key = the 16 raw bytes of **MD5(working key)**;
- IV = the fixed bytes **`00 01 02 … 0f`**;
- plaintext UTF-8; ciphertext **hex**.

A transaction request encrypts a `name=value&…` string. A merchant-API request encrypts an XML or JSON document. Responses are decrypted the same way.

### Integration methods offered

| Method                                   | Card data on the merchant server?                                    | Allowed?                                  |
| ---------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| CCAvenue billing page (**non-seamless**) | No — the customer enters it on CCAvenue                              | Yes. This is the kit HDFC sent.           |
| Custom checkout form                     | Yes — `card_number`, `cvv_number`, expiry are posted by the merchant | No. Card data must not reach our servers. |
| Direct Connect                           | Yes, and the merchant drives the bank 3-D Secure redirect            | No.                                       |

### Status vocabularies

CCAvenue uses two different `order_status` sets. The hosted-checkout response uses **Success, Failure, Aborted, Invalid, Timeout**. The merchant API (Status, Lookup, Pending) uses **Aborted, Auto-Cancelled, Auto-Reversed, Awaited, Cancelled, Chargeback, Invalid, Fraud, Initiated, Refunded, Shipped, Successful, Systemrefund, Unsuccessful, Timeout**. The HDFC VAS guide prints a third, shorter list for its status enquiry. The pages keep them separate.

Two operational points from the merchant API that the hosted flow does not mention: **only confirmed orders are settled**, and unconfirmed orders are **auto-cancelled** after 12 days (5 days in one place in the kit revision). Whether this merchant account auto-confirms is not stated; see [Open questions](#open-questions-for-hdfc).

### Transcription pages

1. [Web integration kit](/payments/ccavenue/web-integration-kit) — Integration Document v3.1, request and response parameters, the redirect and callback flow, and the kit code.
2. [Hosted checkout](/payments/ccavenue/hosted-checkout) — HDFC VAS guide section 2, with the 10001–41004 error codes.
3. [Status enquiry](/payments/ccavenue/status-enquiry) — HDFC VAS guide section 3 and the Status API sample kits.
4. [Merchant API](/payments/ccavenue/merchant-api) — all 24 API commands, both error tables, and the differences from the earlier copy.
5. [Audit and go-live](/payments/ccavenue/audit-and-go-live) — the checklist and HDFC VAS guide sections 4–6.

## 2. Endpoints we use

**Status: not wired.** No CCAvenue adapter, no payment route, and no payment use case exists. `PaymentGatewayPort` (`packages/core-domain/src/ports/payment-gateway.port.ts`) defines `createPayment(input)` and `verifyCallback(payload)` only, and the shared contract enum `PaymentGateway` is `ccavenue | paypal`. [Route inventory](/api/route-inventory) lists no payment route. The entries below say where each call will be used, under the design in [Payment and order lifecycle](/business-flows/payment-and-order-lifecycle).

Each entry follows the record that [Route inventory § Adding a route](/api/route-inventory#adding-a-route) requires before a route is built: owner and actor, method and path, authentication, request and response contracts, idempotency, side effects, and the tests that will prove it. The callback route will appear in OpenAPI and [Scalar](/api/openapi-and-scalar) like every other route. This page is the vendor-side reference.

### Summary

| #   | Direction                | Method | Vendor endpoint                                                 | Our caller (planned)                                                                  | Status    |
| --- | ------------------------ | ------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| 1   | Browser → CCAvenue       | `POST` | `/transaction/transaction.do?command=initiateTransaction`       | `PaymentGatewayPort.createPayment` in a CCAvenue adapter; payment-initiation use case | Not wired |
| 2   | CCAvenue → browser → API | `POST` | Our `redirect_url` / `cancel_url` receives `encResp`, `orderNo` | `PaymentGatewayPort.verifyCallback`; an API payment-return route                      | Not wired |
| 3   | API → CCAvenue (S2S)     | `POST` | `/apis/servlet/DoWebTrans` `command=orderStatusTracker`         | No port method yet; required by HDFC's checklist                                      | Not wired |
| 4   | API → CCAvenue (S2S)     | `POST` | `/apis/servlet/DoWebTrans` `command=refundOrder`                | No port method yet; refund flow                                                       | Not wired |

Calls not planned are listed at the end of this section with the reason.

### 1. Initiate hosted payment — `initiateTransaction`

| Field                 | Value                                                                                                                                                                                                                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor                 | Payment context; the signed-in or guest customer at checkout.                                                                                                                                                                                                                                                        |
| Method / URL          | `POST https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction` (test); `https://secure.ccavenue.com/…` (production). Sent by the **customer's browser** as an auto-submitting form, not by the API.                                                                                         |
| Authentication        | `access_code` in clear plus `encRequest` encrypted with the working key. The working key never leaves the API.                                                                                                                                                                                                       |
| Request contract      | Form fields `encRequest` (hex) and `access_code`. Encrypted payload: `merchant_id`, `order_id`, `currency`, `amount`, `redirect_url`, `cancel_url`, `language` required; billing/delivery, `merchant_param1`–`5`, `tid` optional ([full table](/payments/ccavenue/web-integration-kit#request-parameters-required)). |
| Response contract     | None to the API. CCAvenue shows its billing page; the outcome arrives through call 2.                                                                                                                                                                                                                                |
| Idempotency           | `order_id` is ours and CCAvenue does not check uniqueness. One payment attempt per `order_id` value; a retry is a new attempt with a new `order_id`, per the lifecycle's "one order, many attempts".                                                                                                                 |
| Side effects          | Before the hand-off, the order and a pending payment attempt are saved in one transaction ([lifecycle diagram](/business-flows/payment-and-order-lifecycle#initiation-and-confirmation)).                                                                                                                            |
| Where it will be used | A CCAvenue adapter implementing `PaymentGatewayPort.createPayment`; it returns `PaymentIntent { id, redirectUrl, raw }`. How the form fields reach the storefront is undecided, because `redirectUrl` alone cannot carry a POST body.                                                                                |
| Tests                 | Adapter unit test: known plaintext + test working key → expected hex, and round-trip decrypt. No real key in fixtures.                                                                                                                                                                                               |

Sample request (what the browser posts):

```http
POST /transaction/transaction.do?command=initiateTransaction HTTP/1.1
Host: test.ccavenue.com
Content-Type: application/x-www-form-urlencoded

encRequest=<hex AES-128-CBC ciphertext>&access_code=<ACCESS_CODE>
```

Plaintext inside `encRequest` (values illustrative; INR only, since non-INR goes to PayPal):

```text
merchant_id=<MERCHANT_ID>&order_id=<payment attempt id>&currency=INR&amount=1499.00&redirect_url=<API payment-return URL>&cancel_url=<API payment-return URL>&language=EN&
```

### 2. Payment return — `redirect_url` / `cancel_url` callback

| Field                 | Value                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor                 | Payment context; actor is the customer's browser carrying CCAvenue's auto-posted form. It is not a server-to-server webhook.                                                                                                                                                                                                                          |
| Method / URL          | `POST` to the URL we send as `redirect_url` (and `cancel_url`). The route has no name and is not in [Route inventory](/api/route-inventory). If `redirect_url` is omitted, CCAvenue posts to the URL in M.A.R.S "dynamic event notifications", or shows its own page.                                                                                 |
| Authentication        | None from the browser; trust comes only from decrypting `encResp` with our working key and then re-checking with call 3. It arrives cross-site, so it cannot carry our CSRF cookie and needs its own exemption with this compensating check.                                                                                                          |
| Request contract      | `encResp` (hex) and `orderNo` (plain text). Decrypted: `order_id`, `tracking_id`, `bank_ref_no`, `order_status` (Success, Failure, Aborted, Invalid, Timeout), `failure_message`, `payment_mode`, `card_name`, `status_code`, `status_message`, `currency`, `amount`, … ([full table](/payments/ccavenue/web-integration-kit#8-response-parameters)). |
| Response contract     | A redirect to a storefront result page. The browser must never be shown decrypted fields.                                                                                                                                                                                                                                                             |
| Validation            | CCAvenue: "Kindly ensure this value received in response is validated before providing services" for `order_id`, `currency`, `Amount`. HDFC audit: response-tampering and duplicate-entry checks ([Audit](/payments/ccavenue/audit-and-go-live)).                                                                                                     |
| Idempotency           | The same `encResp` can be replayed or re-posted (Back/Refresh is CCAvenue error 41004). The attempt transition must be idempotent on `tracking_id`.                                                                                                                                                                                                   |
| Side effects          | Payment attempt and order state transition in one transaction; no rewrite of purchased facts ([lifecycle](/business-flows/payment-and-order-lifecycle#why-order-and-payment-are-separate)).                                                                                                                                                           |
| Where it will be used | `PaymentGatewayPort.verifyCallback(payload)` in the CCAvenue adapter, returning `PaymentVerification { ok, orderId, gateway: 'ccavenue', raw }`; called from a payment-return API controller.                                                                                                                                                         |
| Tests                 | Decrypt fixture produced with a test key; tampered amount/currency/order rejected; replayed `tracking_id` is a no-op; unknown `order_status` fails closed.                                                                                                                                                                                            |

Sample request (what CCAvenue makes the browser post):

```http
POST <API payment-return path> HTTP/1.1
Content-Type: application/x-www-form-urlencoded

encResp=<hex ciphertext>&orderNo=<our order_id>
```

Decrypted `encResp` (shape from the Integration Document; values illustrative):

```text
order_id=<our order_id>&tracking_id=311008298114&bank_ref_no=1652448720867&order_status=Success&failure_message=&payment_mode=Net Banking&card_name=AvenuesTest&status_code=null&status_message=Y&currency=INR&amount=1499.00&...&trans_date=13/05/2022 19:04:51&bin_country=
```

Values are not URL-encoded; split on `&`, then on the first `=`.

### 3. Status enquiry — `orderStatusTracker`

| Field                 | Value                                                                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor                 | Payment context; the API itself (after call 2, and from a reconciliation job for attempts left pending).                                                                                                                           |
| Method / URL          | `POST https://apitest.ccavenue.com/apis/servlet/DoWebTrans` (staging); `https://api.ccavenue.com/apis/servlet/DoWebTrans` (production). Server-to-server from a registered public IP.                                              |
| Authentication        | `access_code` plus `enc_request` encrypted with the working key; IP allow-listing at CCAvenue.                                                                                                                                     |
| Request contract      | Form body `enc_request`, `access_code`, `command=orderStatusTracker`, `request_type=JSON`, `response_type=JSON`, `version=1.2`. Encrypted JSON: `reference_no` (= `tracking_id`) and/or `order_no` (= our `order_id`).             |
| Response contract     | `status=0&enc_response=<hex>&enc_error_code=` or `status=1&enc_response=<plain error>&enc_error_code=<code>`. Decrypted fields: [order record fields](/payments/ccavenue/merchant-api#order-record-fields).                        |
| Errors                | [API call errors](/payments/ccavenue/merchant-api#api-call-errors-status-1) (514xx) and [failure reasons](/payments/ccavenue/merchant-api#failure-reasons-for-api-calls) (510xx–513xx).                                            |
| Idempotency           | Read-only; safe to retry.                                                                                                                                                                                                          |
| Where it will be used | Not decided. HDFC's checklist makes it **mandatory** ("dual enquiry") and asks for its request and response logs at audit. `PaymentGatewayPort` has no method for it. The adapter must add one or call it inside `verifyCallback`. |
| Tests                 | Adapter test with a recorded `status=0` and `status=1` body; decrypted amount/currency mismatch fails closed.                                                                                                                      |

Sample request:

```http
POST /apis/servlet/DoWebTrans HTTP/1.1
Host: apitest.ccavenue.com
Content-Type: application/x-www-form-urlencoded

enc_request=<hex>&access_code=<ACCESS_CODE>&command=orderStatusTracker&request_type=JSON&response_type=JSON&version=1.2
```

Encrypted JSON:

```json
{ "reference_no": "<tracking_id>", "order_no": "<our order_id>" }
```

Sample response and decrypted body (trimmed from the merchant API guide):

```text
status=0&enc_response=<hex>&enc_error_code=
```

```json
{
	"reference_no": "204000163469",
	"order_no": "66068092",
	"order_currncy": "INR",
	"order_amt": 1.0,
	"order_status": "Successful",
	"order_status_date_time": "2015-09-16 15:06:13.243",
	"order_bank_ref_no": "035944",
	"order_option_type": "OPTCRDC",
	"error_desc": "",
	"status": 0,
	"error_code": ""
}
```

### 4. Refund — `refundOrder`

| Field                 | Value                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actor                 | Payment/refund context; an admin with refund permission, through the API. No refund permission or route exists yet.                                                |
| Method / URL          | Same `DoWebTrans` endpoint as call 3, `command=refundOrder`.                                                                                                       |
| Authentication        | As call 3.                                                                                                                                                         |
| Request contract      | Encrypted JSON `reference_no`, `refund_amount` (full or partial), `refund_ref_no` (ours, AlphaNumeric (30), unique).                                               |
| Response contract     | Decrypted `refund_status` (0 success, 1 failure), `reason`, `error_code`. Follow-up state through `getRefundDetails` (TS-REFC, TS-REFA, TS-REFF, TS-REFD).         |
| Idempotency           | `refund_ref_no` is our idempotency handle; 51309 "Ensure that merchant reference number parameter is not repeated", 51311/51328 "Multiple refunds not allowed".    |
| Where it will be used | Not decided. The lifecycle model gives each payment zero or more refunds; `PaymentGatewayPort` has no refund method. Refunds follow the first payment integration. |
| Tests                 | Adapter test for success and each refusal code; duplicate `refund_ref_no` does not double-refund.                                                                  |

Encrypted JSON (sample from the merchant API guide):

```json
{ "reference_no": "1236547", "refund_amount": "1.0", "refund_ref_no": "API1234" }
```

Decrypted responses:

```json
{ "reason": "", "error_code": "", "refund_status": 0 }
```

```json
{ "reason": "Reference number: Invalid Parameter", "error_code": "51310", "refund_status": 1 }
```

### Not planned

| Call                                                                                                          | Why not                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `confirmOrder`, `cancelOrder`, `getPendingOrders`                                                             | Only needed if the account does not auto-confirm. Not known — see open questions. If it does not, unconfirmed orders auto-cancel and are never settled, so this would move into section 2. |
| `orderLookup`, `getRefundDetails`, `getSettlementDetails`, `payoutSummary`, `payIdDetails`, consolidate calls | Reconciliation and finance reporting. Not part of the first payment integration.                                                                                                           |
| Customer vault calls, `addCustomerPaymentOption`                                                              | Card storage; `addCustomerPaymentOption` posts a card number from the merchant server.                                                                                                     |
| Invoice calls, `updateMerchantParams`, `updateBillingDetails`                                                 | No invoice or pay-link product in scope.                                                                                                                                                   |
| Custom checkout form, Direct Connect (`initiatePayloadTransaction`)                                           | Card data would touch our servers.                                                                                                                                                         |

### Open questions for HDFC

These come from the kits and are not answered by the material received.

1. **Auto-confirm.** Does K R MARKETING ONLINE's account auto-confirm successful orders, or must we call `confirmOrder`? The merchant API says only confirmed orders settle.
2. **API host.** The guide says `api.ccavenue.com` / `apitest.ccavenue.com`; the HDFC kits use `login.ccavenue.com` and a staging IP. Which does HDFC expect?
3. **Server IP.** Which public IP will be registered for API calls (staging and production droplets)?
4. **STRING format.** The kit revision documents XML and JSON only, but its ASP.NET sample still sends `request_type=STRING`. Only JSON is planned here.
