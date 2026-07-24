---
title: System Overview
description: High-level architecture and dependency direction.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - AGENTS.md
    - project-context/angular-context/saha-textile-technical-knowledgebase.md
---

# System overview

Saha Textile is a boutique e-commerce platform split into deployable storefront, admin, API, and private developer-portal apps inside one pnpm/Turborepo monorepo.

The application follows a hexagonal architecture. Domain rules live in `packages/core-domain`; infrastructure lives in adapters; deployable apps compose ports to adapters at the edge.

```mermaid
flowchart LR
    Storefront["Storefront app"] --> API["API app"]
    Admin["Admin app"] --> API
    API --> Core["core-domain ports and use cases"]
    MongoAdapter["Mongo adapter"] --> Core
    PaymentAdapter["Payment adapters"] --> Core
    ShippingAdapter["Shipping adapter"] --> Core
    SearchAdapter["Search adapter"] --> Core
    StorageAdapter["Storage adapter"] --> Core
```

## Dependency rule

Imports point inward. Core domain code does not import NestJS, Angular, MongoDB, payment SDKs, storage SDKs, or other adapters.

## Swap test

Replacing an edge concern should require a new adapter and DI binding, not edits across core use cases or UI packages.
