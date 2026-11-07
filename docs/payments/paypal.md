---
title: PayPal
description: The non-INR gateway role.
status: deferred
audience: [backend, operator]
last_verified: '2026-11-07'
search_keywords: PayPal non-INR international gross-up
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/contracts/src
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/environment-variables.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# PayPal

PayPal is the gateway role for non-INR checkout. Foreign pricing uses a versioned, admin-editable percentage and fixed-fee gross-up. Gateway secrets stay on the server.

This page follows the same two-section format as [CCAvenue](/payments/ccavenue#2-endpoints-we-use).

## 1. Company-provided documentation

No PayPal documentation is included.

## 2. Endpoints we use

None. The shared contract enum `PaymentGateway` includes `paypal`, and the [environment catalogue](/engineering-live-context/environment-variables) lists `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` and `PAYPAL_ENV`. No code reads these values, and no adapter implements `PaymentGatewayPort` for PayPal.

Return to [Payments](/payments).
