---
title: API Overview
description: What the API does, its modules, and where to find API documentation.
status: scaffolded
audience: [beginner, backend, frontend]
last_verified: '2026-11-07'
source_of_truth:
    - apps/api/src
    - packages/contracts/src
    - packages/adapters-db-mongo/src/repositories/auth.repository.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# API overview

The Saha Textile API is a NestJS application on Fastify. It serves the storefront and the admin application, owns authentication and validation, and is the only component that talks to the database and external providers.

Start with the [Backend platform atlas](../backend/overview) to see how HTTP, application services, domain rules, ports, adapters and persistence connect.

## API modules

| Module                   | Responsibility                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `health`                 | Liveness and readiness probes                                                        |
| `auth`, `security`       | Storefront and admin sessions, signup, sign-in, recovery, CSRF tokens                |
| `storefront`             | Customer self-service: profile, addresses, contact changes                           |
| `admin`                  | Roles, operators, customers, notification settings, audit trail                      |
| `catalog`                | Public catalogue reads, admin product forms, redirects, FAQ, questions, stock alerts |
| `search`                 | Meilisearch adapter behind `SearchPort`                                              |
| `media`                  | Media library, uploads, banners, YouTube, reviews                                    |
| `cart`, `orders`         | Cart lifecycle and order creation                                                    |
| `currency`, `promotions` | Currency conversion and coupon validation                                            |
| `privacy`                | Consent records, export and erasure requests                                         |
| `worker`                 | The background worker process, built from the same image                             |

## Platform behaviour

Every request passes through the same controls: correlation ids, redacted logs, one safe error shape, client-IP rate limiting, strict CORS, cookie sessions and double-submit CSRF. See [Request lifecycle](../backend/request-lifecycle).

## API documentation

| Surface                                                                      | Purpose                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [Route inventory](./route-inventory)                                         | Every route with its access rule                            |
| [OpenAPI and Scalar](./openapi-and-scalar)                                   | The machine-readable contract and the interactive reference |
| [Security and identity](../backend/security-and-identity)                    | Sessions, CSRF, audiences, PIN and permissions              |
| [Contracts and validation](../backend/contracts-and-validation)              | Request, domain, persistence and response shapes            |
| [Readiness and verification](../backend/readiness-testing-and-observability) | Health probes and tests                                     |

## Reading the API reference correctly

- An operation summary does not describe the full request and response schema.
- A session guard does not prove ownership. Ownership is checked separately.
- A route does not mean an Angular application uses it.
- `/health/live` shows that the process is running. `/health/ready` shows that its dependencies are usable.

## Limitations

- The API has no payment, shipping or exchange-rate adapter.
- The OpenAPI document does not include full schemas or per-operation security. See [OpenAPI and Scalar](./openapi-and-scalar#limitations).
