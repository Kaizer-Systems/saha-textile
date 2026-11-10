---
title: Admin Orientation
wide: true
description: What the admin application is, how it is organized, and what to check before changing it.
status: scaffolded
audience: [beginner, frontend, operator]
last_verified: '2026-11-10'
source_of_truth:
    - apps/admin/src/app
    - apps/api/src/admin
    - apps/api/src/first-admin.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Admin orientation

The admin application is the private workspace for operators. It covers catalogue, orders, customers, promotions, content, configuration and reporting. It is an Angular 22 single-page application with lazy-loaded feature routes.

## Recommended reading sequence

1. [Application atlas](./application-atlas): filter features by status.
2. [Routing and shell](./routing-and-shell): follow a URL through guards, layouts and feature routes.
3. [State and data](./state-and-data): understand queries, stores, interceptors and data sources.
4. [Forms, tables, and CRUD](./forms-tables-and-crud): use the established interaction patterns.
5. [Contributor recipes](./contributor-recipes): add a feature step by step.

## Mental model

```mermaid
flowchart LR
    Operator["Operator"] --> Router["Angular Router"]
    Router --> Guard["Authentication guard"]
    Guard --> Shell["Content or full-page shell"]
    Shell --> Feature["Lazy feature route"]
    Feature --> Query["TanStack query"]
    Query --> Service["Typed service"]
    Service --> Source{"Data source"}
    Source --> API["Saha Textile API"]
    Source --> JSON["Static JSON files in public/assets/data"]
```

## Capabilities

| Capability       | How it works                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route graph      | Authentication, two shells, a fallback and about 30 lazy feature families                                                                             |
| Admin shell      | Header, sidebar, footer, loader and page wrapper                                                                                                      |
| Authentication   | Cookie sessions, password and PIN sign-in, recovery, invites and the idle lock                                                                        |
| Account Security | PIN, password and session management at `/account`                                                                                                    |
| Authority        | Roles, operators and role assignments against the permission registry                                                                                 |
| Customers        | List, create, edit, soft delete, recycle bin, restore and customer ledger                                                                             |
| Catalogue        | Product form with Save and next, categories, attributes with swatch pictures, old-address redirects, add-on templates, FAQ, and questions and answers |
| Media            | Media library, home banners, review moderation and the YouTube field                                                                                  |
| Content          | Blog posts, categories and tags; launch and sale events                                                                                               |
| Search           | Search words and Storefront settings › Search                                                                                                         |
| Header search    | Finds admin pages, Storefront settings tabs and Brand Kit sections from the header box; see [Admin Search](./search.md)                               |
| Settings         | Brand Kit (logo sets, link preview picture, profiles, store links, colours), Stores and Mailboxes                                                     |
| Inbox            | The shop's Gmail mailboxes, read and answered live; see [Inbox and Mailboxes](./inbox-and-mailboxes)                                                  |
| Theme colour     | Brand Kit › Admin theme colour sets `--theme-color`; every admin style reads it, so nothing types the theme hex                                       |
| Notifications    | Channel switches, usage and templates                                                                                                                 |
| Tables and forms | Shared search, pagination, selection, actions and permission-aware UI                                                                                 |

Other feature routes render from JSON data. See [Data sources](./state-and-data#data-sources).

## Feature families

The content shell lazy-loads: dashboard, account, role, admin user, customer, customer ledger, attribute, measurement, add-on template, tag, redirect, blog, event, page, tax, category, shipping, media, coupon, product, currency, points, settings, storefront settings, search words, order status, orders, inbox, theme options, home banners, reviews, FAQ, notifications, refunds, and questions and answers.

Most families have create and edit routes. Orders add details, create-order and checkout routes. Blog adds category and tag routes.

## Directory ownership

| Directory                     | Owns                                                | Should not own               |
| ----------------------------- | --------------------------------------------------- | ---------------------------- |
| `routes/`, `*.routes.ts`      | URL composition and lazy boundaries                 | Domain rules                 |
| `layout/`                     | Admin chrome and page shells                        | Feature CRUD logic           |
| `features/`                   | Operator workflows and presentation                 | Hard-coded transport         |
| `core/admin-*`, `core/media/` | Typed gateways to the API                           | Presentation                 |
| `data-access/queries/`        | Remote cache keys and read lifecycles               | Form-local state             |
| `data-access/services/`       | Typed transport methods                             | Authorization policy         |
| `core/state/`                 | Session, menu, settings, loader and cart state      | Copies of remote collections |
| `shared/ui/`                  | Tables, fields, upload controls, modals, pagination | Feature orchestration        |
| `shared/directives/`          | Reusable presentation behaviour                     | Access control               |

:::danger UI permissions are not authorization
Hiding an action improves usability but does not secure it. The API authenticates the actor and authorizes the resource and action on every request.
:::

## Theme colour

`app.ts` sets `--theme-color` on the page root from the Brand Kit's `adminThemeColor` (the last colour is kept in this browser so the next start paints in it), and Brand Kit previews a picked colour at once and restores the saved one if the page closes unsaved. Styles never type the theme's hex. They use the helpers in `public/assets/scss/utils/_theme-color.scss`:

| Helper            | Gives                                                          |
| ----------------- | -------------------------------------------------------------- |
| `tc($c)`          | `var(--theme-color)`                                           |
| `tc-alpha($c, n)` | The theme colour at `n` percent, through `color-mix()`         |
| `tc-shade($c, n)` | The theme colour `n` points lighter or darker, keeping its hue |

Charts read the colour at run time through `themeColor()` in `core/brand/theme-color.ts`. The SCSS `$primary-color` variable is kept only so old rules still compile.

## Before making an admin change

- Identify the feature route and its shell.
- Trace every displayed record to its query and service.
- Confirm whether the action is a real write or has no backend.
- Reuse shared table, form and upload components.
- Design writes around shared contracts, error recovery and auditability.

## Limitations

- Orders, product tags, coupons, pages, general settings and other families read JSON data.
- On the home page, only the chart's commission line reads JSON data. The other widgets, including Total Stores and Latest Blogs, read the API. See [Admin home page](./home-dashboard).
- Many list actions and form submissions in those families have no backend.
- The create-order flow uses a client cart and does not place an order.
