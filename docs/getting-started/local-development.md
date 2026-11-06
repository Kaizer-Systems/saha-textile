---
title: Local Development
description: Local setup checklist for the monorepo and developer portal.
search_keywords: 'mongo rs0 config.json env docker setup pnpm mongo:up check:naming replica set'
status: scaffolded
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-06'
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

## Other commands

| Command                                                                                                      | What it does                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev:storefront`, `pnpm dev:admin`                                                                      | Start one app with hot reload                           |
| `pnpm start:storefront`, `pnpm start:admin`                                                                  | Serve one app's production build                        |
| `pnpm format:check`                                                                                          | Check formatting without changing files                 |
| `pnpm check:account-naming`, `pnpm check:route-authorization`                                                | Run one repository guard (both also run in `pnpm lint`) |
| `pnpm e2e:session-rotation`                                                                                  | Run the session rotation end-to-end suite               |
| `pnpm stack:status`, `pnpm stack:logs`, `pnpm stack:down`                                                    | Inspect or stop the full local stack                    |
| `pnpm redis:down`                                                                                            | Stop local Redis                                        |
| `pnpm auth:set-local-credentials`                                                                            | Set local test credentials                              |
| `pnpm mongo:reconcile-indexes`                                                                               | Bring database indexes in line with the models          |
| `pnpm mongo:split-admin-users`, `pnpm mongo:rename-admin-user-permissions`, `pnpm mongo:extract-credentials` | One-off data migrations, already run locally            |

## Environment and services

### API environment file

The real `.env` is gitignored; copy the template and fill it for local use:

```bash
cp apps/api/.env.example apps/api/.env
```

Local defaults target the Docker MongoDB replica set below, `console` notifications (no real sends), and CORS for the storefront (`:4200`), admin (`:4300`), and persistent developer portal (`127.0.0.1:3457` / `localhost:3457`) so approved Scalar Test Requests can reach the local API.

### Local MongoDB (Docker replica set)

The API requires a MongoDB 9.0.4 single-node replica set (`rs0`) — the same self-hosted Docker profile is used locally and in production (never Atlas). Docker Desktop must be running. From the repository root:

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

### Local identity testing

No notification provider is wired yet, so local one-time codes can be fixed: set `OTP_LOCAL_FIXED_CODE=123456` in `apps/api/.env` and every signup, one-time-code login, step-up and contact-change code is that value. Only generation changes — the code is still hashed, single-use, attempt-capped and short-lived — and the API refuses to start with it under `NODE_ENV=production` or any `NOTIFICATION_PROVIDER` other than `console`.

Three local-only tools keep accounts testable; each refuses to run without `--i-am-local`, under `NODE_ENV=production`, or against a non-loopback MongoDB:

```bash
pnpm --filter @saha-textile/api seed:local-auth-accounts -- --i-am-local
pnpm --filter @saha-textile/api reset:local-customer -- --i-am-local --email you@example.com
pnpm --filter @saha-textile/api set:local-credentials -- --i-am-local --audience admin --email you@example.com
```

`seed:local-auth-accounts` writes one account per sign-in shape. `reset:local-customer` returns a real Google or Facebook account to "never signed up" (soft delete plus unlinking its identities) between test rounds. `set:local-credentials` sets a known password, and for admins optionally a PIN, using the API's own argon2 hasher.

Social sign-in needs real provider accounts and a browser that allows the provider popups. The in-app browser pane refuses popups opened by automation, so drive provider flows in an ordinary Chrome window. The storefront's server-side rendering calls the API over the local TLS certificate; start it with `NODE_OPTIONS=--use-system-ca` (the `.claude/launch.json` entries already do) so Node trusts the mkcert authority `pnpm setup:local-https` installed.

### Local media and demo-catalogue photos

Image uploads run through Redis, the media worker and the dev Spaces bucket even locally. Start Redis with `pnpm redis:up` and the worker with `pnpm --filter @saha-textile/api worker:dev` next to the API. The storefront still reads the vendor demo catalogue under `apps/storefront/public/assets/data/`. To see real product photos in every product slot (cards, gallery and zoom, cart, wishlist, compare, orders), put 3:4 JPEGs through the pipeline:

```bash
pnpm --filter @saha-textile/api seed:local-catalog-photos -- --i-am-local ~/photos/a.jpg ~/photos/b.jpg
```

On macOS, convert a phone HEIC first with `sips -s format jpeg photo.heic --out photo.jpg`. The tool uploads each photo like an admin upload, waits for the worker, then rewrites the demo JSON so each product shows the same photo everywhere: cards and the gallery get srcset data, rows get the 300 px thumbnail. Photos never enter git; only their CDN URLs do. `--assets=med_…,med_…` re-dresses the data from photos already uploaded, and `--clean` purges them and restores the placeholder. Like the identity tools, it refuses to run without `--i-am-local`, under `NODE_ENV=production`, against a non-loopback MongoDB or a database whose name doesn't end in `_local`.

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
