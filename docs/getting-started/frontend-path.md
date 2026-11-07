---
title: Frontend Path
description: Reading path for storefront and admin developers.
status: scaffolded
audience: [frontend]
last_verified: '2026-11-07'
source_of_truth:
    - apps/storefront/src/app
    - apps/admin/src/app
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
---

# Frontend path

Use this path for work in the Angular storefront, the Angular admin application, shared contracts, client state or server-state queries.

## Recommended learning sequence

1. Read [System overview](/architecture/system-overview) and [Monorepo map](/architecture/monorepo-map).
2. Use the [Business and commerce journey atlas](/business-flows/overview) to understand end-to-end behaviour.
3. Use [Storefront orientation](/storefront/overview) for customer-facing work.
4. Use [Admin orientation](/admin/overview) for operator work.
5. Read the [Frontend engineering system](/frontend/engineering-system).
6. Read [Frontend quality and definition of done](/frontend/quality-and-definition-of-done).

## Choose by task

| Task                            | Start here                              |
| ------------------------------- | --------------------------------------- |
| Add or change a customer URL    | Storefront routing and rendering        |
| Change catalogue or cart state  | Storefront state and data ownership     |
| Trace a commerce journey        | Business and commerce journey atlas     |
| Add an operator feature         | Admin contributor recipes               |
| Build a complex form or table   | Admin forms, tables, and CRUD           |
| Choose a state library          | Frontend engineering system             |
| Decide whether work is complete | Frontend quality and definition of done |

## Frontend stack

- The storefront uses Analog file-based pages under `apps/storefront/src/app/pages`.
- Classic NgRx holds heavily mutated client state: cart, wishlist and compare.
- TanStack Angular Query holds server state, with feature queries under `data-access/queries`.
- NgRx SignalStore holds small application state such as session and settings.
- Both applications use Transloco for interface text, with English and French translations.
- Some services read the API and others read JSON files. Check the service method behind your page before changing data behaviour. The storefront and admin state pages list which is which.

## Read in this order

1. [Storefront orientation](/storefront/overview) or [Admin orientation](/admin/overview)
2. [System overview](/architecture/system-overview)
3. The target page or feature route
4. Its query, store and service
5. The matching contract or API operation, if one exists

## Frontend change trace

For every behaviour change, trace:

```text
URL or user action → page or feature → query, store or form → service → contract or API operation
```

If the trace jumps from an Angular application into a persistence or infrastructure adapter, the dependency is in the wrong layer.

## Completion checklist

- Check desktop, tablet and phone layouts.
- Check keyboard focus and the loading, empty, error and retry states.
- Confirm that JSON-backed behaviour is not described as API behaviour.
- Update the portal when a route, workflow, query key, state owner or public interaction changes.
