---
title: Generated Surfaces and Persistent Portal Runtime
description: How Storybook, TypeDoc, Scalar and the database catalogue are built and served.
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
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

The developer portal combines Docusaurus with four generated references. Docusaurus provides navigation, guides, search and the shared theme. Each generated tool keeps the renderer that suits its source, and is published under the same host.

## Surface ownership

| Bridge route                | Generated mount        | Tool                      |
| --------------------------- | ---------------------- | ------------------------- |
| `/tools/storybook`          | `/storybook/`          | Angular Storybook         |
| `/tools/typedoc`            | `/typedoc/`            | TypeDoc                   |
| `/tools/scalar`             | `/api/reference/`      | Scalar                    |
| `/tools/database-catalogue` | `/database/catalogue/` | Mongo catalogue generator |
| None                        | `/api/openapi.json`    | OpenAPI build             |

Every tool has a Docusaurus bridge page. The Tools menu opens that page, and its launch button opens the generated site. The server redirects child roots to slash-terminated roots, so relative assets resolve correctly.

## One Storybook, three top-level contexts

There is one Storybook application with three contexts:

```text
Storefront/
Admin/
Shared/
```

Storybook uses `@storybook/angular`, so it compiles real Angular templates, dependency injection, inputs, outputs and providers. Each story declares `parameters.application` as `storefront`, `admin` or `shared`, and a dispatcher selects the matching decorator.

Application style bundles are compiled separately and enabled one at a time, so storefront and admin global styles do not collide. Component styles travel with their components.

## Shared theme

`apps/developer-portal/src/css/nextgen-theme.css` is the source for portal colors, typography, spacing, radii, borders, focus treatment and light and dark behaviour.

- Docusaurus imports it first.
- Storybook imports it into its manager and preview. The selected application stylesheet still owns application UI.
- TypeDoc composes it during generation.
- Scalar imports it and maps its theme variables.
- The database catalogue copies it during its build.

Tool-specific selectors stay in tool adapters. Do not copy token values into them.

## Storybook coverage

Stories render real Angular classes. An automated gate scans every Angular component and runs before Storybook development, type checks, lint and builds:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook check:coverage
```

It fails when a new reusable component is neither imported by a story nor classified as integration-only. Route shells and pages that only coordinate navigation or server state belong in integration and Playwright tests. A feature component gets a story when it has a meaningful visual state on its own.

Deterministic state and query shims supply data without live services. Shared preview providers supply routing, translations, NgRx state, TanStack Query, ng-bootstrap, HTTP data, currency formatting and no-op animations.

Loading stories are deliberately permanent, because they show the loading UI itself. They sit under **Feedback** or **Skeletons**, and their names say they are placeholders.

## Local commands

Install the workspace packages once:

```bash
corepack pnpm install
```

The complete portal requires local credentials. Copy the empty example into the gitignored file and choose values:

```bash
cp apps/developer-portal/.env.example apps/developer-portal/.env.local
```

```text
DEVELOPER_PORTAL_LOCAL_USERNAME=...
DEVELOPER_PORTAL_LOCAL_PASSWORD=...
```

These values belong only to the portal server. It removes them from every child build environment, and they must never enter a generated asset.

Run only Docusaurus:

```bash
corepack pnpm --filter @saha-textile/developer-portal dev
```

Build Storybook directly:

```bash
corepack pnpm --filter @saha-textile/developer-portal-storybook build
```

Run the Storybook development server:

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

Generate the MongoDB catalogue directly:

```bash
corepack pnpm --filter @saha-textile/adapters-db-mongo generate:catalogue -- --output ./catalogue-dist
```

Run the complete portal:

```bash
corepack pnpm portal:persistent
```

Change its local port:

```bash
corepack pnpm portal:persistent -- --port 3457
```

Running Docusaurus alone does not start or build the generated tools.

Test Request needs the API running at the server named in the document, and it follows the normal authentication, CSRF, CORS, authorization, ownership and rate-limit rules. See [Using Test Request](/api/openapi-and-scalar#using-test-request).

## Persistent build behaviour

`portal:persistent`:

1. Refuses to start without both local credentials, and refuses non-loopback addresses.
2. Keeps credentials in the server process and creates an in-memory session.
3. Validates portal sources.
4. Prepares the shared TypeDoc theme and Storybook styles.
5. Builds Storybook and TypeDoc.
6. Builds the API and generates OpenAPI without MongoDB.
7. Builds Scalar.
8. Generates the MongoDB catalogue without database access.
9. Builds Docusaurus.
10. Checks that every surface produced an entry page.
11. Copies generated output into one tree.
12. Promotes the complete build atomically.
13. Serves only the sign-in screen and its assets before authentication.
14. Protects everything else behind one local session.
15. Sends signed-in tabs a reload event and watches sources for the next change.

While a new build runs, the server keeps serving the last good build. A failed build is logged and does not replace it. Before the first successful build, the server shows a 503 page that distinguishes a build in progress from a failed build.

A successful sign-in creates a random in-memory session and sets the session-only `st_developer_portal_session` cookie as `HttpOnly` and `SameSite=Strict`. Wrong credentials return one generic refusal. Restarting the server ends every session. Same-origin checks and a small body limit protect the sign-in and sign-out requests.

## Limitations

- The local server is for one user on one machine. It has no user store and no connection to the Saha Textile API.
- Scalar and the database catalogue carry the **Scaffolded** status. See [OpenAPI and Scalar](/api/openapi-and-scalar#limitations) and [Transactions and generated catalogue](/database/transactions-and-generation#limitations).
- A sandbox that blocks local listening can make Storybook report `expected options to have a port`, even though its configuration is valid.
