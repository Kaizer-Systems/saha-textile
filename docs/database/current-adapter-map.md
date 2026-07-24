---
title: Current Mongo Adapter Map
description: Verified Mongoose models, indexes, repositories, mappers, seed tooling, and present persistence limitations.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - packages/adapters-db-mongo/src/models
    - packages/adapters-db-mongo/src/repositories
    - packages/adapters-db-mongo/src/mappers.ts
    - packages/adapters-db-mongo/src/config.ts
    - packages/adapters-db-mongo/src/connection.ts
    - packages/adapters-db-mongo/src/seed
    - packages/adapters-db-mongo/test/integration.test.ts
    - project-context/angular-context/owner-decisions-log.md
---

# Current Mongo adapter map

The Mongo adapter is real but partial. It uses Mongoose, string ids, timestamps, lean reads, explicit mappers, upsert-style saves, and several indexes.

## Current model inventory

| Model       | Primary durable purpose                           | Important indexes                          | Notable limitations                                                                                       |
| ----------- | ------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `Category`  | Simplified taxonomy nodes                         | unique slug; parent; path; ancestors       | Locked target is multi-placement DAG, not one parent tree                                                 |
| `Product`   | Product/variation/add-on catalogue shape          | unique slug/SKU; categoryIds; tags; status | Nested media/attributes/variations/add-ons use `Mixed`; target semantic model is richer                   |
| `Currency`  | Enabled currencies and INR rate/PayPal inputs     | enabled                                    | No rate history/staleness/config-version records                                                          |
| `Promotion` | Discount/coupon definition                        | coupon; scope; starts+ends                 | Coupon index not unique; incomplete usage/stacking/applicability engine                                   |
| `Cart`      | User/guest-shaped cart lines                      | userId; guestToken                         | Guest token stored directly, no TTL, ownership model, unique active-cart guarantees, or nested validation |
| `Order`     | Order snapshot/timeline scaffold                  | unique orderNumber; user+createdAt; status | Mixed lines/timeline; no separate payment/shipment/return/refund records or transaction                   |
| `User`      | Public identity/profile plus hidden password hash | sparse unique email                        | Auth identity/session/challenge/role/audit responsibilities not separated                                 |

These names refer to Mongoose models. Physical collection naming follows Mongoose configuration/conventions and must be confirmed by the generated catalogue rather than guessed.

## Current repository inventory

All seven repositories implement matching core ports and return mapped contract-shaped values.

### Common pattern

```text
find/read → lean document → mapper → contract-shaped value
save/upsert → strip public id → findByIdAndUpdate($set) → mapper
```

### Current query behavior

- Product listing supports category, tag, status, regex search, pagination, and newest-first sort.
- Category tree returns a flat depth/display-order sort; hierarchy reconstruction is a consumer concern.
- Active promotions use start/end-window filtering and priority sort.
- User credential lookup explicitly selects the hidden password hash.
- User mapping never returns `passwordHash`.
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
- no mapper receives transaction context or entity version;
- no migration/version discriminator protects historical shapes.

## Current connection behavior

`connectMongo` is idempotent while Mongoose reports a connected state. Configuration either accepts `MONGODB_URI` or assembles an `mongodb+srv` URI from username/password/cluster host.

This conflicts with the locked deployment model:

```text
Local: Docker Desktop → MongoDB 8.3 single-node replica set
Production: private Docker network → MongoDB 8.3 single-node replica set
```

Required reconciliation includes replica-set URI/config, authentication and secret handling, connection pool/timeouts, private networking, readiness, resource caps, test profile, and no hosted-cluster assumptions.

## Seed tooling

`seedDatabase` idempotently upserts:

- six simplified categories;
- three products covering simple and variation examples;
- INR and USD currency records;
- one color-scoped promotion.

The seed is useful for early schema tests. It is not a complete locked-domain seed: multi-placement categories, semantic option roles, named add-on saree behavior, bundle/composite, search dictionary, admin bootstrap, sessions, payments, inventory, and operational records remain absent.

## Existing integration test

The test connects, seeds, reads taxonomy, verifies a base variation, and filters published products by category. It runs only when `RUN_DB_IT=1` and Mongo configuration is present.

Limitations:

- normal runs skip the suite;
- it references the superseded hosted test model in comments/env guidance;
- it does not start the required local replica set;
- it does not exercise indexes/uniqueness broadly;
- it does not prove transactions or rollback;
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
