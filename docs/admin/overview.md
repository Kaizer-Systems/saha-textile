---
title: Admin Orientation
wide: true
description: Start here before changing the Angular administration application.
status: scaffolded
audience: [beginner, frontend, operator]
last_verified: '2026-07-26'
source_of_truth:
    - apps/admin/src/app
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Admin orientation

The admin application is the private operator workspace for catalogue, orders, customers, promotions, content, configuration, and reporting. It is an Angular 21 single-page application with a broad lazy-loaded feature tree.

The routed UI surface is substantial, but most domain reads still come from static JSON and most writes remain explicit mock seams. Treat the admin as a mature UI scaffold awaiting contract-backed operations—not as an operational commerce back office.

## Read this section in order

1. [Application atlas](./application-atlas) — filter features by current implementation status.
2. [Routing and shell](./routing-and-shell) — follow a URL through guards, layouts, and lazy feature routes.
3. [State and data](./state-and-data) — understand query, store, interceptor, and fixture ownership.
4. [Forms, tables, and CRUD](./forms-tables-and-crud) — use the established admin interaction patterns safely.
5. [Contributor recipes](./contributor-recipes) — add a feature without bypassing architecture or honesty boundaries.

## Mental model

```mermaid
flowchart LR
    Operator["Operator"] --> Router["Angular Router"]
    Router --> Guard["Authentication guard"]
    Guard --> Shell["Content or full-page shell"]
    Shell --> Feature["Lazy feature route"]
    Feature --> Query["TanStack query"]
    Query --> Service["Typed service"]
    Service --> Fixture["Current JSON fixture"]
    Feature --> Mutation["Current write seam"]
    Mutation --> Future["Future contract-backed API operation"]
```

## Current implementation snapshot

| Concern             | Current evidence                                                             | Status      | Important boundary                                                                        |
| ------------------- | ---------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| Route graph         | Authentication, two shells, fallback, and roughly 30 lazy feature families   | Implemented | A routed screen is not proof of a connected backend workflow.                             |
| Admin shell         | Header, sidebar, footer, loader, and page wrapper exist                      | Implemented | Menu badges/account initialization still depend on transitional readers.                  |
| Authentication      | Guard and SignalStore session seam exist                                     | Scaffolded  | A persisted demo token makes the shell accessible; real admin auth is not connected.      |
| Server-state reads  | TanStack Query functions cover most feature lists/details                    | Scaffolded  | Services primarily request JSON fixtures.                                                 |
| Cart/order creation | Classic NgRx cart and checkout composition exist                             | Scaffolded  | Order placement and authoritative totals are not connected.                               |
| Forms               | Reactive forms exist for major catalogue/content/settings features           | Scaffolded  | Submission paths frequently stop at mock methods or navigation.                           |
| Tables              | Shared search, pagination, selection, date, action, and permission UI exists | Scaffolded  | Backend filtering/bulk mutations are not generally operational.                           |
| Authorization       | Permission-shaped UI directives and account permissions exist                | Scaffolded  | UI visibility is not a security boundary; API authorization must enforce every operation. |

## Feature families

The content shell lazy-loads dashboard, account, role, user, attribute, tag, blog, page, tax, store, category, shipping, media, coupon, product, currency, customer ledger, points, settings, order status, orders, theme options, reviews, FAQs, notifications, refunds, and questions/answers.

Several families also expose create/edit routes. Orders add details, create-order, and checkout routes; blog adds category and tag subflows.

## Directory ownership

| Directory                   | Owns                                                     | Should not own                 |
| --------------------------- | -------------------------------------------------------- | ------------------------------ |
| `routes/` and `*.routes.ts` | URL composition and lazy boundaries                      | Domain rules                   |
| `layout/`                   | Admin chrome and page shells                             | Feature CRUD logic             |
| `features/`                 | Operator workflows and feature presentation              | Hard-coded transport details   |
| `data-access/queries/`      | Remote cache keys and read lifecycles                    | Form-local state               |
| `data-access/services/`     | Typed transport methods                                  | Authorization policy           |
| `core/state/`               | Session, account, menu, settings, loader, and cart state | Duplicate remote collections   |
| `shared/ui/`                | Tables, fields, upload controls, modals, pagination      | Feature-specific orchestration |
| `shared/directives/`        | Reusable presentation behavior                           | Backend access control         |

:::danger UI permissions are not authorization

Hiding an action in a table or menu improves usability, but it does not secure the operation. The API must authenticate the actor and authorize the specific resource/action on every request.

:::

## Before making an admin change

- Identify the feature route and its owning shell.
- Trace every displayed record to its query and service.
- Confirm whether the action is a real mutation or a mock seam.
- Reuse shared table/form/upload primitives when they fit.
- Do not preserve weak typing or placeholder behavior merely because it already exists.
- Design API-backed writes around shared contracts, error recovery, and operator auditability.
