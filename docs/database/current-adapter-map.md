---
title: Current Mongo Adapter Map
description: Verified Mongoose models, indexes, repositories, mappers, seed tooling, and present persistence limitations.
search_keywords: 'mongo rs0 replica set connection uri directConnection models indexes repositories'
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-08-01'
source_of_truth:
    - packages/adapters-db-mongo/src/models
    - packages/adapters-db-mongo/src/repositories
    - packages/adapters-db-mongo/src/mappers.ts
    - packages/adapters-db-mongo/src/config.ts
    - packages/adapters-db-mongo/src/connection.ts
    - packages/adapters-db-mongo/src/seed
    - packages/adapters-db-mongo/test/integration.test.ts
    - packages/adapters-db-mongo/test/auth-persistence.test.ts
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Current Mongo adapter map

The Mongo adapter is real but partial. It uses Mongoose, string ids, timestamps, lean reads, explicit mappers, upsert-style saves, and several indexes.

## Current model inventory

| Model                    | Physical collection       | Primary durable purpose                                          | Important index policy                                                  | Notable limitations                                                      |
| ------------------------ | ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `Category`               | `categories`              | Simplified taxonomy nodes                                        | unique slug; parent; path; ancestors                                    | Locked target is multi-placement DAG, not one parent tree                |
| `Product`                | `products`                | Product/variation/add-on catalogue shape plus lifecycle          | unique slug/SKU; visibility/category/time; discontinuation purge lookup | Temporary nested shapes remain                                           |
| `Currency`               | `currencies`              | Enabled currencies and INR rate/PayPal inputs                    | enabled                                                                 | No rate history/staleness/config-version records                         |
| `Promotion`              | `promotions`              | Discount/coupon definition                                       | coupon; scope; starts+ends                                              | Incomplete usage/stacking/applicability engine                           |
| `Cart`                   | `carts`                   | User/guest-shaped cart lines                                     | userId; guestToken                                                      | No ownership proof, active-cart uniqueness or nested validation          |
| `Order`                  | `orders`                  | Order snapshot/timeline scaffold                                 | unique orderNumber; user+createdAt; status                              | Mixed lines/timeline; no workflow transaction adoption                   |
| `User`                   | `users`                   | Identity, credential, role, permission, consent/address scaffold | unique sparse email/username/phone; role+status                         | D2–D5 still own runtime auth, consent/privacy and authorization adoption |
| `AuthSession`            | `authsessions`            | Rotating refresh family and session-bound CSRF hashes            | current/previous token hash; family; user/audience/revocation; TTL      | Persistence capability only; D2 has not adopted it                       |
| `OtpChallenge`           | `otpchallenges`           | Hash-only, single-active OTP challenges                          | active identifier+purpose uniqueness; TTL                               | D3 request/verify endpoints and anti-enumeration remain                  |
| `OAuthState`             | `oauthstates`             | Hash-only OAuth state, nonce and PKCE verifier                   | unique state hash; TTL                                                  | Provider callback consumption remains                                    |
| `PasswordResetToken`     | `passwordresettokens`     | Hash-only single-use password reset                              | unique token hash; user; TTL                                            | D3 endpoint adoption remains                                             |
| `EmailVerificationToken` | `emailverificationtokens` | Hash-only single-use email verification                          | unique token hash; user; TTL                                            | D3 endpoint adoption remains                                             |
| `AdminInvite`            | `admininvites`            | Hash-only admin invite plus acceptance audit                     | unique token hash; one outstanding invite per email                     | D4 acceptance and RBAC adoption remain                                   |
| `AuthRateLimit`          | `authratelimits`          | Atomic expiring auth counters                                    | unique composite key; TTL                                               | Adapter mechanism is outside the locked Schema Nebula graph              |

The generated catalogue confirms these physical names directly from Mongoose metadata. Six D1 names are lowercase defaults rather than the owner-locked camelCase Schema Nebula targets, so their target stars remain ghosts. `authratelimits` is current adapter evidence but is intentionally not one of the locked 64 target nodes.

## Current repository inventory

Fourteen repository adapters implement the seven original domain repositories plus D1’s seven auth repositories. The auth adapters cover session issue/find/rotate/family revocation, OTP challenge consumption, OAuth state, single-use reset/verification/invite tokens, and atomic rate-limit counters; they are not yet wired into D2–D5 HTTP flows.

### Common pattern

```text
find/read → lean document → mapper → contract-shaped value
save/upsert → strip public id → findByIdAndUpdate($set) → mapper
```

### Current query behavior

- Product listing supports category, tag, status, regex search, pagination, newest-first sort, and a `CatalogAudience` that defaults to public. Public list and direct reads are centrally restricted to `live`; public callers cannot widen the filter.
- Category tree returns a flat depth/display-order sort; hierarchy reconstruction is a consumer concern.
- Active promotions use start/end-window filtering and priority sort.
- User credential lookup explicitly selects the hidden password hash.
- User credential lookups can explicitly request the otherwise hidden password/PIN hashes; public mapping returns neither.
- Session/challenge/token repositories explicitly select hidden hashes only inside credential verification paths and never expose plaintext secrets.
- Order listing scopes by `userId`, but single-order lookup does not.
- Order status update appends a timeline value but throws a generic adapter error when missing.

