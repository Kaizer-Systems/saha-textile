---
title: Payment and Order Lifecycle
wide: true
description: Gateway selection, hosted payment, idempotency, atomic order records, status transitions, and ownership.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-21'
source_of_truth:
    - apps/api/src/orders
    - apps/api/src/shop-checkout
    - apps/api/src/admin-orders
    - packages/contracts/src/order.ts
    - packages/core-domain/src/orders/status-machine.ts
    - packages/core-domain/src/orders/numbering.ts
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/core-domain/src/payments/decide-payment-result.ts
    - packages/adapters-payments/src
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx
---

# Payment and order lifecycle

This page describes how orders and payments relate, and the rules a payment integration must follow. The shop checkout's Pay, the admin's payment requests and **Check payment status** all go through `PaymentGatewayPort` and the one rule that judges a gateway's answers. How staff create orders, take payments and run open orders is in [Admin ordering, zones and payments](/business-flows/admin-ordering-and-zones); the shop's side is in [Checkout](/business-flows/checkout).

## Gateway selection

| Paid currency                | Gateway role                  | Decided by            |
| ---------------------------- | ----------------------------- | --------------------- |
| INR                          | INR online gateway (CCAvenue) | API checkout use case |
| Any enabled non-INR currency | PayPal                        | API checkout use case |

Angular does not choose a gateway. The server derives it from the validated paid currency and active configuration.

## Initiation and confirmation

```mermaid
sequenceDiagram
    actor Customer
    participant SF as Storefront
    participant API as Payment/order API
    participant DB as Mongo transaction
    participant Gateway as Hosted gateway

    Customer->>SF: Confirm priced checkout
    SF->>API: Initiate with checkout snapshot + idempotency key
    API->>API: Revalidate snapshot, currency, gateway, ownership
    API->>DB: Create pending order + payment attempt atomically
    DB-->>API: Durable identifiers
    API-->>SF: Approved hosted handoff
    SF->>Gateway: Redirect or approved hosted flow
    Gateway-->>API: Signed callback/webhook
    API->>API: Verify signature, amount, currency, attempt, idempotency
    API->>DB: Transition payment/order transactionally
    API-->>SF: Safe status lookup result
```

Gateway credentials, encryption keys and webhook secrets stay on the server behind `PaymentGatewayPort`.

## Why order and payment are separate

One order can have several payment attempts. A failed attempt must not erase the shopping record, and a gateway callback must not rewrite purchased facts.

```mermaid
erDiagram
    ORDER ||--o{ PAYMENT : "has attempts"
    ORDER ||--o{ SHIPMENT : "is fulfilled by"
    ORDER ||--o{ RETURN : "may receive"
    PAYMENT ||--o{ REFUND : "may reverse"
    RETURN o|--o{ REFUND : "may motivate"
```

## Order snapshot

Every purchased line freezes enough information to stay correct after product edits or archival:

- Product and optional variant identifiers.
- Title, slug, SKU, product type and category context.
- Chosen variation attributes.
- Named add-ons and captured measurements.
- Image reference.
- Unit and line totals in INR and the paid currency.
- Resolved promotion and tax lines.
- Return and refund eligibility facts.
- Product status at purchase.

Order history renders from the snapshot, not from the current product.

## Lifecycle separation

### Order

`OrderStatus`: `open` (an admin order kept open to add pieces), `awaiting_payment`, `placed`, `processing`, `packed`, `shipped`, `out_for_delivery` (set only by a connected courier), `delivered` and `cancelled`. The status machine in `packages/core-domain/src/orders/status-machine.ts` offers only the next steps an order can take and names the reason a step is blocked (for example Packed without a needed invoice address). Every change is kept in the order's history with who made it and the comment.

The payment status sits beside it (`OrderPaymentStatus`): `unpaid`, `request_sent`, `pending_at_bank`, `paid`, `part_paid`, `paid_ahead`, `due_on_delivery`, `on_account`, `refunded` and `part_refunded`. It is worked out again from every payment after each change.

### Payment attempt

`PaymentState` in `packages/core-domain` has seven values: `pending`, `authorized`, `captured`, `failed`, `cancelled`, `refunded` and `review`. An attempt moves only forward:

| From         | May move to                                                 |
| ------------ | ----------------------------------------------------------- |
| `pending`    | `authorized`, `captured`, `failed`, `cancelled`, `refunded` |
| `authorized` | `captured`, `cancelled`, `refunded`                         |
| `captured`   | `refunded`                                                  |
| `failed`     | `authorized`, `captured`, `cancelled`                       |
| `cancelled`  | `authorized`, `captured`, `refunded`                        |
| `refunded`   | nothing                                                     |
| `review`     | nothing without an operator                                 |

A failed or cancelled attempt can still turn out paid, because money that really moved must be recorded. Nothing moves from paid back to failed. Amounts are whole minor units (paise for INR) in `amountMinor`, and every attempt has its own `attemptId`, sent to the gateway as its order id.

### Shipment

Quote, label, pickup, transit, delivery, failure and cancellation are shipment events, not order or payment fields.

## Idempotency and callback safety

