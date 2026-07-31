---
title: Frontend Path
description: Onboarding route for storefront and admin developers.
status: scaffolded
audience: [frontend]
last_verified: '2026-08-01'
source_of_truth:
    - apps/storefront/src/app
    - apps/admin/src/app
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
---

# Frontend path

Use this path for work in the Angular storefront, Angular admin application, shared contracts, client-side state, or server-state query boundaries.

## Recommended learning sequence

1. Read [System overview](/architecture/system-overview) and [Monorepo map](/architecture/monorepo-map).
2. Use the [Business and commerce journey atlas](/business-flows/overview) to understand end-to-end intent.
3. Use the [Storefront orientation](/storefront/overview) for public customer work.
4. Use the [Admin orientation](/admin/overview) for operator work.
5. Learn the shared [Frontend engineering system](/frontend/engineering-system).
6. Read the [Frontend quality and definition of done](/frontend/quality-and-definition-of-done).

## Choose by task

| Your task                            | Start here                               |
| ------------------------------------ | ---------------------------------------- |
| Add or change a customer URL         | Storefront routing and rendering         |
| Change catalogue/cart/checkout state | Storefront state and data ownership      |
| Trace a commerce journey             | Business and commerce journey atlas      |
| Add an operator feature              | Admin contributor recipes                |
| Build a complex form or table        | Admin forms, tables, and CRUD            |
| Choose a state library               | Frontend engineering system decision lab |
| Decide whether work is complete      | Frontend quality and definition of done  |

## Current implementation snapshot

- The storefront uses Analog file-based pages under `apps/storefront/src/app/pages`.
- The storefront uses classic NgRx for heavily mutated state such as cart, wishlist and compare.
- TanStack Angular Query is the server-state direction, with feature queries under `data-access/queries`.
- The storefront catalogue currently mixes mock JSON readers with a server-side catalogue route; check the service method used by your page before changing data behaviour.
- The admin application has a broad route and feature scaffold with services still reading development JSON data in several areas.
- Both applications use Transloco, interceptors and strict application configuration.

## Read in this order

1. [Storefront orientation](/storefront/overview) or [Admin orientation](/admin/overview)
2. [System overview](/architecture/system-overview)
3. The target page or feature route
4. Its query/store and service boundary
5. The matching contract or API operation, if one exists

## Frontend change trace

For every behaviour change, be able to trace:

```text
route or file-based page
→ page/feature component
→ presentational components
→ SignalStore, NgRx or TanStack Query boundary
→ HTTP service
→ shared contract
→ API operation
```

If the trace jumps directly from an Angular application into a persistence or infrastructure adapter, the dependency boundary is wrong.

## Before handing off

- Verify desktop, tablet and mobile behaviour.
- Verify keyboard focus, loading, empty, error and retry states.
- Confirm that mock-data assumptions are labelled and are not described as production API behaviour.
- Update the portal when a route, workflow, query key, state owner or public interaction changes.
