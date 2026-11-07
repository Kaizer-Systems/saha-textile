---
title: Storefront Orientation
wide: true
description: What the storefront is, how it is organized, and what to check before changing it.
status: scaffolded
audience: [beginner, frontend]
last_verified: '2026-11-07'
source_of_truth:
    - apps/storefront/src/app
    - apps/storefront/vite.config.ts
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Storefront orientation

The storefront is the public Saha Textile shop. It is an Angular 22 application hosted by AnalogJS and rendered on the server by Nitro. Routes are file-based, under `apps/storefront/src/app/pages`.

## Recommended reading sequence

1. [Application atlas](./application-atlas): see what exists and which parts are complete.
2. [Routing and rendering](./routing-and-rendering): how a URL becomes a rendered page.
3. [State and data ownership](./state-and-data): choose between TanStack Query, SignalStore, classic NgRx and local signals.
4. [Contributor recipes](./contributor-recipes): step-by-step checklists.

## Mental model

```mermaid
flowchart LR
    Browser["Browser or crawler"] --> Nitro["AnalogJS / Nitro node server"]
    Nitro --> Page["File-based page route"]
    Page --> Feature["Feature composition"]
    Feature --> Query["TanStack query or NgRx selector"]
    Query --> Service["Typed data-access service"]
    Service --> Source{"Data source"}
    Source --> API["Saha Textile API"]
    Source --> JSON["Static JSON files in public/assets/data"]
```

The page layer stays thin. A route identifies the customer journey and composes a feature. The feature owns presentation and interaction. Query and store layers own asynchronous or shared state. Services own transport.

## Capabilities

| Capability     | How it works                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Routing        | About 40 page files, including dynamic slug and catch-all routes                                                                       |
| Rendering      | Dynamic server rendering through Nitro. Nothing is prerendered                                                                         |
| Locale URLs    | Every page is served under `/en/` or `/fr/`. The router base carries the locale                                                        |
| Catalogue      | Home, category pages, cards, product pages and redirects read `/catalog/*`                                                             |
| Search         | The search box calls `/catalog/search` and reports when search is unavailable                                                          |
| First paint    | The header menu renders on the server; product pages show a skeleton while loading                                                     |
| Purchase popup | `/catalog/recent-purchases` shows real sales from the last day, and stays hidden without any                                           |
| Product media  | Cards and the gallery use `ResolvedImage` with `srcset`, and banners use `<picture>`                                                   |
| Cart           | Classic NgRx state with browser persistence                                                                                            |
| Authentication | Verified signup, email or phone sign-in, social sign-in, recovery and guarded account routes                                           |
| Account        | Profile, addresses, sign-in methods, sessions and contact changes use the API                                                          |
| Stock alerts   | **Notify me** on a sold-out variant, with replay after sign-in                                                                         |
| Newsletter     | The popup opens on half-page scroll, after 30 seconds or on desktop exit intent, and never on cart, checkout, account or sign-in pages |
| SEO            | Canonical and `hreflang` tags, `/sitemap.xml`, `/robots.txt`, redirects and `410` answers                                              |

## Directory ownership

| Directory                | Owns                                                | Should not own                   |
| ------------------------ | --------------------------------------------------- | -------------------------------- |
| `pages/`                 | URL entry points, route metadata, composition       | Business logic or transport code |
| `features/`              | Customer journeys and feature presentation          | Raw HTTP construction            |
| `data-access/queries/`   | Server-state keys, caching and invalidation         | Reusable visual components       |
| `data-access/services/`  | HTTP calls and response typing                      | Cross-page UI state              |
| `core/catalog/`          | Mapping API catalogue responses to view models      | Page presentation                |
| `core/state/`            | Application-wide client state and effects           | Copies of remote data            |
| `layout/`                | Header, footer and page shells                      | Catalogue or checkout rules      |
| `shared/ui/`             | Reusable presentational components                  | Feature-specific orchestration   |
| `shared/util/`           | Pure helpers                                        | Angular component state          |
| `src/server/middleware/` | Locale redirects, old addresses, sitemap and robots | Page rendering                   |

## Before making a storefront change

- Identify the URL or feature that owns the behaviour.
- Check whether the data is server-owned, browser-owned or component-local.
- Check whether the service reads the API or a JSON file.
- Keep server rendering safe: browser globals need a platform guard.
- Validate external data at the boundary.
- Add tests and update the portal in the same change.

## Limitations

- The cart is client-side. It does not call the cart API, and its totals are not authoritative.
- Checkout renders forms and totals but does not place an order or take a payment.
- Order history, refunds, wallet, points, notifications, wishlist and compare read JSON files or client state.
- The newsletter form has no subscribe endpoint.
- Offline catalogue and cart support is planned. The PWA integration is not in the build.

:::warning A finished-looking screen may not be connected
A polished screen can be JSON-backed or have no write path. Check the [state and data page](./state-and-data#data-sources) before you depend on it.
:::
