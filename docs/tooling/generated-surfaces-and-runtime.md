---
title: Generated Surfaces and Persistent Portal Runtime
description: Storybook, TypeDoc, Scalar, database-catalogue, shared-theme, and atomic local serving topology.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-26'
source_of_truth:
    - apps/developer-portal
    - apps/developer-portal-storybook
    - apps/developer-portal-typedoc
    - apps/developer-portal-scalar
    - apps/api/src/generate-openapi.ts
    - packages/adapters-db-mongo/scripts/generate-catalogue.ts
    - scripts/serve-developer-portal-persistent.mjs
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# Generated surfaces and persistent portal runtime

Docusaurus remains the navigation, narrative, governance, search, and deployment umbrella. Child tools keep the renderer that understands their source material and are published beneath the same protected host.

## Surface ownership

| Bridge route                | Generated mount        | Owner                          | Current implementation state                                                 |
| --------------------------- | ---------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `/tools/storybook`          | `/storybook/`          | One Angular Storybook renderer | Built; Component Forge gateway                                               |
| `/tools/typedoc`            | `/typedoc/`            | TypeDoc                        | Built; Type Lattice gateway                                                  |
| `/tools/scalar`             | `/api/reference/`      | Scalar                         | Scaffolded current OpenAPI; Request Wormhole gateway; Test Request available |
| `/tools/database-catalogue` | `/database/catalogue/` | Mongo catalogue generator      | Scaffolded seven-model current evidence; Schema Observatory gateway          |
| n/a                         | `/api/openapi.json`    | OpenAPI artifact pipeline      | Scaffolded deterministic source-generated document                           |

Storybook is not a React-only or view-only substitute. The selected `@storybook/angular` renderer compiles Angular templates, dependency injection, inputs/outputs, change detection, directives, and application providers. A React renderer cannot directly render Angular components as React components.

## One Storybook, three top-level contexts

There is one Storybook application, not separate admin and storefront deployments:

```text
Storefront/
Admin/
Shared/
```

Each story declares `parameters.application` as `storefront`, `admin`, or `shared`. A global dispatcher selects the matching per-application decorator.

The application style bundles are generated separately and enabled one at a time in the preview document. This avoids allowing storefront and admin global selectors to collide while keeping both applications in one renderer. Component-local Angular styles continue to travel with their components.

Every tool has a unique Docusaurus bridge route. The Tools menu always enters through that bridge; only its animated launch button performs the full-document handoff to the generated mount. The composite server permanently redirects extensionless child roots to slash-terminated roots while preserving query strings, so relative child assets resolve under the correct mount.

## Shared next-generation theme

`apps/developer-portal/src/css/nextgen-theme.css` is the portable source of truth for portal colors, typography, spacing primitives, radii, borders, focus treatment, and light/dark canvas behavior.

- Docusaurus imports it before its own layout adapter.
- Storybook imports it into both its manager and Angular preview. Its adapters add a live constellation, scan veil, cursor-follow glow, glass depth, context HUD, and reduced-motion behavior; the selected application stylesheet still owns application UI.
- TypeDoc composes it with a Type Lattice adapter during generation: constellation, scan veil, glass navigation/panels, glow/focus, and OS-aware light/dark tokens.
- Scalar imports it directly and maps Scalar’s public theme variables through a Request Wormhole adapter.
- The generated MongoDB Schema Observatory copies the same theme contract during its source-only build and adds only catalogue layout selectors.

Tool-specific selectors remain in tool adapters. Shared token values must not be copied into those adapters.

## Story coverage policy and staged expansion

Storybook renders real Angular classes; it does not reproduce application components with Storybook-only HTML.

The first expanded pass includes the real Storefront empty state, full-page loader, section title, and horizontal/vertical product-card skeleton states; the real Admin product and sidebar skeleton states; plus Shared Component Forge and theme-contract specimens. Every preview selects exactly one application stylesheet and the shared interaction adapter.

Loading specimens are intentionally persistent because they represent the loading UI itself. They are now grouped under **Feedback** or **Skeletons**, their story names state that they are placeholders, and their Docs descriptions explicitly say Storybook is not awaiting data. A perpetual spinner in the Full-page Loader story is therefore expected component behavior; a spinner on an unrelated story is a rendering fault.

Coverage expands in small passes:

