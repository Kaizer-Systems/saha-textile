---
title: Generated Surfaces and Persistent Portal Runtime
description: Storybook, TypeDoc, Scalar, database-catalogue, shared-theme, and atomic local serving topology.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - apps/developer-portal
    - apps/developer-portal-storybook
    - apps/developer-portal-typedoc
    - scripts/serve-developer-portal-persistent.mjs
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/pending-decisions.mdx
---

# Generated surfaces and persistent portal runtime

Docusaurus remains the navigation, narrative, governance, search, and deployment umbrella. Child tools keep the renderer that understands their source material and are published beneath the same protected host.

## Surface ownership

| Route                 | Owner                          | Source                                                              | Current implementation state                                                   |
| --------------------- | ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `/`                   | Docusaurus                     | `docs/**`, including canonical Engineering Live Context MDX         | Built                                                                          |
| `/storybook/`         | One Angular Storybook renderer | Storefront, admin, and shared stories                               | Built and browser-verified in the composite runtime                            |
| `/typedoc/`           | TypeDoc                        | Exported contracts and core-domain symbols                          | Built and browser-verified in the composite runtime                            |
| `/api/reference`      | Scalar                         | Verified generated OpenAPI                                          | Gated; Test Request is required when the OpenAPI/security trigger is satisfied |
| `/api/openapi.json`   | OpenAPI artifact pipeline      | Nest controllers plus shared contracts                              | Gated on deterministic complete generation                                     |
| `/database/catalogue` | Database catalogue generator   | Mongo models, indexes, mappings, migrations, and synthetic examples | Gated on schema/generator stability                                            |

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

## Shared next-generation theme

`apps/developer-portal/src/css/nextgen-theme.css` is the portable source of truth for portal colors, typography, spacing primitives, radii, borders, focus treatment, and light/dark canvas behavior.

- Docusaurus imports it before its own layout adapter.
- Storybook imports it directly and layers its preview adapter plus the selected application stylesheet.
- TypeDoc composes it with a TypeDoc-only adapter during generation.
- Scalar must map its supported theme variables/options to these tokens when the Scalar gate opens.
- Generated database pages are ordinary Docusaurus pages and inherit the same source automatically.

Tool-specific selectors remain in tool adapters. Shared token values must not be copied into those adapters.

## Local commands

Install the pinned workspace packages once:

```bash
corepack pnpm install
```

No vendor account or manual desktop download is required for Docusaurus, Storybook, or TypeDoc. They are repository dependencies. Scalar will also be a repository dependency; Test Request targets still require an approved development/staging API and its normal authentication, CSRF, CORS, authorization, and rate-limit configuration.

Run only Docusaurus in development:

```bash
corepack pnpm --filter @saha-textile/developer-portal dev
```

Run Storybook directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook dev
```

Build TypeDoc directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-typedoc build
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
5. builds Docusaurus;
6. verifies that every enabled surface produced a non-empty entry page;
7. copies child outputs under the Docusaurus composite tree;
8. atomically promotes the verified candidate;
9. sends a reload event to connected browser tabs;
10. watches only declared portal and child-source scopes for the next change.

While a replacement builds, the server continues serving the last successful composite. A failed build is logged and never replaces the active portal. Before the first successful build, the server returns a temporary `503` build-in-progress page.

Running Docusaurus alone does **not** start or build Storybook and TypeDoc. Use their direct commands for isolated work or `portal:persistent` for the complete umbrella.

## Gated surfaces

Scalar and the database catalogue are deliberately not made “live” by a placeholder.

- Scalar opens only after the real OpenAPI contract passes the documented completeness, drift, environment, CORS/CSRF, and interaction-safety gates. Its Test Request capability is mandatory at that point.
- The database catalogue opens only after implemented Mongo schemas, indexes, mappings, migrations, and deterministic synthetic examples can be generated without production access.

The complete deployment—including Docusaurus HTML, JavaScript/CSS, search data, Engineering Live Context, Storybook, TypeDoc, Scalar, OpenAPI, and database catalogue assets—remains blocked on verified whole-host default-deny private access. `noindex` is not access control.
