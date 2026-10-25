---
title: Razorpay
description: Deferred page for the preferred later INR gateway. No Razorpay API is documented yet.
status: deferred
audience: [backend, operator]
last_verified: '2026-10-26'
search_keywords: Razorpay INR gateway successor DEC-INR-GATEWAY-TIMING
source_of_truth:
    - packages/core-domain/src/ports/payment-gateway.port.ts
    - docs/business-flows/payment-and-order-lifecycle.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# Razorpay

Razorpay is the preferred successor for the INR online-gateway role. The owner log states that vendor selection is an adapter plus dependency injection and config only, and that a real provider is wired only when approved credentials exist.

`DEC-INR-GATEWAY-TIMING` in [Pending decisions](/engineering-live-context/pending-decisions) is unanswered. No Razorpay access has been provided. No Razorpay adapter exists. The shared contract enum `PaymentGateway` is `ccavenue` or `paypal`.

This page stays a placeholder until Razorpay access arrives. No Razorpay API fields, URLs, or samples are written here.

The open item is logged under **Payments / shipping / FX** in [Project progress](/engineering-live-context/project-progress).
