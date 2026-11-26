---
title: Readiness, Observability, and Verification
wide: true
description: Health endpoints, logging, metrics, test layers and the backend definition of done.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-11-15'
source_of_truth:
    - apps/api/src/health
    - apps/api/src/infra/persistence.module.ts
    - apps/api/package.json
    - packages/contracts/test
    - packages/core-domain/test
    - packages/adapters-db-mongo/test
    - packages/adapters-db-mongo/vitest.config.mts
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
---

# Readiness, observability, and verification

This page describes the API's health endpoints, logging, metrics and test layers. A process that answers HTTP is live. A service that can perform its work is ready.

## Health endpoints

| Probe           | Question                           | Dependencies                         | Deployment action                    |
| --------------- | ---------------------------------- | ------------------------------------ | ------------------------------------ |
| `/health/live`  | Is the process running?            | None                                 | Restart only when failing            |
| `/health/ready` | Can this instance receive traffic? | MongoDB, Redis; search reported only | Remove from traffic, block promotion |
| `/health`       | Alias of `/health/live`            | None                                 | Prefer `/health/live`                |

A MongoDB or Redis outage does not stop the process. `/health/ready` returns `503` while it lasts, so an orchestrator does not restart healthy containers. A search outage shows in the reply but does not return `503`, because the shop lists from MongoDB without it. A deploy still waits for search to be up.

Health output never contains credentials, connection strings, network details, provider responses or stack traces.

## Request observability

Every request receives a correlation id, returned in the `x-request-id` header. The API accepts an inbound id only through a trusted proxy and only if it matches a strict pattern. Pino redacts authorization, cookie and CSRF headers, and password, PIN, code and token body fields.

Structured logs should answer:

- Which route or use case ran.
- Which actor type or audience was involved.
- The outcome and stable error category.
- Latency by application and adapter.
- The retry or idempotency result.
- Dependency health and timeout class.
- Safe resource and correlation identifiers.
- Whether an audit or outbox record was written.

Redact tokens, cookies, OTPs, passwords, raw IPs, provider secrets, payment payloads, full address and customer bodies, and sensitive query values.

## Recommended metrics

- Request rate, latency and errors by normalized route and status.
- Authentication success, failure and lockout, without identifiers.
- Rate-limit rejections by bucket.
- MongoDB pool, operation and transaction latency and failures.
- Search latency, errors and no-result rate.
- Notification usage and failures by channel and category.
- Job lag and last-success time.
- Readiness changes.

Avoid high-cardinality labels such as user id, order id, email, token, full URL or search query.

## Test layers

```mermaid
flowchart TD
    E2E["Few end-to-end journeys"] --> Integration["HTTP + real replica-set integration"]
    Integration --> Contract["Port, adapter, OpenAPI, contract tests"]
    Contract --> Unit["Many pure domain/application unit tests"]
```

| Layer              | Location                                  | Covers                                                                                                                              |
| ------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Unit               | `*.test.ts` and `*.spec.ts` beside source | Pure rules, services, stores, components, contracts                                                                                 |
| Integration        | `packages/adapters-db-mongo/test`         | Repositories, indexes and transactions against a replica set                                                                        |
| API end-to-end     | `apps/api/e2e`                            | Session rotation, media pipeline, banners, review photos, catalogue                                                                 |
| Browser end-to-end | `e2e`                                     | Playwright on desktop and phone: listings, product pages, sign-in, addresses, stock alerts, SEO; admin journeys including the Inbox |
| Portal             | `scripts/validate-developer-portal.mjs`   | Metadata, sources, links and interactive component data                                                                             |

Run them with:

```bash
pnpm test                 # all unit tests
RUN_DB_IT=1 pnpm test     # also run MongoDB integration tests
pnpm e2e                  # Playwright, against a running shop
pnpm e2e:session-rotation # session and security scenarios
```

Playwright uses the installed Chrome. Set `E2E_BASE_URL` to test a production build. Integration tests need the replica set: run `pnpm mongo:up` first.

The MongoDB integration tests share one replica set, so `packages/adapters-db-mongo/vitest.config.mts` runs at most four test files at once and gives setup hooks 30 seconds. A file that needs a database of its own connects with `connectMongo({ dbName, autoIndex: false })` and builds only the indexes it uses with `Model.syncIndexes()`. Building every model's indexes on a fresh database queues about 180 index builds, MongoDB runs three at a time, and the other files then time out in their setup hooks. A query that reads a whole collection belongs in such a file, or filters to its own records, because other files write to the shared test database at the same time.