- Client retries reuse an idempotency key tied to the same priced snapshot.
- Provider callbacks are authenticated and checked against the stored amount, currency, order and attempt.
- Repeated valid callbacks return the existing result.
- A browser return URL is not proof of payment.
- `decidePaymentResult` applies these rules for every gateway. Only a direct status enquiry can change an attempt; a callback is checked against it and against the stored attempt.
- Unknown, mismatched or stale callbacks fail closed and enter an auditable review path.

### Judging a gateway's answer

`decidePaymentResult(attempt, status, callback?)` in `packages/core-domain/src/payments` is the one rule for every gateway. `attempt` is the stored attempt, `status` is the direct enquiry (`fetchPaymentStatus`, where `null` means the gateway has no record), and `callback` is the optional browser return (`verifyCallback`). It answers one of four decisions:

| Decision    | Meaning                                                                        |
| ----------- | ------------------------------------------------------------------------------ |
| `apply`     | Record the returned state and gateway reference on the attempt.                |
| `duplicate` | The attempt already holds this state. Change nothing and answer as before.     |
| `pending`   | No verdict yet. Enquire again later.                                           |
| `review`    | Change nothing and hand the attempt to an operator, with one of these reasons. |

| Review reason                  | When                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `attempt-mismatch`             | A report names a different attempt.                                           |
| `currency-mismatch`            | A report's currency differs from the stored attempt.                          |
| `amount-mismatch`              | A report's amount differs from the stored attempt.                            |
| `reference-mismatch`           | The stored, status and callback gateway references disagree.                  |
| `paid-callback-without-record` | The callback claims payment, but the gateway has no record.                   |
| `gateway-flagged`              | The gateway itself marks the payment for review, for example as high risk.    |
| `paid-callback-contradicted`   | The callback claims payment, but the status says failed or cancelled.         |
| `state-regression`             | The status would move the attempt backwards, or a paid attempt reads pending. |

The checks run in that order. Only the status answer can change an attempt, so a re-posted callback, or an old failure arriving after a success, meets the same status and resolves to `duplicate`. The function is pure; the caller applies the decision to the attempt and its order in one transaction.

## Ownership and authorization

Customers can read only their own orders. A mismatch returns not-found. An admin holding `order.index` can read any order. `PATCH /orders/:id/status` needs an admin session, CSRF and `order.update`. A guarded route or a supplied order id is never sufficient authorization.

## Document numbering

`packages/core-domain/src/orders/numbering.ts` renders and checks every number; counters live behind `NumberAllocatorPort`.

- **Order number:** `ST-YYMM-NNNNNN`, the year and month followed by six random digits (`ST-2611-482190`). It never restarts, reveals nothing about volume and is checked for uniqueness. Its SMS form drops the hyphens (`ST2611482190`).
- **Numbers hung off the order:** shipments `/P1`, returns `/R1`, payment requests `/Q1` (`ST-2611-482190/P1`).
- **GST documents** (tax invoice, credit and debit note, receipt, refund and payment vouchers, delivery challan, self-invoice): one series per document type, at most 16 characters, restarting each financial year (`RC/26-27/000457`). The financial year is worked out in IST.
- **Taken inside the save:** a number is issued only when the document is final, in the same transaction, so drafts and failed saves never use one up. A cancelled document keeps its number.
- **Formats are settings,** checked when set and locked once the first number is issued.

## Failure matrix

| Situation                       | Order                               | Payment                        | Customer experience                    |
| ------------------------------- | ----------------------------------- | ------------------------------ | -------------------------------------- |
| Provider handoff fails          | Stays pending or abandoned          | Attempt failed or not started  | Retry safely without a duplicate order |
| Browser closes                  | Pending state remains               | Await callback or status check | Resume from account or order status    |
| Callback delayed                | Not marked paid from browser return | Pending                        | Explain processing and poll safely     |
| Return lost while API is down   | Pending state remains               | Settled by status enquiry      | "Confirming your payment" page         |
| Amount mismatch                 | Not fulfilled                       | Flagged or failed              | Safe generic message; operator alert   |
| Duplicate callback              | No duplicate transition             | Existing result returned       | Stable confirmation                    |
| Stock changed before initiation | Not initiated                       | None                           | Return to corrected checkout           |

## Limitations

- `POST /orders` creates a `pending` order from the cart without an idempotency key, stock step or payment step. The shop checkout places orders through Pay (`POST /storefront/checkout/place`) instead; see [Admin ordering, zones and payments](/business-flows/admin-ordering-and-zones#paying-at-the-shop).
- `PATCH /orders/:id/status` doesn't apply the status machine. Staff move orders through the admin order routes, which do.
- Tax invoices are not issued: they need the HSN codes and rates as well as the invoice series.

## Debugging checkpoints

1. Trace the checkout snapshot id and idempotency key.
2. Check the server-derived gateway and paid currency.
3. Inspect the order and the payment attempt separately.
4. Verify the provider signature, amount and currency.
5. Inspect the status timeline and audit records.
6. Confirm ownership and permission checks.
7. Never rely on the browser success page.

## Provider documents

Provider reference material is under [Payments](/payments):

- [CCAvenue](/payments/ccavenue): the INR gateway role.
- [Razorpay](/payments/razorpay): a possible later INR gateway.
- [PayPal](/payments/paypal): the non-INR role.
