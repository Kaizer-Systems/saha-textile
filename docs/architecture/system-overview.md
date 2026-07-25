---
title: System Overview
wide: true
description: High-level architecture and dependency direction.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - AGENTS.md
    - apps/api/.env.example
    - apps/storefront/src/app/core/config/runtime-config.ts
    - project-context/angular-context/saha-textile-technical-knowledgebase.md
    - project-context/angular-context/owner-decisions-log.md
---

import { ArchitectureReactor } from '@site/src/components/ArchitectureReactor';

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

The same architecture, live — hover, tap or arrow through a boundary to inspect what exists today:

<ArchitectureReactor />

## Dependency rule

Imports point inward. Core domain code does not import NestJS, Angular, MongoDB, payment SDKs, storage SDKs, or other adapters. The ratified contracts exception is type-only: core may reference project-owned contract shapes through runtime-erased `import type`, while value imports remain forbidden.

## Swap test

Replacing an edge concern should require a new adapter and DI binding, not edits across core use cases or UI packages.

## Runtime configuration and secrets boundary

Configuration is injected at runtime, not baked into builds, and secrets cross exactly one boundary:

- The **API** receives all secrets through its environment (local `.env`; deploy-time env files / Docker Compose secrets).
- The **Angular apps** receive only a public `config.json`, loaded at boot, carrying non-secret values (API/site URLs, locales, public client IDs). No secret ever reaches a browser build.
