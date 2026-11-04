---
title: PayPal
description: Non-INR gateway. Section 1 (company-provided documentation) and section 2 (endpoints we use) are both empty until the PayPal documentation pass.
status: deferred
audience: [backend, operator]
last_verified: '2026-11-04'
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

Non-INR checkout uses the PayPal role. The owner log states that PayPal foreign pricing uses a versioned, admin-editable percentage and fixed-fee gross-up, and that gateway secrets stay server-side.

Like every gateway landing page, this page has two sections. **Section 1** holds the vendor's own documentation; **section 2** holds the calls this project makes, in the format used on [CCAvenue § 2](/payments/ccavenue#2-endpoints-we-use).

## 1. Company-provided documentation

Not written yet. No PayPal business account documentation or kit has been transcribed. That pass is logged under **Payments / shipping / FX** in [Project progress](/engineering-live-context/project-progress).

## 2. Endpoints we use

**Status: none wired.** The shared contract enum `PaymentGateway` includes `paypal`, and [Environment variables](/engineering-live-context/environment-variables) catalogues `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET` and `PAYPAL_ENV` (sandbox for staging, live for production). No code reads them, and `PaymentGatewayPort` has no PayPal adapter behind it. When the adapter is built in Chunk G, its calls are listed here the same way [CCAvenue § 2](/payments/ccavenue#2-endpoints-we-use) lists CCAvenue's.

Return to [Payments](/payments).
