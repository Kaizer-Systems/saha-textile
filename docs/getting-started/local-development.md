---
title: Local Development
description: Local setup checklist for the monorepo and developer portal.
search_keywords: 'mongo rs0 config.json env docker setup pnpm mongo:up check:naming replica set'
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - package.json
    - pnpm-workspace.yaml
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - apps/api/.env.example
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

`pnpm lint` also runs `pnpm check:naming` (`scripts/check-naming.sh`), which enforces the Saha Textile brand-naming law. Run it before finishing any change.

## Environment and services

### API environment file

The real `.env` is gitignored; copy the template and fill it for local use:

```bash
cp apps/api/.env.example apps/api/.env
```

Local defaults target the Docker MongoDB replica set below, `console` notifications (no real sends), and CORS for the storefront (`:4200`) and admin (`:4300`).

### Local MongoDB (Docker replica set)

The API requires a MongoDB 8.3 single-node replica set (`rs0`) — the same self-hosted Docker profile is used locally and in production (never Atlas). Docker Desktop must be running. From the repository root:

```bash
pnpm mongo:up       # start rs0 and wait until healthy (rs.initiate is idempotent)
pnpm mongo:status   # compose state + replica-set status
pnpm mongo:down     # stop (data volume kept)
pnpm mongo:wipe     # stop + DELETE the data volume (destructive)
```

The canonical host URI is `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`. If a native `mongod` already owns port `27017`, set `MONGO_HOST_PORT` in a gitignored `docker/mongo/.env` and mirror it in `apps/api/.env` (`MONGODB_PORT`) — only the host-side port moves; the `rs0` name and URI shape stay identical.

### Angular runtime config

The storefront and admin apps load `public/config.json` at boot (via an app initializer) rather than baking URLs into the build. The file is committed with localhost defaults; copy from `config.example.json` when customizing. Secrets never reach the browser — the Angular apps receive only this public config, while the API receives secrets via its env file.

## Developer portal commands

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
