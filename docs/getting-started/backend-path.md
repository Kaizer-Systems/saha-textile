---
title: Backend Path
description: Onboarding route for API, contracts, domain and adapter work.
status: scaffolded
audience: [backend]
last_verified: '2026-08-01'
source_of_truth:
    - apps/api/src
    - packages/core-domain/src
    - packages/contracts/src
    - packages/adapters-db-mongo/src
---

# Backend path

Use this path for NestJS controllers, contracts, domain use cases, persistence, authentication or an external integration adapter.

## Current implementation snapshot

The repository already contains an API composition root, health/auth/catalog/cart/order/currency/promotion modules, OpenAPI generation, domain ports and a Mongo adapter with models, indexes and repositories. This is a working scaffold and partial implementation—not a finished production API.

The portal publishes a human-facing Scalar scaffold and a source-only 32-model MongoDB catalogue. Both expose current evidence and limitations; neither represents a complete contract. The existing framework API documentation UI is transitional and deprecated.

## Read in this order

1. [System overview](/architecture/system-overview)
2. [Business and commerce journey atlas](/business-flows/overview)
3. [Backend platform atlas](/backend/overview)
4. [Request lifecycle](/backend/request-lifecycle)
5. [Contracts and validation](/backend/contracts-and-validation)
6. [Core domain and ports](/backend/core-domain-and-ports)
7. [Security and identity](/backend/security-and-identity)
8. [Current API route inventory](/api/route-inventory)
9. [Current Mongo adapter map](/database/current-adapter-map), if persistence is involved
10. The exact shared contract, use case, port, controller and adapter source paths

## Required dependency direction

```text
HTTP controller
→ application/domain port
→ domain use case
← adapter implementation bound at composition time
```

The domain package must not import NestJS, Mongoose, provider SDKs, adapters, or UI types. The ratified `G-CORE-CONTRACTS` exception permits project-owned contract shapes through `import type` only, preserving a runtime-pure core; value imports from contracts remain forbidden. Persistence models must be mapped at the adapter boundary and must not leak into public contracts.

## Completion checklist

- Validate every external boundary with zod.
- Add authorization checks at object level, not only route level.
- Update the OpenAPI contract and examples.
- Test the use case and adapter behaviour.
- Document collections, indexes, side effects, retries and failure modes.
- Prove liveness/readiness, negative authorization, idempotency and transaction behavior where applicable.
