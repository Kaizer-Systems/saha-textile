---
title: PayPal
description: The gateway for every currency except rupees, its settings, and the PayPal calls the API makes.
status: scaffolded
audience: [backend, operator]
last_verified: '2026-11-21'
search_keywords: PayPal non-INR international markup invoicing webhook
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/adapters-payments/src/paypal
    - packages/contracts/src
    - apps/api/src/config/app-config.ts
    - apps/api/src/shop-checkout/payment-callbacks.controller.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# PayPal

PayPal takes every currency except rupees. A price in another currency is the INR price converted at the active rate and raised by the PayPal markup (6%, changed only by the super admin), shipping included; see [Checkout](/business-flows/checkout#currency-and-gateway). Gateway secrets stay on the server.

This page follows the same two-section format as [CCAvenue](/payments/ccavenue#2-endpoints-we-use).

## 1. Company-provided documentation

No PayPal documentation is included. The adapter follows PayPal's Orders v2, Invoicing v2 and webhook verification references.

## 2. Endpoints we use

`PayPalGateway` in `packages/adapters-payments/src/paypal` implements `PaymentGatewayPort` and `PaymentRequestPort`. Orders go through `@paypal/paypal-server-sdk` 2.5.0; invoicing, webhook checks and the access token go over REST, because the SDK doesn't cover them.

| Purpose                   | PayPal call                                                  | Used by                                                     |
| ------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| Start a shop payment      | `createOrder` (intent CAPTURE, our attempt id as request id) | Pay at the shop checkout; the browser goes to PayPal's page |
| Read and finish a payment | `getOrder`, then `captureOrder` once the buyer approved      | The return page, **Check payment status**, the sweep        |
| Refund                    | `refundCapturedPayment` with our own refund reference        | The shop's automatic full refunds                           |
| Payment request           | `POST /v2/invoicing/invoices`, then `…/{id}/send`            | **Request online payment** in another currency (admin)      |
| Read or cancel a request  | `GET /v2/invoicing/invoices/{id}`, `POST …/{id}/cancel`      | **Check payment status**, a request replaced or cancelled   |
| Check a webhook           | `POST /v1/notifications/verify-webhook-signature`            | `POST /payments/paypal/webhook`                             |
| Access token              | `POST /v1/oauth2/token`                                      | Every call                                                  |

- **Capture is idempotent** by our attempt id, so the return page, **Check payment status** and the sweep can all finish an approved payment without capturing twice.
- **PayPal's own figures** (gross, fee, net, rupees received and its exchange rate) come from the capture's `seller_receivable_breakdown` and are kept on the payment for the books only. Prices never learn from them.
- **Payment requests** are PayPal invoices, which PayPal emails itself. PayPal sends no SMS and its wording is its own; the order page's **Send as SMS** and **Send as email** send our own messages instead.
- **A webhook only names an attempt.** It is checked over PayPal's own bytes against `PAYPAL_WEBHOOK_ID` and refused when the id is missing; the status enquiry then decides.

## Settings

| Name                   | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `PAYPAL_CLIENT_ID`     | The REST app's client id                                |
| `PAYPAL_CLIENT_SECRET` | The REST app's secret                                   |
| `PAYPAL_ENV`           | `sandbox` (PayPal's test system) or `live` (real money) |
| `PAYPAL_WEBHOOK_ID`    | The webhook's id, for the signature check               |

PayPal is on only when the client id, the secret and `PAYPAL_ENV` are all set and `PAYPAL_ENV` fits where the server runs: `live` only in production (`DEPLOY_ENV=production`), `sandbox` everywhere else. A mismatch fails closed: PayPal stays off, a startup line names the reason (never a value), and nothing is sent to PayPal. With PayPal off, the shop keeps Pay off for other currencies (`noGateway`) and the admin can't request a payment in them.

Return to [Payments](/payments).
