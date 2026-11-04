---
title: Razorpay
description: Preferred later INR gateway. Section 1 (company-provided documentation) and section 2 (endpoints we use) are both empty until Razorpay access arrives.
status: deferred
audience: [backend, operator]
last_verified: '2026-11-04'
search_keywords: Razorpay INR gateway successor DEC-INR-GATEWAY-TIMING
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - packages/contracts/src
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# Razorpay

Razorpay is the preferred successor for the INR online-gateway role. The owner log states that vendor selection is an adapter plus dependency injection and config only, and that a real provider is wired only when approved credentials exist. `DEC-INR-GATEWAY-TIMING` in [Pending decisions](/engineering-live-context/pending-decisions) is unanswered.

Like every gateway landing page, this page has two sections. **Section 1** holds the vendor's own documentation; **section 2** holds the calls this project makes, in the format used on [CCAvenue § 2](/payments/ccavenue#2-endpoints-we-use).

## 1. Company-provided documentation

None received. No Razorpay access, dashboard, or integration kit has been provided, so no Razorpay API fields, URLs, or samples are written here. This section is filled in from Razorpay's own material when access arrives.

## 2. Endpoints we use

**Status: none.** No Razorpay adapter exists, and the shared contract enum `PaymentGateway` is `ccavenue` or `paypal` — it has no Razorpay value. If Razorpay replaces CCAvenue in the INR role, its calls will sit behind the same `PaymentGatewayPort` methods (`createPayment`, `verifyCallback`) that [CCAvenue § 2](/payments/ccavenue#2-endpoints-we-use) maps, and this section will list them the same way.

The open item is logged under **Payments / shipping / FX** in [Project progress](/engineering-live-context/project-progress).
