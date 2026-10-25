---
title: PayPal
description: Deferred page for the non-INR gateway. PayPal business documentation is not written yet.
status: deferred
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: PayPal non-INR international gross-up
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# PayPal

Non-INR checkout uses the PayPal role. The owner log states that PayPal foreign pricing uses a versioned, admin-editable percentage and fixed-fee gross-up, and that gateway secrets stay server-side. The shared contract enum `PaymentGateway` includes `paypal`. `PaymentGatewayPort` does not yet have a PayPal adapter behind it.

PayPal business documentation is not written on this page. That pass is logged under **Payments / shipping / FX** in [Project progress](/engineering-live-context/project-progress).

Return to [Payments](/payments).
