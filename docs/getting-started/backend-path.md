---
title: Backend Path
description: Reading path for API, contract, domain and adapter work.
status: scaffolded
audience: [backend]
last_verified: '2026-11-07'
source_of_truth:
    - apps/api/src
    - packages/core-domain/src
    - packages/contracts/src
    - packages/adapters-db-mongo/src
---

# Backend path

Use this path for NestJS controllers, contracts, domain logic, persistence, authentication or an external integration adapter.

## Backend components

The backend is a NestJS API on Fastify. It includes:

- Authentication for storefront customers and admin operators, using cookie sessions.
- Catalogue, search, cart, order, currency and promotion modules.
- Media, banner, YouTube and review modules, with a BullMQ worker for background jobs.
- Privacy, consent and audit modules.
- A hexagonal core in `packages/core-domain`, with adapters for MongoDB, Spaces, MSG91, Cloudflare and other providers.

Payment, shipping and exchange-rate adapters are not part of the API. The ports exist in the core domain.

## Read in this order

1. [System overview](/architecture/system-overview)
2. [Business and commerce journey atlas](/business-flows/overview)
3. [Backend platform atlas](/backend/overview)
4. [Request lifecycle](/backend/request-lifecycle)
5. [Contracts and validation](/backend/contracts-and-validation)
6. [Core domain and ports](/backend/core-domain-and-ports)
7. [Security and identity](/backend/security-and-identity)
8. [API route inventory](/api/route-inventory)
9. [Mongo adapter map](/database/current-adapter-map), if persistence is involved
10. The shared contract, port, controller and adapter source files

## Required dependency direction

```text
Applications and adapters → packages/core-domain ← packages/contracts (types only)
```

The core domain must not import NestJS, Mongoose, provider SDKs, adapters or UI types. It may reference contract shapes through `import type` only. Value imports from contracts are forbidden. Persistence models are mapped at the adapter boundary and never appear in public contracts.

## Completion checklist

- Validate every external input with zod.
- Enforce authorization on the object, not only on the route.
- Update the OpenAPI output and examples.
- Test the use case and the adapter.
- Document collections, indexes, side effects, retries and failure modes.
- Cover negative authorization, idempotency and transactions where they apply.