## Mapper boundary

Mappers correctly translate:

- Mongo `_id` to public `id`/currency `code`;
- Mongoose `Date` to ISO strings;
- secret password hash exclusion;
- adapter documents to contract-friendly objects.

Current risks:

- nested `Mixed` fields are type-cast, not runtime-parsed;
- adapter values are often returned as broad public entity contracts rather than operation-specific response DTOs;
- compatibility defaults can mask model/contract widening until the planned user-model migration lands;
- current repository methods have not generally adopted the available transaction context or entity version;
- no migration/version discriminator protects historical shapes.

## Current connection behavior

`connectMongo` is idempotent while Mongoose reports a connected state. `buildMongoConfig` accepts a pre-encoded `MONGODB_URI` (which must already include `replicaSet=rs0`) or assembles a plain `mongodb://` URI from `MONGODB_HOST/PORT/REPLICA_SET/DB_NAME`. Raw credentials are percent-encoded at runtime (`@` becomes `%40`), and the query string always appends `replicaSet=rs0&directConnection=true&retryWrites=true&w=majority`. Local development runs the Docker replica set without auth; deployed profiles set both username and password (setting only one is rejected).

This now implements the locked deployment model rather than conflicting with it:

```text
Local: Docker Desktop → MongoDB 8.3 single-node replica set (rs0)
Production: private Docker network → MongoDB 8.3 single-node replica set (rs0)
```

The `mongodb+srv`/hosted-cluster assumption has been removed. The liveness/readiness split and transaction-capable rs0 proof now exist. Remaining reconciliation includes authenticated deploy-time secret injection, connection-pool/timeout tuning, private networking, resource caps, backup/restore, and workflow-level transaction adoption.

### Local replica-set lifecycle

The same Docker profile is used locally and in production for parity. From the repository root:

| Command             | Effect                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm mongo:up`     | Start `rs0` and wait until healthy (`rs.initiate` is idempotent) |
| `pnpm mongo:status` | Compose state plus replica-set status                            |
| `pnpm mongo:down`   | Stop the container, keep the data volume                         |
| `pnpm mongo:wipe`   | Stop and delete the data volume (destructive)                    |

Definition in `docker/mongo/docker-compose.yml`. The canonical host port is `27017`; a per-machine `MONGO_HOST_PORT` override (gitignored `docker/mongo/.env`) moves only the Mac-side doorway, so the container port, `rs0` name, and URI shape stay identical. The host connection string is `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`.

## Seed tooling

`seedDatabase` idempotently upserts:

- six simplified categories;
- three products covering simple and variation examples;
- INR and USD currency records;
- one color-scoped promotion.

The seed is useful for early schema tests. It is not a complete locked-domain seed: multi-placement categories, semantic option roles, named add-on saree behavior, bundle/composite, search dictionary, admin bootstrap, sessions, payments, inventory, and operational records remain absent.

## Existing integration test

The gated adapter suites connect to rs0, seed/read taxonomy, verify a base variation, prove public/admin product visibility, exercise transaction-manager commit/rollback behavior, and test D1 auth persistence. They run only when `RUN_DB_IT=1` and Mongo configuration is present.

Limitations:

- normal runs skip the suite (it requires `RUN_DB_IT=1` and Mongo configuration);
- the suite does not start the replica set itself — bring it up first with `pnpm mongo:up`;
- it does not exercise indexes/uniqueness broadly;
- six transaction tests prove commit, rollback after a successful write, error propagation, return values, nested-session joining, and inner-failure rollback of outer writes;
- 18 auth-persistence tests prove default secret exclusion, explicit credential reads, session rotation/reuse-family support, atomic single-use challenge/token consumption, TTL/index declarations and atomic rate-limit increments;
- it does not cover every repository/mapper.

## Model review checklist

For every model, verify:

1. domain ownership and retention;
2. complete field types/nullability/defaults;
3. nested schemas instead of unjustified `Mixed`;
4. unique/compound/partial/TTL indexes;
5. concurrency/version strategy;
6. sensitive-field selection and encryption policy;
7. domain and response mapping;
8. transaction participation;
9. migration history/compatibility;
10. backup, restore, archive and erasure behavior;
11. generated catalogue output and sanitized example;
12. tests against the real replica-set profile.

## What MongoDB is authoritative for

MongoDB is authoritative for durable platform facts. Meilisearch is a derived public discovery index; IndexedDB/service-worker caches are browser-side convenience; Spaces stores media/archive objects; provider systems report external lifecycle facts that are verified and reconciled into platform records.
