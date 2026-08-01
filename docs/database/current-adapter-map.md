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

| Family                   | Physical collections                                                                                                               | Current evidence boundary                                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original seven           | `categories`, `products`, `promotions`, `orders`, `currencies`, `carts`, `users`                                                   | Existing catalogue/commerce APIs; product lifecycle/indexes, cart/`st_guest` ownership and order+cart transactional create are current; checkout idempotency remains open |
| Auth seven               | `authsessions`, `otpchallenges`, `oauthstates`, `passwordresettokens`, `emailverificationtokens`, `admininvites`, `authratelimits` | Session/OTP/reset/PIN/RBAC flows use these stores; OAuth callback, email-verification completion and invite acceptance remain open                                        |
| Privacy                  | `consentevents`                                                                                                                    | Consent history and privacy request seams are API-bound                                                                                                                   |
| Catalogue/merchandising  | `categoryplacements`, `categoryfacetconfigs`, `attributedefinitions`, `productvariants`, `productbundles`, `productrelations`      | Tested repositories exist; broad HTTP catalogue-management adoption remains open                                                                                          |
| Media/inventory          | `mediaassets`, `inventoryledgers`, `inventorycostlayers`                                                                           | Tested repository/index behavior exists; business workflow adoption remains open                                                                                          |
| Governance/notifications | `auditlogs`, `notificationchannelsettings`, `notificationtemplates`, `messageoutboxes`                                             | Tested durable evidence/outbox stores exist; provider delivery and complete side-effect orchestration remain open                                                         |
| Content                  | `faqentries`, `productquestions`, `reviews`, `ratingaggregates`                                                                    | Tested repositories exist; public/admin content operations remain open                                                                                                    |

The generated catalogue confirms all 32 physical names directly from Mongoose metadata: 406 fields, 89 indexes, and 27 temporary shapes. Most new multiword Mongoose defaults do not exactly match the governed Schema Nebula names, so exact-name evidence promotes only `reviews`; the governed graph remains 64 nodes / 8 current / 56 target. `authratelimits` is current adapter evidence but is intentionally outside the ratified 64-node graph.

## Current repository inventory

Repository adapters cover the original domain stores plus auth, consent, catalogue structure, merchandising, inventory, media, governance and content. Auth adapters are bound into session/OTP/reset/admin flows; catalogue/media/inventory/governance/content adapters are tested capabilities whose wider HTTP workflows remain incomplete.

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
- Order listing scopes by `userId`; the controller applies customer ownership to single-order reads and gives staff/admin an explicit support bypass.
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
- order save and cart consumption share the available transaction context; most other multi-record workflows and entity-version policies remain open;
- no migration/version discriminator protects historical shapes.

## Current connection behavior

`connectMongo` is idempotent while Mongoose reports a connected state. `buildMongoConfig` accepts a pre-encoded `MONGODB_URI` (which must already include `replicaSet=rs0`) or assembles a plain `mongodb://` URI from `MONGODB_HOST/PORT/REPLICA_SET/DB_NAME`. Raw credentials are percent-encoded at runtime (`@` becomes `%40`), and the query string always appends `replicaSet=rs0&directConnection=true&retryWrites=true&w=majority`. Local development runs the Docker replica set without auth; deployed profiles set both username and password (setting only one is rejected).

This implements the ratified deployment model:

```text
Local: Docker Desktop → MongoDB 8.3 single-node replica set (rs0)
Production: private Docker network → MongoDB 8.3 single-node replica set (rs0)
```

The `mongodb+srv`/hosted-cluster assumption has been removed. The liveness/readiness split and transaction-capable rs0 proof now exist. Remaining operational work includes authenticated deploy-time secret injection, connection-pool and timeout tuning, private networking, resource caps, backup and restore, and transaction adoption across additional workflows.

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

The seed is useful for early schema tests. It is not a complete domain seed: multi-placement categories, semantic option roles, named add-on saree behavior, bundle/composite, search dictionary, admin bootstrap, sessions, payments, inventory, and operational records remain absent.

## Existing integration test

The 81 gated adapter tests connect to rs0 and cover baseline repositories, transaction behavior, auth persistence, catalogue structure/merchandising, inventory/media, governance/content and order+cart transactional create. They run only when `RUN_DB_IT=1` and Mongo configuration is present.

Limitations:

- normal runs skip the suite (it requires `RUN_DB_IT=1` and Mongo configuration);
- the suite does not start the replica set itself — bring it up first with `pnpm mongo:up`;
- it does not exercise indexes/uniqueness broadly;
- six transaction tests prove commit, rollback after a successful write, error propagation, return values, nested-session joining, and inner-failure rollback of outer writes;
- 18 auth-persistence tests prove default secret exclusion, explicit credential reads, session rotation/reuse-family support, atomic single-use challenge/token consumption, TTL/index declarations and atomic rate-limit increments;
- 15 catalogue tests, 15 inventory/media tests and 16 governance/content tests prove the newly implemented repository/index behavior;
- 3 order+cart transaction tests prove commit and rollback of order save with cart consumption;
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