1. **Foundation and feedback:** dependency-light reusable UI, loading, empty, typography, focus, and translated states.
2. **Commerce configuration:** product boxes, option swatches, variants, bundles, measurements, cart-line configuration, and useful stock/error combinations using deterministic product fixtures.
3. **Admin operations:** buttons, alerts, pagination, dropdowns, tables, media, permission states, modals, and form validation using explicit store/query/service fixtures.
4. **Application composition:** headers, footers, navigation, and bounded feature panels only after runtime configuration, router, i18n, and query providers can be represented honestly.

Route shells and pages that only coordinate navigation or live server state are not useful isolated component stories. Their behavior belongs in application integration and Playwright coverage. A feature component receives a story when it exposes a meaningful visual or interactive state in isolation.

The remaining coverage is deliberately pending rather than represented by empty stories. Current constraints are:

- both applications use the same compile-time aliases (`@core`, `@shared`, `@data-access`, and `@layout`) for different roots, so the single renderer needs an issuer-aware resolution seam before importing both dependency graphs;
- store/query/router/runtime-config/Transloco/modal dependencies need deterministic application-specific fixtures;
- legacy components that do not pass the Storybook workspace's strict TypeScript boundary need source typing corrections rather than weaker Storybook checks; and
- application assets need an isolated mount strategy so identical `assets/**` URLs cannot collide between Storefront and Admin.

Each pass must add useful states, verify both portal themes and the correct application stylesheet, and update this section. Do not declare broad coverage complete from a generated filename inventory alone.

## Local commands

Install the pinned workspace packages once:

```bash
corepack pnpm install
```

No vendor account or manual desktop download is required. Docusaurus, Storybook, TypeDoc, Scalar, and the Mongo generator are pinned repository dependencies or source tooling. Test Request still requires the API to be running at an approved document server and obeys its normal authentication, CSRF, CORS, authorization, and rate-limit configuration.

Run only Docusaurus in development:

```bash
corepack pnpm --filter @saha-textile/developer-portal dev
```

Build Storybook directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook build
```

Build TypeDoc directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-typedoc build
```

Build Scalar directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-scalar build
```

Generate the current MongoDB catalogue directly:

```bash
corepack pnpm --filter @saha-textile/adapters-db-mongo generate:catalogue -- --output ./catalogue-dist
```

Run the complete persistent portal:

```bash
corepack pnpm portal:persistent
```

Override its local port when necessary:

```bash
corepack pnpm portal:persistent -- --port 3457
```

## Persistent build behavior

`portal:persistent`:

1. binds to `127.0.0.1` by default;
2. validates portal sources;
3. composes the shared TypeDoc theme and isolated Storybook application styles;
4. builds Storybook and TypeDoc;
5. builds the API and source-generates the scaffolded OpenAPI artifact without MongoDB;
6. builds Scalar with Test Request available;
7. source-generates the seven-model MongoDB catalogue without database access;
8. builds Docusaurus;
9. verifies that every enabled surface produced a non-empty entry page;
10. copies child outputs under the Docusaurus composite tree;
11. atomically promotes the complete verified candidate;
12. sends a reload event to connected browser tabs;
13. watches only declared portal and child-source scopes for the next change.

While a replacement builds, the server continues serving the last successful composite. A failed build is logged and never replaces the active portal. Before the first successful build, the server returns a temporary `503` build-in-progress page.

Running Docusaurus alone does **not** start or build the child tools. Use their direct commands for isolated work or `portal:persistent` for the complete umbrella.

The production Storybook build and composite runtime are verified. The isolated `developer-portal-storybook dev` command remains pending: pinned Storybook 10.3.2 currently exits from both its Angular builder and CLI with `expected options to have a port`, even when the declared/CLI port is present. Do not weaken or replace the verified production build path to conceal that upstream/tooling incompatibility; resolve and verify the direct-development command in a focused tooling pass.

## Scaffold limitations and promotion gates

Scalar and the MongoDB catalogue are live as visibly scaffolded current-evidence surfaces:

- Scalar must remain scaffolded until the real OpenAPI contract passes the documented completeness, drift, environment, CORS/CSRF, and interaction-safety gates.
- The MongoDB catalogue must remain scaffolded while implemented schemas contain temporary shapes and stable mappings, migrations, retention, transactions, and nested validators are absent.

The complete deployment—including Docusaurus HTML, JavaScript/CSS, search data, Engineering Live Context, Storybook, TypeDoc, Scalar, OpenAPI, and database catalogue assets—remains blocked on verified whole-host default-deny private access. `noindex` is not access control.
