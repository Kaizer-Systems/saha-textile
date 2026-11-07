---
title: Local Development
description: Local setup checklist for the monorepo and developer portal.
search_keywords: 'mongo rs0 config.json env docker setup pnpm mongo:up check:naming replica set'
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - package.json
    - pnpm-workspace.yaml
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - apps/api/src/reset-local-customer.ts
    - apps/api/src/set-local-test-credentials.ts
    - apps/api/src/seed-local-auth-accounts.ts
    - apps/api/src/seed-local-catalog-photos.ts
    - apps/api/src/worker.ts
    - apps/api/.env.example
    - apps/developer-portal/.env.example
    - scripts/developer-portal-local-auth.mjs
    - scripts/serve-developer-portal-persistent.mjs
    - apps/storefront/public/config.example.json
---

# Local development

This page explains how to set up and run the Saha Textile monorepo on a developer machine. You need Node 24, pnpm and Docker Desktop.

## Repository commands

Use pnpm from the repository root.

```bash
pnpm install
pnpm turbo run lint typecheck test
```

`pnpm lint` runs the repository guards before package linting:

| Guard                       | What it rejects                                                               |
| --------------------------- | ----------------------------------------------------------------------------- |
| `check:naming`              | Identifiers and text that use the brand name in shortened form                |
| `check:account-naming`      | Customer and operator naming mix-ups                                          |
| `check:browser-auth`        | Browser tokens, bearer headers, browser session storage, cross-audience calls |
| `check:i18n-parity`         | Translation keys missing from a locale file                                   |
| `check:route-contracts`     | Unnamed controller-local request shapes and unstable operation identifiers    |
| `check:route-authorization` | Admin routes without a declared permission                                    |
| `check:permission-registry` | Permission codes outside the registry                                         |

Each script documents its allow marker for deliberate exceptions. Run the root lint command before you finish a change.

## Other commands

