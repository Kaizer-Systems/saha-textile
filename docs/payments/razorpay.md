---
title: Razorpay
description: A possible later INR gateway.
status: deferred
audience: [backend, operator]
last_verified: '2026-11-07'
search_keywords: Razorpay INR gateway successor DEC-INR-GATEWAY-TIMING
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/contracts/src
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# Razorpay

Razorpay is a possible later gateway for the INR role. Changing the gateway requires a new adapter, dependency-injection binding and configuration. Core and UI code do not change.

This page follows the same two-section format as [CCAvenue](/payments/ccavenue#2-endpoints-we-use).

## 1. Company-provided documentation

No Razorpay documentation is included.

## 2. Endpoints we use

None. No Razorpay adapter exists, and the shared contract enum `PaymentGateway` has no Razorpay value. A Razorpay adapter would implement the same `PaymentGatewayPort` methods, `createPayment` and `verifyCallback`.

Return to [Payments](/payments).
