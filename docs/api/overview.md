---
title: API Overview
description: Current API application boundary, capability status, navigation, and generated reference.
status: scaffolded
audience: [beginner, backend, frontend]
last_verified: '2026-08-18'
source_of_truth:
    - apps/api/src
    - packages/contracts/src
    - packages/adapters-db-mongo/src/repositories/auth.repository.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# API overview

The API application has real NestJS modules, controllers, OpenAPI generation and adapter bindings. It is a scaffolded and partial implementation, not a finished production surface.

Start with the [Backend Platform Atlas](../backend/overview) when you need to understand how HTTP, application services, domain rules, ports, adapters, and persistence connect.

## Current portal surfaces

| Surface              | Purpose                                                | Status         | Evidence or trigger                                                                  |
| -------------------- | ------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------ |
| OpenAPI JSON         | Machine-readable API contract                          | **Scaffolded** | Shared source generator; incomplete operation metadata remains visible               |
| Transitional API UI  | Temporary framework-provided reference                 | **Deprecated** | Existing `/docs` route; do not deepen it                                             |
| Scalar API Reference | One readable reference and approved interactive client | **Scaffolded** | Current OpenAPI at `/api/reference/`; promote only after the completeness gates pass |
| Portal OpenAPI route | Stable machine-readable portal path                    | **Scaffolded** | Source-generated during the atomic build at `/api/openapi.json`                      |
| Auth/session guide   | Human-authored security and lifecycle guide            | **Scaffolded** | Cookie lifecycle, audiences, CSRF and D3–D5 residual gaps are evidence-backed        |

## Current module snapshot

The application currently exposes health, storefront/admin authentication, storefront account self-service, admin authorization (including CRM customers and notification settings), privacy, catalogue, cart, orders, currency, and promotion modules. Its platform foundation includes per-request correlation ids, redacted structured logs, the shared safe error envelope with stable refusal reasons, trusted client-IP rate-limit keys, strict CORS, dependency-free liveness, dependency-aware readiness, cookie-only sessions, atomic refresh rotation and reuse revocation, session-bound double-submit CSRF, storefront/admin audiences, verified-before-creation signup, password and OTP login by email or phone, Google and Facebook verifier adapters, identity linking, remember-me lifetime alignment, account security and contact-change flows, guest-cart adoption, admin recovery/invites/HTTP resume, Account Security, idle soft-lock resume, a closed **89-code** permission registry, assignment resolution, deny-by-default authority routes, no-delegation and last-administrator controls, audited offboarding, operator bootstrap, consent/privacy, cart and order ownership, and transactional order-save plus cart-consume. Authentication remains partial because real provider activation and browser proof, real-browser PIN-login proof, pending-intent continuation, and granular adoption by older privileged routes remain open; portal private-access deployment and soft-delete operations remain decision-gated. The broader contract and persistence families are not all wired end to end; each module must satisfy its roadmap definition of done before the overall API can be classified as implemented.

## Interactive-request boundary

The Scalar client may target approved development or staging servers only. The current document declares local API port `4000`. It preserves normal authentication, CSRF, authorization, rate limits and CORS, and it must never embed credentials or turn the private documentation deployment into an unrestricted production console.

Every endpoint page or generated operation should identify authentication, authorization, validation failures, business-rule failures, rate limits, side effects, and related collections.

## API documentation map

- [Current route inventory](./route-inventory) — every controller path and its verified boundary.
- [Request lifecycle](../backend/request-lifecycle) — how data and trust cross the stack.
- [Contracts and validation](../backend/contracts-and-validation) — request/domain/persistence/response shapes.
- [Security and identity](../backend/security-and-identity) — active cookie sessions, CSRF, audiences, PIN/RBAC and residual gaps.
- [OpenAPI and Scalar](./openapi-and-scalar) — machine contract, completeness gate, publication and interaction policy.
- [Readiness and verification](../backend/readiness-testing-and-observability) — tests, probes and operational proof.

## Interpretation boundaries

- An `@ApiOperation` summary does not prove a complete request/response schema.
- A session guard does not prove ownership authorization.
- A controller route does not prove the Angular apps use it.
- An adapter binding does not prove the dependency is ready.
- A successful `/health` or `/health/live` response proves only process liveness; `/health/ready` is the dependency-aware signal.
- An OpenAPI path does not make the transitional API UI the long-term portal.