| Command                                                                                                      | What it does                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev:storefront`, `pnpm dev:admin`                                                                      | Start one app with hot reload                           |
| `pnpm start:storefront`, `pnpm start:admin`                                                                  | Serve one app's production build                        |
| `pnpm format:check`                                                                                          | Check formatting without changing files                 |
| `pnpm check:account-naming`, `pnpm check:route-authorization`                                                | Run one repository guard (both also run in `pnpm lint`) |
| `pnpm e2e`                                                                                                   | Run the Playwright suite against a running shop         |
| `pnpm e2e:session-rotation`                                                                                  | Run the session rotation end-to-end suite               |
| `pnpm stack:status`, `pnpm stack:logs`, `pnpm stack:down`                                                    | Inspect or stop the full local stack                    |
| `pnpm redis:down`                                                                                            | Stop local Redis                                        |
| `pnpm auth:set-local-credentials`                                                                            | Set local test credentials                              |
| `pnpm mongo:reconcile-indexes`                                                                               | Bring database indexes in line with the models          |
| `pnpm mongo:split-admin-users`, `pnpm mongo:rename-admin-user-permissions`, `pnpm mongo:extract-credentials` | One-off data migrations                                 |

## Environment and services

### API environment file

The real `.env` is gitignored; copy the template and fill it for local use:

```bash
cp apps/api/.env.example apps/api/.env
```

Local defaults target the Docker MongoDB replica set below, `console` notifications (no real sends), and CORS for the storefront (`:4200`), admin (`:4300`), and persistent developer portal (`127.0.0.1:3457` / `localhost:3457`) so approved Scalar Test Requests can reach the local API.

### Local MongoDB (Docker replica set)

The API requires a MongoDB 9.0.4 single-node replica set named `rs0`. Local and deployed environments use the same self-hosted Docker profile. Docker Desktop must be running. From the repository root:

```bash
pnpm mongo:up       # start rs0 and wait until healthy (rs.initiate is idempotent)
pnpm mongo:status   # compose state + replica-set status
pnpm mongo:down     # stop (data volume kept)
pnpm mongo:wipe     # stop + DELETE the data volume (destructive)
```

An older local database can hold data under Mongoose-default collection names such as `authsessions` and `inventoryledgers`. Move it to the declared names once:

```bash
pnpm mongo:align-collections -- --dry-run   # report only; changes nothing
pnpm mongo:align-collections                # rename legacy collections to the declared names
```

The migration is idempotent. It refuses to merge when both the legacy and declared collections hold data, and it does not run at application startup.

The host URI is `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`. If a native `mongod` already owns port `27017`, set `MONGO_HOST_PORT` in a gitignored `docker/mongo/.env` and mirror it in `apps/api/.env` (`MONGODB_PORT`) — only the host-side port changes.

### Angular runtime config

The storefront and admin applications load `public/config.json` at startup. The committed file holds localhost defaults; copy `config.example.json` to customize it. This file is public, so it holds no secrets.

### Local identity testing

With the `console` notification provider no message leaves your machine, so you can fix the one-time code. Set `OTP_LOCAL_FIXED_CODE=123456` in `apps/api/.env`, and every signup, one-time-code login, step-up and contact-change code takes that value. Only generation changes: the code is still hashed, single-use, attempt-capped and short-lived. The API refuses to start with this setting under `NODE_ENV=production` or with any provider other than `console`.

Three local-only tools keep accounts testable; each refuses to run without `--i-am-local`, under `NODE_ENV=production`, or against a non-loopback MongoDB:

```bash
pnpm --filter @saha-textile/api seed:local-auth-accounts -- --i-am-local
pnpm --filter @saha-textile/api reset:local-customer -- --i-am-local --email you@example.com
pnpm --filter @saha-textile/api set:local-credentials -- --i-am-local --audience admin --email you@example.com
```

`seed:local-auth-accounts` writes one account per sign-in shape. `reset:local-customer` returns a real Google or Facebook account to "never signed up" (soft delete plus unlinking its identities) between test rounds. `set:local-credentials` sets a known password, and for admins optionally a PIN, using the API's own argon2 hasher.

Social sign-in needs real provider accounts and a browser that allows the provider popups. Automated browser panes usually block these popups, so test provider flows in an ordinary Chrome window. The storefront's server-side rendering calls the API over the local TLS certificate. Start it with `NODE_OPTIONS=--use-system-ca` so Node trusts the mkcert authority that `pnpm setup:local-https` installed.

### Local catalogue and search

Load the demo catalogue into your local database:

```bash
pnpm --filter @saha-textile/adapters-db-mongo seed:demo-catalogue
```

Storefront search needs Meilisearch. Set `MEILISEARCH_HOST` and `MEILISEARCH_API_KEY` in `apps/api/.env`, then build the index:

```bash
pnpm --filter @saha-textile/api search:rebuild
```

Without Meilisearch the API starts normally and search answers 503. The [local stack](/deployment/overview#images-and-the-local-production-shaped-stack) includes a Meilisearch container.

### Local media and demo photos

Image uploads use Redis, the media worker and the development Spaces bucket, even locally. Start Redis with `pnpm redis:up`, and start the worker with `pnpm --filter @saha-textile/api worker:dev` beside the API.

The storefront's JSON-backed rows (cart, wishlist, compare, orders) show placeholder images. To replace them with real photos, put 3:4 JPEGs through the pipeline:

```bash
pnpm --filter @saha-textile/api seed:local-catalog-photos -- --i-am-local ~/photos/a.jpg ~/photos/b.jpg
```

On macOS, convert a phone HEIC first with `sips -s format jpeg photo.heic --out photo.jpg`. The tool uploads each photo as an admin upload would, waits for the worker, then rewrites the demo JSON. Photos do not enter Git; only their CDN URLs do. `--assets=med_…,med_…` reuses uploaded photos, and `--clean` removes them and restores the placeholder. The tool refuses to run without `--i-am-local`, under `NODE_ENV=production`, against a non-loopback MongoDB, or against a database whose name does not end in `_local`.

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

The persistent server accepts loopback connections only. Its sign-in screen protects Docusaurus, every generated child site, assets, the OpenAPI and catalogue output, and reload events with an in-memory session. Credentials are removed from child build environments. Locking the portal, closing the browser session or restarting the server requires a new sign-in. This sign-in is independent of the Saha Textile API and MongoDB.

Use the package commands below for Docusaurus authoring and build checks. They do not build or serve the generated child sites:

```bash
pnpm --filter @saha-textile/developer-portal dev
pnpm --filter @saha-textile/developer-portal validate
pnpm --filter @saha-textile/developer-portal build
```

The production build runs the content validator first. The validator checks page metadata, source paths, links and wording before Docusaurus compiles pages.
