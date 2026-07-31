---
title: API Overview
description: Current API application boundary, capability status, navigation, and generated reference.
status: scaffolded
audience: [beginner, backend, frontend]
last_verified: '2026-08-01'
source_of_truth:
    - apps/api/src
    - packages/contracts/src
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
| Auth/session guide   | Human-authored security and lifecycle guide            | **Scaffolded** | Auth controller, service, guards and infrastructure exist; full verification remains |

## Current module snapshot

The application currently exposes health, authentication, catalogue, cart, orders, currency and promotion modules. Its platform foundation now includes per-request correlation ids, redacted structured logs, the shared safe error envelope, trusted client-IP rate-limit keys, strict CORS, dependency-free liveness, dependency-aware readiness, cookie attributes, global double-submit CSRF enforcement, and `GET /auth/csrf`. The broader cookie-session lifecycle and new shared auth/session/consent/audit/notification contract families are not wired end to end. Every module still needs to be evaluated against its roadmap definition of done before the overall API can be called implemented.

## Interactive-request boundary

The Scalar client may target approved development or staging servers only. The current document declares local API port `4000`. It preserves normal authentication, CSRF, authorization, rate limits and CORS, and it must never embed credentials or turn the private documentation deployment into an unrestricted production console.

Every endpoint page or generated operation should identify authentication, authorization, validation failures, business-rule failures, rate limits, side effects, and related collections.

## API documentation map

- [Current route inventory](./route-inventory) — every controller path and its verified boundary.
- [Request lifecycle](../backend/request-lifecycle) — how data and trust cross the stack.
- [Contracts and validation](../backend/contracts-and-validation) — request/domain/persistence/response shapes.
- [Security and identity](../backend/security-and-identity) — bearer scaffold versus locked cookie-session target.
- [OpenAPI and Scalar](./openapi-and-scalar) — machine contract, completeness gate, publication and interaction policy.
- [Readiness and verification](../backend/readiness-testing-and-observability) — tests, probes and operational proof.

## What not to infer

- An `@ApiOperation` summary does not prove a complete request/response schema.
- A JWT guard does not prove ownership authorization.
- A controller route does not prove the Angular apps use it.
- An adapter binding does not prove the dependency is ready.
- A successful `/health` or `/health/live` response proves only process liveness; `/health/ready` is the dependency-aware signal.
- An OpenAPI path does not make the transitional API UI the long-term portal.
