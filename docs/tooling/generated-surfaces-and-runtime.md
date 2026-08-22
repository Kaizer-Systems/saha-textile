---
title: Generated Surfaces and Persistent Portal Runtime
description: Storybook, TypeDoc, Scalar, database-catalogue, shared-theme, and atomic local serving topology.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-22'
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
| `/tools/database-catalogue` | `/database/catalogue/` | Mongo catalogue generator      | Scaffolded 40-model current evidence; Schema Observatory gateway             |
| n/a                         | `/api/openapi.json`    | OpenAPI artifact pipeline      | Scaffolded deterministic 96-path/113-operation document                      |

Storybook is not a React-only or view-only substitute. The selected `@storybook/angular` renderer compiles Angular templates, dependency injection, inputs/outputs, change detection, directives, and application providers. A React renderer cannot directly render Angular components as React components.

## One Storybook, three top-level contexts

There is one Storybook application, not separate admin and storefront deployments:

```text
Storefront/
Admin/
Shared/
```

Each story declares `parameters.application` as `storefront`, `admin`, or `shared`. A global dispatcher selects the matching per-application decorator.

The application style bundles are compiled separately through the pinned Sass CLI and enabled one at a time in the preview document. This avoids allowing storefront and admin global selectors to collide while keeping both applications in one renderer. Component-local Angular styles continue to travel with their components. Storybook's focused TypeScript gate uses `tsconfig.typecheck.json`, while its measured preview warning budget remains 5 MiB; Scalar's measured chunk warning budget remains 3500 kB rather than disabling warnings.

Every tool has a unique Docusaurus bridge route. The Tools menu always enters through that bridge; only its animated launch button performs the full-document handoff to the generated mount. The composite server permanently redirects extensionless child roots to slash-terminated roots while preserving query strings, so relative child assets resolve under the correct mount.

## Shared next-generation theme

`apps/developer-portal/src/css/nextgen-theme.css` is the portable source of truth for portal colors, typography, spacing primitives, radii, borders, focus treatment, and light/dark canvas behavior.

- Docusaurus imports it before its own layout adapter.
- Storybook imports it into both its manager and Angular preview. Its adapters add a live constellation, scan veil, cursor-follow glow, glass depth, context HUD, and reduced-motion behavior; the selected application stylesheet still owns application UI.
- TypeDoc composes it with a Type Lattice adapter during generation: constellation, scan veil, glass navigation/panels, glow/focus, and OS-aware light/dark tokens.
- Scalar imports it directly and maps Scalar’s public theme variables through a Request Wormhole adapter.
- The generated MongoDB Schema Observatory copies the same theme contract during its source-only build and adds only catalogue layout selectors.

Tool-specific selectors remain in tool adapters. Shared token values must not be copied into those adapters.

## Storybook coverage contract

Storybook renders real Angular classes; it does not reproduce application components with Storybook-only HTML.

The production catalogue contains story states across Storefront, Admin, and Shared, including Admin PIN Pad and idle-lock modal specimens. The automated coverage gate scans all 290 Angular components. Its current result is:

| Application | Reusable components accounted for | Application components reached directly by stories |
| ----------- | --------------------------------- | -------------------------------------------------- |
| Storefront  | 106 / 106                         | 107 / 156                                          |
| Admin       | 35 / 35                           | 35 / 134                                           |
| Combined    | 141 / 141                         | 142 / 290                                          |

Application components not directly reached are route/page orchestration; their navigation, resolver, live-service, and whole-application behavior belongs in integration and Playwright coverage.

