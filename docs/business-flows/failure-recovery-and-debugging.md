---
title: Failure Recovery and Debugging
wide: true
description: Cross-journey troubleshooting map for catalogue, cart, auth, checkout, payment, order, shipment, and admin failures.
status: planned
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - apps/storefront/src/app
    - apps/admin/src/app
    - apps/api/src
    - packages/contracts/src
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Failure recovery and debugging

Debug a business journey from the first broken rule, not from the final error toast. A payment-looking failure may have begun with stale stock; an authorization-looking failure may be an expired session; an order mismatch may be a snapshot or ownership problem.

## Universal trace

```mermaid
flowchart TD
    Symptom["Observed symptom"] --> Identity{"Correct user/guest/admin identity?"}
    Identity -->|No| Auth["Session / guest token / permission investigation"]
    Identity -->|Yes| Input{"Request matches shared contract?"}
    Input -->|No| Validation["Boundary validation and form mapping"]
    Input -->|Yes| Version{"Resource/cart/quote version still current?"}
    Version -->|No| Reconcile["Refetch, correct, reconfirm"]
    Version -->|Yes| Domain{"Domain invariant passed?"}
    Domain -->|No| Explain["Structured business correction"]
    Domain -->|Yes| Edge{"Adapter/provider/database result?"}
    Edge --> Records["Audit-safe records and recovery"]
```

## Symptom map

| Symptom                               | Check first                                       | Then inspect                                        | Never do                                 |
| ------------------------------------- | ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| Product missing                       | Status, locale route, redirect/410 policy         | Search index freshness and catalogue source         | Re-publish blindly                       |
| Variant cannot add                    | Semantic role and exact combination               | Stock, add-ons, measurements, line signature        | Force a default invalid variant          |
| Cart differs after login              | Guest/user ownership and merge notices            | Line signatures, stock, expired intent              | Drop conflicting lines silently          |
| Registration resumes unexpectedly     | `st_signup` pending projection and route history  | Reload versus in-app leave; pending TTL             | Trust browser flags as verification      |
| Social button does nothing            | SDK readiness and live provider global on click   | One-use OAuth state, popup policy, callback timer   | Cache a provider loader object blindly   |
| Signup loses a unique-value race      | Stable `signup_identifier_taken` refusal          | Unique index, transaction rollback, spent proof     | Expose a driver duplicate-key error      |
| Contact change refuses at confirm     | Stable `contact_in_use` refusal                   | Proof/identifier/audit transaction rollback         | Burn proof before a partial write        |
| Address disappears after another edit | Atomic single-document address statement          | Target address id, fixed update paths/default rules | Read and replace the whole address array |
| Checkout total changed                | Cart/quote version                                | INR price, promotions, tax, FX, shipping            | Trust the old browser total              |
| Coupon rejected                       | Code, time window, scope, conditions              | Priority/stacking and current cart                  | Apply a client-only discount             |
| Payment “success” but order pending   | Verified callback/webhook                         | Amount/currency/idempotency and attempt state       | Mark paid from return URL                |
| Customer cannot open order            | Session and resource ownership                    | Order snapshot/read model                           | Remove ownership checks                  |
| Admin action hidden/forbidden         | Permission/version and role                       | UI mapping, then API policy                         | Treat UI visibility as authorization     |
| Refund stuck                          | Payment/refund identifiers and provider reference | Idempotency, amount, currency, provider outcome     | Mark processed before confirmation       |
| Notification missing                  | Channel/category switch and consent               | Outbox/provider delivery state                      | Roll back the business event             |

## Information to capture safely

- request/correlation identifier;
- actor type and sanitized identifier;
- route/operation name;
- cart/order/payment/shipment/refund identifiers;
- contract-validation outcome;
- state/status transition before and after;
- adapter/provider outcome category; and
- timestamps in UTC, formatted with context at the UI edge.

Never capture passwords, OTPs, access/refresh tokens, guest-token plaintext, card data, gateway secrets, full sensitive provider payloads, or unnecessary customer PII.

## Recovery principles

1. **Fail closed on security.** Never weaken ownership, CSRF, authentication, or permission checks to make a journey proceed.
2. **Preserve valid user work.** Keep valid cart lines, form fields, drafts, and route origin whenever safe.
3. **Explain corrections locally.** Prefer line/field/action-specific messages over a generic failure banner.
4. **Use idempotency.** Retrying payment, order, refund, and notification commands must not duplicate side effects.
5. **Separate business and communication state.** A failed notification does not erase a successful order transition.
6. **Reconcile from authority.** Replace browser assumptions with validated server truth after reconnect, auth, or conflict.
7. **Audit privileged/manual actions.** Operator overrides need reason, actor, time, and before and after values.
8. **Test at the right layer.** Unit tests cover rules and refusals. Provider popups, user-gesture limits, reload behaviour and multi-page social journeys need a real browser.

## Diagnostic checklist

- [ ] Reproduce using the direct route, not only client navigation.
- [ ] Check whether the behaviour exists or is planned. Do not debug an integration that is not built.
- [ ] Find the route/page, feature, query/store, service, contract, controller, use case, and port involved.
- [ ] Inspect structured validation or business errors before logs.
- [ ] Check ownership and state versions.
- [ ] Check server-calculated values before rendered formatting.
- [ ] Verify retry/idempotency behaviour.
- [ ] Remove sensitive test data from screenshots and issue reports.
- [ ] Update the portal when behaviour changes.
