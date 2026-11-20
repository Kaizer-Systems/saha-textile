---
title: CCAvenue
slug: /payments/ccavenue
description: "The INR gateway role: HDFC's documentation and the calls this project will make."
status: scaffolded
audience: [backend, operator]
last_verified: '2026-11-20'
search_keywords: CCAvenue HDFC VAS K R MARKETING ONLINE integration kit non-seamless initiateTransaction encResp orderStatusTracker refundOrder DoWebTrans working key access code
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/core-domain/src/payments/decide-payment-result.ts
    - packages/adapters-payments/src
    - packages/contracts/src
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/api/route-inventory.md
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# CCAvenue

CCAvenue is the INR online gateway, provided through HDFC Bank for merchant **K R MARKETING ONLINE**.

This page has two sections. **Section 1** is what HDFC and CCAvenue provided, transcribed in full on the pages it links to. **Section 2** is the calls this project makes, in the project's API-documentation format, with the adapter method behind each one. The adapter exists and no route calls it yet.

## 1. Company-provided documentation

### Documents included

| File                                                        | What it is                                                                                                                       | Transcribed on                                                                                                                                                        |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integration and Audit checklist (PDF, 3 pages)              | URL, transaction-flow, and status-API requirements, plus the seven security-audit checks.                                        | [Audit and go-live](/payments/ccavenue/audit-and-go-live)                                                                                                             |
| HDFC VAS CCAvenue integration guide (PDF, 35 pages, Public) | Hosted checkout, status enquiry, hygiene, go-live, and best practices.                                                           | [Hosted checkout](/payments/ccavenue/hosted-checkout), [Status enquiry](/payments/ccavenue/status-enquiry), [Audit and go-live](/payments/ccavenue/audit-and-go-live) |
| HDFC API Doc v1.3 (PDF), earlier copy                       | Merchant's API Implementation Guide. Superseded by the kit revision below.                                                       | [Merchant API differences](/payments/ccavenue/merchant-api#differences-from-the-earlier-copy)                                                                         |
| `Web_Integration_Non_Seamless.zip` — "integration kits"     | CCAvenue Integration Document v3.1 (47 pages) and non-seamless kits for ASP.NET, JSP, Node JS, Perl, PHP, Python, Ruby on Rails. | [Web integration kit](/payments/ccavenue/web-integration-kit)                                                                                                         |
| `API_Document_Sample_Code-New.zip` — "API sample kits"      | HDFC API Doc v1.3 (172 pages, May 2023 revision) and Status API kits for ASP.NET, Java, and PHP.                                 | [Merchant API](/payments/ccavenue/merchant-api), [Status enquiry § kits](/payments/ccavenue/status-enquiry#status-api-sample-kits)                                    |
| Dynamic Event Notification (PDF, 9 pages)                   | The webhook: five event URLs, the encrypted server-to-server post, and each event's parameters.                                  | [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification)                                                                                           |
| HDFC PG Helpdesk written answers                            | Account settings and behaviour the documents leave open.                                                                         | [Account settings and behaviour](#account-settings-and-behaviour)                                                                                                     |

### Credentials

Every CCAvenue document says the same three values come from the CCAvenue **M.A.R.S** account, **Settings → API Keys**:

| Value                               | Used for                                                     | Where it will live in this project          |
| ----------------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| Merchant ID                         | `merchant_id` inside the encrypted transaction request       | `CCAVENUE_MERCHANT_ID` (server env)         |
| Access Code                         | Sent in clear beside every encrypted payload (`access_code`) | `CCAVENUE_ACCESS_CODE` (server env)         |
| Working Key (also "Encryption Key") | AES key material for every request and response              | `CCAVENUE_WORKING_KEY` (server env, secret) |

The API reads these with `CCAVENUE_RETURN_URL`, `CCAVENUE_BASE_URL` and `CCAVENUE_API_URL`, all catalogued in [Environment variables](/engineering-live-context/environment-variables). The merchant API guide also requires the server's **public IP** to be registered with CCAvenue before any API call works, unless the account has **Ignore IP and URL** enabled ([Account settings and behaviour](#account-settings-and-behaviour)).

The test environment has its own Merchant ID, Access Code and Working Key, separate from the live set. HDFC issues the test set on request and releases the live set after the security audit ([Steps to go-live](/payments/ccavenue/audit-and-go-live#5-steps-to-go-live)).

Once CCAvenue is configured, a staging API refuses to start unless both hosts are CCAvenue test hosts, and a production API refuses to start with a test host. See [Deployment hardening](/backend/composition-and-adapters#deployment-hardening).

The kits ship with hard-coded keys and access codes that belong to someone else. None of them has been copied into this repository; every sample on these pages uses `<MERCHANT_ID>`, `<ACCESS_CODE>`, and `<WORKING_KEY>`.

### Environments and URLs

| Purpose                                           | Test / staging                                                                            | Production                                                                           | Source                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------- |
| Hosted billing page (non-seamless)                | `https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction`        | `https://secure.ccavenue.com/transaction/transaction.do?command=initiateTransaction` | Integration Document v3.1 |
| Direct Connect payload (not for us; see below)    | `https://test.ccavenue.com/transaction/transaction.do?command=initiatePayloadTransaction` | Not printed                                                                          | Integration Document v3.1 |
| Merchant API (status, refund, lookup, settlement) | `https://apitest.ccavenue.com/apis/servlet/DoWebTrans`                                    | `https://api.ccavenue.com/apis/servlet/DoWebTrans`                                   | Merchant API guide; HDFC  |

The sample code also uses `secure.ccavenue.com/transaction.do` (no `/transaction/` segment), `login.ccavenue.com`, `login.ccavenue.ae`, and a bare staging IP. They are listed on [Status enquiry § API hosts](/payments/ccavenue/status-enquiry#api-hosts-in-the-sample-code) and [Web integration kit § Kit inventory](/payments/ccavenue/web-integration-kit#kit-inventory). HDFC confirms the printed URLs above for the merchant API; the kit hosts are not used.

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

CCAvenue uses two different `order_status` sets. The hosted-checkout response uses **Success, Failure, Aborted, Invalid, Timeout**. The merchant API (Status, Lookup, Pending) uses **Aborted, Auto-Cancelled, Auto-Reversed, Awaited, Cancelled, Chargeback, Invalid, Fraud, Initiated, Refunded, Shipped, Successful, Systemrefund, Unsuccessful, Timeout**. The HDFC VAS guide prints a third, shorter list for its status enquiry. [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification#3-parameters) adds `initiated` to the hosted list for its echo URL, and uses **Successful/Shipped, Unsuccessful, Auto-Reversed** for reconciliation. The pages keep them separate.

Two operational points from the merchant API that the hosted flow does not mention: **only confirmed orders are settled**, and unconfirmed orders are **auto-cancelled** after 12 days (5 days in one place in the kit revision). Auto-confirm is an account setting, and this integration requires it ([Account settings and behaviour](#account-settings-and-behaviour)).

### Account settings and behaviour

HDFC PG Helpdesk answered these points in writing. They apply to CCAvenue accounts issued through HDFC. Some are settings that HDFC switches on for a given account.

| Topic                         | Behaviour                                                                                                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IP and URL allow-list         | An HDFC reseller account can have **Ignore IP and URL** enabled. No IP or URL then needs whitelisting: merchant API calls work from any IP address, including a developer machine, and the reply returns to the IP that sent the request.                   |
| Registered URL                | HDFC registers the URL that transactions start from. One account can hold several URLs, and all of them work. A test account accepts a `localhost` `redirect_url`, so the complete payment return can be tested on a developer machine.                     |
| API hosts                     | `https://apitest.ccavenue.com` for test and `https://api.ccavenue.com` for live.                                                                                                                                                                            |
| Order confirmation            | With **auto-confirm** enabled, every successful order is confirmed automatically, and no `confirmOrder` call is made.                                                                                                                                       |
| Return delay                  | A response can reach the return URL 5–10 minutes after payment, because of processing delays. HDFC recommends a buffer of 5–10 minutes before calling the Status API. The VAS guide (best practice H(a)) asks for the call as soon as the response arrives. |
| `Awaited` orders              | No maximum time applies. An order stays `Awaited` until the customer's bank responds.                                                                                                                                                                       |
| Server-to-server notification | A webhook URL can be configured on the account. A failed post is retried twice, nine minutes apart. The format is on [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification).                                                           |
| Partial refunds               | More than one partial refund against the same transaction works once HDFC enables it for the account. Without it, a second refund fails with "Multiple refunds not allowed" (51311, 51328).                                                                 |

### Transcription pages

1. [Web integration kit](/payments/ccavenue/web-integration-kit) — Integration Document v3.1, request and response parameters, the redirect and callback flow, and the kit code.
2. [Hosted checkout](/payments/ccavenue/hosted-checkout) — HDFC VAS guide section 2, with the 10001–41004 error codes.
3. [Status enquiry](/payments/ccavenue/status-enquiry) — HDFC VAS guide section 3 and the Status API sample kits.
4. [Merchant API](/payments/ccavenue/merchant-api) — all 24 API commands, both error tables, and the differences from the earlier copy.
5. [Audit and go-live](/payments/ccavenue/audit-and-go-live) — the checklist and HDFC VAS guide sections 4–6.
6. [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification) — the webhook event URLs, response handling and parameters.

## 2. Endpoints we use

**Status: built, not reachable.** `CcavenuePaymentGateway` (`packages/adapters-payments`) implements `PaymentGatewayPort` (`packages/core-domain/src/ports/payment-gateway.port.ts`), and the API binds it to the `INR_PAYMENT_GATEWAY` token. No route, use case or screen calls it, and [Route inventory](/api/route-inventory) lists no payment route. None of these calls has been made against CCAvenue's test system; see [Limitations](#limitations). The design around them is in [Payment and order lifecycle](/business-flows/payment-and-order-lifecycle).

Each entry follows the record that [Route inventory § Adding a route](/api/route-inventory#adding-a-route) requires before a route is built: owner and actor, method and path, authentication, request and response contracts, idempotency, side effects, and the tests that will prove it. The callback route will appear in OpenAPI and [Scalar](/api/openapi-and-scalar) like every other route. This page is the vendor-side reference.

### Summary

| #   | Direction                | Method | Vendor endpoint                                                 | Port method          | Status                   |
| --- | ------------------------ | ------ | --------------------------------------------------------------- | -------------------- | ------------------------ |
| 1   | Browser → CCAvenue       | `POST` | `/transaction/transaction.do?command=initiateTransaction`       | `createPayment`      | Built; no route calls it |
| 2   | CCAvenue → browser → API | `POST` | Our `redirect_url` / `cancel_url` receives `encResp`, `orderNo` | `verifyCallback`     | Built; no route calls it |
| 3   | API → CCAvenue (S2S)     | `POST` | `/apis/servlet/DoWebTrans` `command=orderStatusTracker`         | `fetchPaymentStatus` | Built; no route calls it |
| 4   | API → CCAvenue (S2S)     | `POST` | `/apis/servlet/DoWebTrans` `command=refundOrder`                | `refundPayment`      | Built; no route calls it |
| 5   | API → CCAvenue (S2S)     | `POST` | `/apis/servlet/DoWebTrans` `command=getRefundDetails`           | `fetchRefunds`       | Built; no route calls it |

Calls not planned are listed at the end of this section with the reason.

### 1. Initiate hosted payment — `initiateTransaction`

| Field             | Value                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor             | Payment context; the signed-in or guest customer at checkout.                                                                                                                                                                                                                                                                |
| Method / URL      | `POST https://test.ccavenue.com/transaction/transaction.do?command=initiateTransaction` (test); `https://secure.ccavenue.com/…` (production). Sent by the **customer's browser** as an auto-submitting form, not by the API.                                                                                                 |
| Authentication    | `access_code` in clear plus `encRequest` encrypted with the working key. The working key never leaves the API.                                                                                                                                                                                                               |
| Request contract  | Form fields `encRequest` (hex) and `access_code`. Encrypted payload: `merchant_id`, `order_id`, `currency`, `amount`, `redirect_url`, `cancel_url`, `language` required; billing/delivery, `merchant_param1`–`5`, `tid` optional ([full table](/payments/ccavenue/web-integration-kit#request-parameters-required)).         |
| Response contract | None to the API. CCAvenue shows its billing page; the outcome arrives through call 2.                                                                                                                                                                                                                                        |
| Idempotency       | `order_id` is ours and CCAvenue does not check uniqueness. One payment attempt per `order_id` value; a retry is a new attempt with a new `order_id`, per the lifecycle's "one order, many attempts".                                                                                                                         |
| Side effects      | Before the hand-off, the order and a pending payment attempt are saved in one transaction ([lifecycle diagram](/business-flows/payment-and-order-lifecycle#initiation-and-confirmation)).                                                                                                                                    |
| Where it is used  | `createPayment` returns `PaymentIntent { attemptId, handoff, auditRecord }`. `handoff` is `{ kind: 'form-post', url, fields }`, which gives the storefront the fields for an auto-submitting form. The amount must come from the stored attempt. Only INR is accepted, and the return address must be `CCAVENUE_RETURN_URL`. |
| Tests             | `cipher.test.ts` pins the cipher to OpenSSL output made with a generated test key. `gateway-payment.test.ts` decrypts the form and refuses field injection, foreign currency and other return addresses.                                                                                                                     |

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

| Field             | Value                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor             | Payment context; actor is the customer's browser carrying CCAvenue's auto-posted form. It is not a server-to-server webhook.                                                                                                                                                                                                                          |
| Method / URL      | `POST` to the URL we send as `redirect_url` (and `cancel_url`). The route has no name and is not in [Route inventory](/api/route-inventory). If `redirect_url` is omitted, CCAvenue sends the customer to the Order Status URL in its [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification) settings, or shows its own page.    |
| Authentication    | None from the browser; trust comes only from decrypting `encResp` with our working key and then re-checking with call 3. It arrives cross-site, so it cannot carry our CSRF cookie and needs its own exemption with this compensating check.                                                                                                          |
| Request contract  | `encResp` (hex) and `orderNo` (plain text). Decrypted: `order_id`, `tracking_id`, `bank_ref_no`, `order_status` (Success, Failure, Aborted, Invalid, Timeout), `failure_message`, `payment_mode`, `card_name`, `status_code`, `status_message`, `currency`, `amount`, … ([full table](/payments/ccavenue/web-integration-kit#8-response-parameters)). |
| Response contract | A redirect to a storefront result page. The browser must never be shown decrypted fields.                                                                                                                                                                                                                                                             |
| Validation        | CCAvenue: "Kindly ensure this value received in response is validated before providing services" for `order_id`, `currency`, `Amount`. HDFC audit: response-tampering and duplicate-entry checks ([Audit](/payments/ccavenue/audit-and-go-live)).                                                                                                     |
| Idempotency       | The same `encResp` can be replayed or re-posted (Back/Refresh is CCAvenue error 41004). The attempt transition must be idempotent on `tracking_id`.                                                                                                                                                                                                   |
| Side effects      | Payment attempt and order state transition in one transaction; no rewrite of purchased facts ([lifecycle](/business-flows/payment-and-order-lifecycle#why-order-and-payment-are-separate)).                                                                                                                                                           |
| Where it is used  | `verifyCallback(payload)` returns a `PaymentReport`: `attemptId`, `gatewayReference`, `state`, `amountMinor`, `currency`, `failureReason`, `auditRecord`. It is a claim, never proof of payment. A payment-return controller passes it to `decidePaymentResult` beside call 3.                                                                        |
| Tests             | `gateway-payment.test.ts` and `audit-checks.test.ts`: tampered amount, currency and order; a repeated field; a replayed form; an unknown `order_status` fails closed.                                                                                                                                                                                 |

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

| Field             | Value                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor             | Payment context; the API itself (after call 2, and from a reconciliation job for attempts left pending).                                                                                                                                                       |
| Method / URL      | `POST https://apitest.ccavenue.com/apis/servlet/DoWebTrans` (staging); `https://api.ccavenue.com/apis/servlet/DoWebTrans` (production). Server-to-server.                                                                                                      |
| Authentication    | `access_code` plus `enc_request` encrypted with the working key. An account without Ignore IP and URL also needs the caller's public IP allow-listed.                                                                                                          |
| Timing            | The VAS guide asks for this call as soon as the return arrives. A return can arrive 5–10 minutes after payment, and HDFC recommends that buffer before calling. An `Initiated` or `Awaited` answer is `pending`, and the attempt is enquired again later.      |
| Request contract  | Form body `enc_request`, `access_code`, `command=orderStatusTracker`, `request_type=JSON`, `response_type=JSON`, `version=1.2`. Encrypted JSON: `reference_no` (= `tracking_id`) and/or `order_no` (= our `order_id`).                                         |
| Response contract | `status=0&enc_response=<hex>&enc_error_code=` or `status=1&enc_response=<plain error>&enc_error_code=<code>`. Decrypted fields: [order record fields](/payments/ccavenue/merchant-api#order-record-fields).                                                    |
| Errors            | [API call errors](/payments/ccavenue/merchant-api#api-call-errors-status-1) (514xx) and [failure reasons](/payments/ccavenue/merchant-api#failure-reasons-for-api-calls) (510xx–513xx).                                                                        |
| Idempotency       | Read-only; safe to retry.                                                                                                                                                                                                                                      |
| Where it is used  | `fetchPaymentStatus({ attemptId, gatewayReference })`. HDFC's checklist makes this **mandatory** ("dual enquiry") and asks for its request and response logs at audit, which `auditRecord` carries. `null` means CCAvenue has no record (51419, 51313, 51308). |
| Tests             | `gateway-merchant-api.test.ts`: `status=0` and `status=1` bodies built from the guide's samples, both currency spellings, a malformed amount fails closed.                                                                                                     |

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

| Field             | Value                                                                                                                                                                                                                                                          |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actor             | Payment/refund context; an admin with refund permission, through the API. No refund permission or route exists yet.                                                                                                                                            |
| Method / URL      | Same `DoWebTrans` endpoint as call 3, `command=refundOrder`.                                                                                                                                                                                                   |
| Authentication    | As call 3.                                                                                                                                                                                                                                                     |
| Request contract  | Encrypted JSON `reference_no`, `refund_amount` (full or partial), `refund_ref_no` (ours, AlphaNumeric (30), unique). More than one partial refund on a transaction needs the account setting described in [Account settings](#account-settings-and-behaviour). |
| Response contract | Decrypted `refund_status` (0 success, 1 failure), `reason`, `error_code`. Follow-up state through `getRefundDetails` (TS-REFC, TS-REFA, TS-REFF, TS-REFD).                                                                                                     |
| Idempotency       | `refund_ref_no` is our idempotency handle; 51309 "Ensure that merchant reference number parameter is not repeated", 51311/51328 "Multiple refunds not allowed".                                                                                                |
| Where it is used  | `refundPayment` returns `outcome`: `accepted`, `duplicate` (51309) or `refused`. A timeout leaves the outcome unknown, so read call 5 before trying again. No refund route or permission exists.                                                               |
| Tests             | `gateway-merchant-api.test.ts`: success, each refusal code, and a repeated `refund_ref_no` reported as `duplicate`.                                                                                                                                            |

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

### 5. Refund details — `getRefundDetails`

| Field            | Value                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Actor            | Payment/refund context; the API itself.                                                                                                                                                    |
| Method / URL     | Same `DoWebTrans` endpoint as call 3, `command=getRefundDetails`, `version=1.1`.                                                                                                           |
| Request contract | Encrypted JSON `reference_no`.                                                                                                                                                             |
| Response         | `refund_list` of `refund_amt`, `refund_mer_ref_no`, `refund_status` (TS-REFC, TS-REFA, TS-REFF, TS-REFD).                                                                                  |
| Why it is needed | `refund_status: 0` on call 4 only says the request was taken. This call shows how each refund ended, and whether a refund whose call timed out was applied.                                |
| Where it is used | `fetchRefunds(gatewayReference)` returns one `RefundRecord` per refund. `refundReference` is null for a refund made in the CCAvenue dashboard. An answer about another payment is refused. |
| Tests            | `gateway-merchant-api.test.ts`.                                                                                                                                                            |

### How CCAvenue's values map

Amounts become whole paise, parsed without floating-point arithmetic. Anything not listed below becomes `review`, so a status CCAvenue adds later can never read as paid.

| `PaymentState` | Callback `order_status`   | Status API `order_status`                       |
| -------------- | ------------------------- | ----------------------------------------------- |
| `pending`      |                           | Initiated, Awaited                              |
| `authorized`   | Success                   | Successful                                      |
| `captured`     |                           | Shipped                                         |
| `failed`       | Failure, Invalid, Timeout | Unsuccessful, Invalid, Timeout                  |
| `cancelled`    | Aborted                   | Aborted, Cancelled, Auto-Cancelled              |
| `refunded`     |                           | Refunded, Systemrefund, Auto-Reversed           |
| `review`       | Anything else             | Fraud, Chargeback, anything else; or fraud High |

Order ids allow letters, digits and hyphen, up to 30 characters. CCAvenue prints three different character sets for this field, and those are the characters all three accept.

A decrypted callback is not URL-encoded, so text a customer types on the billing page could add a second `order_status` or `amount`. A repeated field name rejects the whole message.

### HDFC audit checks

`decidePaymentResult` in `packages/core-domain/src/payments` is the rule for every gateway. It takes the stored attempt, the status answer and the callback, and answers `apply`, `duplicate`, `pending` or `review`. `audit-checks.test.ts` runs these checks through the adapter and that rule.

| Sr No | Check               | Handled by                                                                                                                                 | Needs from the checkout work                                    |
| ----- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 1     | Unique order ID     | `createPayment` refuses an id CCAvenue cannot carry                                                                                        | A unique index on the attempt id                                |
| 2     | Request tampering   | `decidePaymentResult` compares amount and currency with the stored attempt                                                                 | Read the amount from the stored attempt, never from the browser |
| 3     | Response tampering  | `verifyCallback` compares the decrypted order id with `orderNo`; `decidePaymentResult` compares order, amount, currency and reference      | Call `fetchPaymentStatus` on every return                       |
| 4     | URL redirection     | The outcome comes from decrypted data and the status answer, never from the path. `createPayment` sends only the registered return address | One return route for success, failure and cancel                |
| 5     | Duplicate entry     | `decidePaymentResult` answers `duplicate` for a replay, and `review` for a second reference on one attempt                                 | Apply the decision in one transaction                           |
| 6     | Receipt generation  | `PaymentReport` carries the order, amount and reference                                                                                    | Build receipts from the stored attempt, never from the callback |
| 7     | SSL (seamless only) | Hosts and the return address must be https                                                                                                 | A valid certificate on the return host                          |

### Not planned

| Call                                                                                      | Why not                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `confirmOrder`, `cancelOrder`, `getPendingOrders`                                         | The integration requires an account with auto-confirm enabled, which confirms successful orders without a call. On an account without it, unconfirmed orders auto-cancel and are never settled, and these calls would move into section 2. |
| [Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification) posts         | The status enquiry already settles an attempt whose return is lost. The echo URL would add a second, server-to-server copy of the return; it needs its own route and handler.                                                              |
| `orderLookup`, `getSettlementDetails`, `payoutSummary`, `payIdDetails`, consolidate calls | Reconciliation and finance reporting. Not part of the first payment integration.                                                                                                                                                           |
| Customer vault calls, `addCustomerPaymentOption`                                          | Card storage; `addCustomerPaymentOption` posts a card number from the merchant server.                                                                                                                                                     |
| Invoice calls, `updateMerchantParams`, `updateBillingDetails`                             | No invoice or pay-link product in scope.                                                                                                                                                                                                   |
| Custom checkout form, Direct Connect (`initiatePayloadTransaction`)                       | Card data would touch our servers.                                                                                                                                                                                                         |

### During a restart

A deploy swaps old and new copies side by side, so it causes no gap ([Deploys without a gap](/engineering-live-context/production-deployment-plan#deploys-without-a-gap)). A reboot or a crash can still leave the API briefly unavailable ([Back in a moment](/engineering-live-context/production-deployment-plan#back-in-a-moment)). The payment return behaves as follows during such a moment, based on HDFC's documentation.

- **No webhook is handled.** The payment return (call 2) is the customer's browser posting CCAvenue's form once. CCAvenue can also post the same `encResp` server-to-server to an order status echo URL, and retries a failed post twice, nine minutes apart ([Dynamic Event Notification](/payments/ccavenue/dynamic-event-notification)). The adapter does not handle that post, so CCAvenue needs no Cloudflare webhook rule.
- **A return during the gap is lost.** `encResp` never reaches the API. The payment itself completed at CCAvenue and is unaffected. If the customer re-posts the same form later, `decidePaymentResult` treats it like any other return, so a replay is harmless.
- **The status enquiry settles the attempt.** HDFC makes call 3 mandatory because the return may never arrive. An attempt still `pending` after CCAvenue's 15-minute payment-page session is settled by calling `fetchPaymentStatus` and passing the answer to `decidePaymentResult` with no callback. A lost return delays the order; it does not lose it.
- **What the customer sees.** The return address is on the API host. While the API is unavailable, Nginx answers its path (`PAYMENT_RETURN_PATH`) with the storefront's "back in a moment" page, worded for a payment being confirmed ([Deploy and recovery](/deployment/deploy-and-recovery)).

### Open questions for HDFC

Neither the documents nor HDFC's answers settle these.

1. **Status API rate limit.** How often may `orderStatusTracker` be called? HDFC gives a 5–10 minute buffer before the first call and states no limit.
2. **Status during the return delay.** Before a delayed return arrives, does the Status API answer `Initiated` or `Awaited`, or "no record" (51419, 51313, 51308)? The first is `pending`. The second, beside a paid callback, is `review`.
3. **STRING format.** The kit revision documents XML and JSON only, but its ASP.NET sample still sends `request_type=STRING`. Only JSON is planned here.
4. **Working key per URL.** A webhook post is encrypted with the primary URL's working key. Whether each registered URL has its own working key is not stated.

## Limitations

- Nothing here has run against CCAvenue. The encryption matches OpenSSL and the transcribed kit scheme, using a generated key, and the reply shapes come from the printed samples. The first test transaction may show differences.
- Testing against CCAvenue needs the test Merchant ID, Access Code and Working Key, and the site's URL registered on the test account. On an account with Ignore IP and URL, no IP is registered, and the test can run from a developer machine.
- A paid callback that meets a "no record" status answer goes to `review`. If CCAvenue answers "no record" during the return delay, a genuine payment waits for an operator instead of settling automatically.
- No route, use case, payment collection or screen uses the adapter. Checkout stays closed.
- No job runs the status enquiry for attempts left `pending`, so nothing settles a return lost during a reboot or crash automatically.
- The cipher has no authentication tag and uses a fixed IV. The return route must answer every failure identically and be rate limited, or an attacker could learn from the differences.
- `orderNo` is optional in `verifyCallback`, because one printed sample shows `encResp` alone. When present it must match.
- A retry that gives one order id a second `tracking_id` goes to `review`.
- `confirmOrder` and `cancelOrder` are not built. On an account without auto-confirm, orders stay at `authorized` and never settle.
