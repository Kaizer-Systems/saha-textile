# Developer Portal Pass 3 — Business and Commerce Journeys

**Status:** Implemented and verified on 2026-07-18

**Scope:** Cross-application business journeys and recovery documentation

**Portal runtime:** Docusaurus 3.10.2
**Depends on:** Pass 1 governance and Pass 2 frontend application atlases

## Purpose

Pass 3 explains how customer and operator intent crosses storefront, admin, contracts, API, domain, persistence and provider boundaries. It prevents a route, screen, controller, port or schema from being mistaken for an operational end-to-end flow.

## Implemented portal surfaces

- Interactive journey atlas filtered by discovery, commerce, identity and operations.
- Three accessible evidence lenses on every journey: current code, locked target and failure recovery.
- Discovery, category/search, product configuration and semantic option-role guidance.
- Guest/user cart, pending-intent, merge, expiry and offline-reconciliation guidance.
- Authenticated checkout, INR canonical pricing, promotions, tax, currency, gateway gross-up and shipping quote guidance.
- Payment initiation, idempotency, hosted provider handoff, callback verification and order snapshot guidance.
- Separate shipment, return, refund and notification lifecycle guidance.
- Storefront identity, account ownership, admin soft lock, quick resume and draft restoration guidance.
- Cross-journey failure-recovery and safe-debugging playbook.

## Code-versus-target reconciliation

- Catalogue, cart, order, promotion, currency and auth API/controller scaffolds exist.
- Storefront product and checkout UI exists, but end-to-end product configuration and checkout remain partially fixture/client-backed.
- Current cart behavior is a client NgRx implementation; the locked server-authoritative guest/user cart and merge contract is not complete.
- Current checkout uses static client totals and stub navigation; production checkout calculation is not connected.
- Order contracts/controller/service and `PaymentGatewayPort` exist; gateway adapters and payment execution are not wired.
- Customer/admin order and refund/shipping surfaces exist; provider-backed fulfilment/refund lifecycles are not operational.
- Notification architecture is locked, but `NotificationPort` is not present in the current core-domain package.
- Current auth endpoints/stores are transitional bearer/demo scaffolds; the locked browser model is secure cookies, CSRF and rotating sessions.
- Order/invoice numbering remains an owner-decision gate and is not inferred from the current `orderNumber` contract field.
- Public order tracking remains deliberately deferred at launch; **when-built verification is locked** (order number + email/phone — see `owner-decisions-log.md` §2026-07-23).

## Interaction and accessibility contract

- Journey-area and lifecycle-status filters use pressed-button semantics.
- Journey selection uses native buttons with current-item state.
- Evidence lenses use tab semantics with Arrow Left/Right, Home and End keyboard support.
- The selected journey exposes a five-step ordered timeline and native evidence disclosure.
- Desktop uses a two-rail explorer; tablet converts the selector to a two-column grid; mobile becomes a single-column selector and vertical timeline.
- Focus visibility and reduced-motion behavior are explicit.

## Verification contract

1. Run portal metadata/terminology validation.
2. Run portal TypeScript checking.
3. Run the optimized Docusaurus build.
4. Verify every new journey route from the persistent local preview.
5. Verify filter, selector, evidence-lens, keyboard and disclosure behavior.
6. Check desktop, tablet and mobile overflow/readability.
7. Check browser console health when browser automation is available.
8. Confirm the prohibited vendor-name boundary remains clean.

## Deferred from Pass 3

- API/database implementation.
- Scalar API reference integration.
- Generated database catalogue.
- Live payment, shipping or notification provider adapters.
- Public order tracking (deferred at launch; when built: order number + email/phone verification — owner-locked 2026-07-23).
- Repairing the non-critical Docusaurus hot-reload memory issue.