The Playwright projects are `desktop` and `phone` for the shop, and `admin` for files matching `admin.spec.ts`. The `admin` project signs in once through `admin-setup` and reuses that session. `pnpm e2e:stack` builds the apps, seeds `saha_textile_e2e`, creates a throwaway administrator, runs the suite and stops everything. Pass `--keep` to leave the stack running, or a spec path and `--project` to run one file.

The stack's default addresses are the API on `https://localhost:4000`, the shop on `https://localhost:4200` and the admin on `https://localhost:4300`. `E2E_API_URL`, `E2E_BASE_URL` and `E2E_ADMIN_URL` point the tests at another copy, so a second stack (for example from a worktree) can run beside the local servers:

1. Build with `NODE_ENV=production pnpm build:product-apps`, and change the ports in the built `config.json` files (`apps/storefront/dist/analog/public`, `dist/client`, `dist/ssr` and `apps/admin/dist`). Change only the digits and keep each file the same length: the shop's server sends the length recorded at build time, and a longer file corrupts the next reply on a reused connection.
2. Seed `saha_textile_e2e` and create the test administrator as `pnpm e2e:stack` does.
3. Start the API with `PORT` and `CORS_ALLOWED_ORIGINS` for the new shop and admin origins, the shop with `PORT` and `SAHA_TEXTILE_PUBLIC_CONFIG`, `node e2e/stack/tls-proxy.mjs <key> <cert> <shop port> <https port>` in front of it, and the admin with `vite preview --port`.
4. Run `pnpm exec playwright test` with the three addresses, `E2E_ADMIN_EMAIL` and `E2E_ADMIN_PASSWORD`.

`pnpm lint` type-checks the `e2e` folder through `pnpm check:e2e-types`. The folder resolves `mongoose` from the database adapter, so database rows are typed.

Test helpers read shared values from the application rather than copying them. For example, `e2e/support.ts` takes the cookie policy version from the storefront's cookie catalogue, so a policy change cannot silently break every test that accepts cookies.

The architecture is covered by further tests. A runtime-purity test compiles `packages/core-domain` and rejects imports outside its own modules and Node built-ins. Deployment hardening is tested by starting the real API and worker entry points.

### What each layer can show

Unit tests show rules and refusals. Provider popups, user-gesture limits, reload behaviour and multi-page social journeys need a real browser, and sometimes real provider accounts.

## Transaction test pattern

For every atomic workflow:

1. Start the Docker MongoDB replica set with `pnpm mongo:up`.
2. Seed isolated test data.
3. Inject a failure after each participating write.
4. Assert that every collection rolled back.
5. Run the success path and assert all records.
6. Repeat the request and assert the idempotent outcome.
7. Exercise concurrent requests.

## Test matrix by area

| Area          | Tests to have                                                                  |
| ------------- | ------------------------------------------------------------------------------ |
| Startup       | Config, proxy and client IP, CORS, headers, rate limits, safe errors, shutdown |
| Auth          | Cookies, CSRF, rotation and reuse, audience, password, PIN, OTP, revocation    |
| Catalogue     | Public visibility, admin writes, redirects                                     |
| Search        | Normalization, publication and removal, rebuild, outage behaviour              |
| Cart          | Guest ownership, merge, stock and status corrections                           |
| Checkout      | Quote version, idempotency, transaction, snapshots, stock and payment rollback |
| Providers     | Signature, timeout, retry, correlation, reconciliation, secret redaction       |
| Data          | Validators, indexes, migrations, backup and restore, TTL                       |
| Documentation | OpenAPI checks, operation completeness, portal validation                      |

## Manual runtime checks

1. Start the required local services.
2. Read `/openapi.json` to find routes.
3. Check liveness and readiness separately.
4. Exercise anonymous, customer A, customer B, staff and admin identities.
5. Test negative cases before the happy path.
6. Capture request ids and sanitized results.
7. Stop one dependency at a time and observe the behaviour.
8. Restore the dependency and confirm recovery.

## Definition of done

A backend capability is complete when:

- Architecture and ownership are correct.
- Security controls are enforced on the server.
- Contracts and response safety are explicit.
- Durable writes are atomic where required.
- Retry, idempotency and failure recovery are defined.
- Tests cover positive and negative cases.
- Health and telemetry can distinguish failure.
- OpenAPI and portal pages match the behaviour.

## Limitations

- CI runs lint, type checks, the tests at 100% coverage against MongoDB, the production builds and the browser suite on those builds. It does not deploy.
- Readiness does not check Spaces.
- The API exports structured logs only. It has no metrics endpoint.