The coverage gate runs before Storybook development, typechecking, linting, and production builds:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook check:coverage
```

It fails when a new reusable component is neither imported by a story nor explicitly classified as integration-only. This prevents the catalogue from silently drifting behind either Angular application.

Coverage includes:

- foundation controls, titles, icons, feedback, empty states, pagination, breadcrumbs, and skeletons;
- Storefront commerce configuration, product cards, collection/filter surfaces, header/footer primitives, home widgets, application surfaces, and the reusable product-detail system;
- Admin controls, forms, dropdowns, data/media surfaces, alerts, permission-aware links, pagination, cards, modal workflows, page wrappers, navigation, and application chrome; and
- Shared theme-contract, modal-workflow, social-sign-in states, and Component Forge overview states.

Every preview selects exactly one application stylesheet and the shared interaction adapter. Issuer-aware alias resolution keeps Storefront and Admin imports pointed at their own `@core`, `@data-access`, `@layout`, and `@shared` roots inside the single Angular renderer. Deterministic state/query shims provide catalogue, category, blog, notification, account, loader, menu, and settings data without reaching live services. Shared preview providers supply routing, translations, NgRx commerce states, TanStack Query, ng-bootstrap, HTTP fixtures, currency formatting, and no-op animations.

Loading specimens are intentionally persistent because they represent the loading UI itself. They are now grouped under **Feedback** or **Skeletons**, their story names state that they are placeholders, and their Docs descriptions explicitly say Storybook is not awaiting data. A perpetual spinner in the Full-page Loader story is therefore expected component behavior; a spinner on an unrelated story is a rendering fault.

Route shells and pages that only coordinate navigation or live server state are not useful isolated component stories. Their behavior belongs in application integration and Playwright coverage. A feature component receives a story when it exposes a meaningful visual or interactive state in isolation.

## Local commands

Install the pinned workspace packages once:

```bash
corepack pnpm install
```

No vendor account or manual desktop download is required. Docusaurus, Storybook, TypeDoc, Scalar, and the Mongo generator are pinned repository dependencies or source tooling. Test Request still requires the API to be running at an approved document server and obeys its normal authentication, CSRF, CORS, authorization, ownership, and rate-limit configuration. For a state-changing request with a session cookie, echo the readable CSRF cookie issued with login/OTP/refresh in `x-csrf-token`; `GET /auth/csrf` preserves a valid active-session token or atomically recovers a missing/desynchronized one.

The complete umbrella requires explicit local credentials. Copy the empty example into the gitignored portal-local file and choose values; no built-in pair exists:

```bash
cp apps/developer-portal/.env.example apps/developer-portal/.env.local
```

```text
DEVELOPER_PORTAL_LOCAL_USERNAME=...
DEVELOPER_PORTAL_LOCAL_PASSWORD=...
```

These values belong only to the native persistent server. It strips them from every Docusaurus, Storybook, TypeDoc, Scalar, API-build, and catalogue subprocess environment, and they must never enter a generated browser asset.

Run only Docusaurus in development:

```bash
corepack pnpm --filter @saha-textile/developer-portal dev
```

Build Storybook directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook build
```

Run the isolated Storybook development server:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook dev
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

1. fails closed unless both portal-local credentials are present and refuses every non-loopback bind address;
2. retains credentials only in the native process and creates an in-memory authentication/session boundary;
3. validates portal sources;
4. composes the shared TypeDoc theme and isolated Storybook application styles;
5. builds Storybook and warning-as-error TypeDoc;
6. builds the API and source-generates the scaffolded OpenAPI artifact without MongoDB;
7. builds Scalar with Test Request available;
8. source-generates the 40-model MongoDB catalogue without database access;
9. builds Docusaurus;
10. verifies that every enabled surface produced a non-empty entry page;
11. copies child outputs under the Docusaurus composite tree;
12. atomically promotes the complete verified candidate;
13. serves only the Identity Loom shell and allowlisted fonts/theme/logo before authentication;
14. protects Docusaurus, child tools, generated assets, metadata, reload events, OpenAPI and catalogue behind one local session;
15. sends authenticated tabs a reload event and watches only declared portal/child-source scopes for the next change.

While a replacement builds, the server continues serving the last successful composite. A failed build is logged and never replaces the active portal. Before any composite is promoted, the loopback 503 page distinguishes a first build in progress from a failed build with nothing to serve. After a promotion, rebuild failures keep the last known good composite instead of returning 503.

Successful authentication creates a cryptographically random, in-memory session and sets the session-only `st_developer_portal_session` cookie as `HttpOnly` and `SameSite=Strict`. Wrong credentials return one generic refusal and do not create a cookie. Restarting the server invalidates every session; closing the browser session discards its cookie. Same-origin Host/Origin checks and a small request-body limit protect the login/logout posts. Safe deep links survive the gate, and the command palette exposes replay and lock actions without adding permanent navigation clutter.

Identity Loom shares the portal token/font/logo system but owns its Canvas 2D fibre field and locally synthesized Web Audio. Username edits weave/recoil threads; password decoration uses only input operation and length, never credential content. Paste/autofill receives a bulk-ingestion sequence. Successful authentication holds a five-second arrival ceremony before the requested route; reduced motion receives a short handoff and the mute preference remains visible and persistent.

Running Docusaurus alone does **not** start or build the child tools. Use their direct commands for isolated work or `portal:persistent` for the complete umbrella.

The production Storybook build, standalone development server, and composite runtime are verified. A local execution environment must permit the declared loopback port to bind; a sandbox that denies local listening can surface Storybook's `expected options to have a port` fallback even though the repository configuration is valid.

## Scaffold limitations and promotion gates

Scalar and the MongoDB catalogue are live as visibly scaffolded current-evidence surfaces:

- Scalar must remain scaffolded until the real OpenAPI contract passes the documented completeness, drift, environment, CORS/CSRF, and interaction-safety gates.
- The MongoDB catalogue must remain scaffolded while implemented schemas contain temporary shapes and stable mappings, migrations, retention, workflow transaction participation, and nested validators are absent.

This local single-user boundary does not create a `devPortalUsers` collection, call the Saha Textile API, share commerce auth/session code, or provide remote hosting. The complete deployment—including Docusaurus HTML, JavaScript/CSS, search data, Engineering Live Context, Storybook, TypeDoc, Scalar, OpenAPI, and database catalogue assets—remains blocked on verified whole-host default-deny private access. `noindex` is not access control.
