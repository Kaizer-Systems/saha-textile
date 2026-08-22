---
title: Local Development
description: Local setup checklist for the monorepo and developer portal.
search_keywords: 'mongo rs0 config.json env docker setup pnpm mongo:up check:naming replica set'
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-22'
source_of_truth:
    - package.json
    - pnpm-workspace.yaml
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - apps/api/.env.example
    - apps/developer-portal/.env.example
    - scripts/developer-portal-local-auth.mjs
    - scripts/serve-developer-portal-persistent.mjs
    - apps/storefront/public/config.example.json
    - .cursor/rules/mcp-tools.mdc
---

# Local development

## Repository commands

Use pnpm from the repository root.

```bash
pnpm install
pnpm turbo run lint typecheck test
```

`pnpm lint` runs repository-policy guards before package linting. `check:naming` enforces the brand law; `check:browser-auth` rejects browser tokens, bearer headers, browser session persistence and cross-audience gateway calls; `check:i18n-parity` keeps active translation keys aligned; `check:route-contracts` rejects unnamed controller-local request shapes and unstable operation identifiers; and `check:permission-registry` keeps declared permissions inside the canonical registry. Each script documents its narrow allow marker where a deliberate exception is valid. Run the root lint command before finishing any change.

## Environment and services

### API environment file

The real `.env` is gitignored; copy the template and fill it for local use:

```bash
cp apps/api/.env.example apps/api/.env
```

Local defaults target the Docker MongoDB replica set below, `console` notifications (no real sends), and CORS for the storefront (`:4200`), admin (`:4300`), and persistent developer portal (`127.0.0.1:3457` / `localhost:3457`) so approved Scalar Test Requests can reach the local API.

### Local MongoDB (Docker replica set)

The API requires a MongoDB 8.3 single-node replica set (`rs0`) — the same self-hosted Docker profile is used locally and in production (never Atlas). Docker Desktop must be running. From the repository root:

```bash
pnpm mongo:up       # start rs0 and wait until healthy (rs.initiate is idempotent)
pnpm mongo:status   # compose state + replica-set status
pnpm mongo:down     # stop (data volume kept)
pnpm mongo:wipe     # stop + DELETE the data volume (destructive)
```

A database created before 2026-08-02 still holds data under the Mongoose-default collection names (`authsessions`, `inventoryledgers`, and so on). Move it onto the ratified names once:

```bash
pnpm mongo:align-collections -- --dry-run   # report only; changes nothing
pnpm mongo:align-collections                # rename legacy collections onto ratified names
```

The migration is idempotent, so re-running it is safe; it refuses to merge when both the legacy and ratified collection hold data, and it is deliberately not run at application boot.

The canonical host URI is `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`. If a native `mongod` already owns port `27017`, set `MONGO_HOST_PORT` in a gitignored `docker/mongo/.env` and mirror it in `apps/api/.env` (`MONGODB_PORT`) — only the host-side port moves; the `rs0` name and URI shape stay identical.

### Angular runtime config

The storefront and admin apps load `public/config.json` at boot (via an app initializer) rather than baking URLs into the build. The file is committed with localhost defaults; copy from `config.example.json` when customizing. Secrets never reach the browser — the Angular apps receive only this public config, while the API receives secrets via its env file.

## Developer portal commands

Create the gitignored local credential file before starting the complete portal; the example has
no default values and startup fails closed when either entry is absent:

```bash
cp apps/developer-portal/.env.example apps/developer-portal/.env.local
```

Set `DEVELOPER_PORTAL_LOCAL_USERNAME` and `DEVELOPER_PORTAL_LOCAL_PASSWORD` in that file, then run:

```bash
pnpm portal:persistent
```

The persistent server accepts loopback hosts only. Identity Loom protects Docusaurus, every
generated child, assets, OpenAPI/catalogue output, build metadata, and reload events with an
in-memory session. Credentials are stripped from child-build environments. Locking the portal,
closing the browser session, or restarting the server requires authentication again. This is not
the unresolved hosted private-access design and does not use the Saha Textile API or MongoDB.

Use the package commands below for isolated Docusaurus authoring/build checks; they do not compose
or serve the authenticated four-child umbrella:

```bash
pnpm --filter @saha-textile/developer-portal dev
pnpm --filter @saha-textile/developer-portal validate
pnpm --filter @saha-textile/developer-portal build
```

The production build runs the content validator first. Validation checks required provenance metadata and the portal terminology boundary before Docusaurus compiles pages.

## Local MCP phase

For application work through Phase 7, use the LOCAL MCP phase described in `.cursor/rules/mcp-tools.mdc`.

The expected local tool set is:

- Context7 for version-pinned library documentation.
- MongoDB MCP against the local development database.
- Postman MCP for workspace and collection maintenance.

GitHub and DigitalOcean tooling stay inactive until the later E2E and deployment phases.
