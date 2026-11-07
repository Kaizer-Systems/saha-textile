---
title: Mongo Adapter Map
description: Mongoose models, repositories, mappers, seed tools and local replica-set commands.
search_keywords: 'mongo rs0 replica set connection uri directConnection models indexes repositories'
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-11-07'
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

# Mongo adapter map

This page maps the models, repositories and mappers in `packages/adapters-db-mongo`, and lists the local commands for the replica set.

## Model inventory

| Family                   | Physical collections                                                                                                                                                          | Used by                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Catalogue                | `categories`, `products`, `productVariants`, `categoryPlacements`, `categoryFacetConfigs`, `attributeDefinitions`, `productBundles`, `productRelations`                       | Public catalogue and admin product form         |
| Catalogue operations     | `addonTemplates`, `seoRedirects`, `seoRoutes`                                                                                                                                 | Admin catalogue routes and storefront head data |
| Merchandising            | `stockAlerts`, `productInsightSets`                                                                                                                                           | Stock alert route and weekly worker jobs        |
| Commerce                 | `carts`, `orders`, `promotions`, `currencies`                                                                                                                                 | Cart, order, promotion and currency routes      |
| Accounts                 | `customers`, `adminUsers`                                                                                                                                                     | Storefront and admin                            |
| Credentials and identity | `passwordCredentials`, `pinCredentials`, `authIdentities`                                                                                                                     | Sign-in and identity linking                    |
| Auth runtime             | `authSessions`, `otpChallenges`, `oauthStates`, `passwordResetTokens`, `emailVerificationTokens`, `adminInvites`, `authRateLimits`, `pendingSignups`, `pendingContactChanges` | Session, recovery, signup and contact flows     |
| Authorization            | `roles`, `adminUserRoleAssignments`                                                                                                                                           | Admin authority routes                          |
| Privacy                  | `consentEvents`                                                                                                                                                               | Consent routes                                  |
| Governance               | `auditLogs`, `notificationChannelSettings`, `notificationTemplates`, `messageOutbox`                                                                                          | Audit, notification settings, MSG91 adapter     |
| Media and settings       | `mediaAssets`, `mediaRoles`, `contentBlocks`, `siteSettings`                                                                                                                  | Media library, banners, YouTube settings        |
| Content                  | `faqEntries`, `productQuestions`, `reviews`, `ratingAggregates`                                                                                                               | FAQ, questions and reviews                      |
| Inventory                | `inventoryLedger`, `inventoryCostLayers`                                                                                                                                      | Repository only; no HTTP workflow               |

### Declared collection names

Every schema passes an explicit `collection` option. `packages/adapters-db-mongo/src/collection-names.ts` is the single declaration, checked by `test/collection-names.test.ts`. `pnpm mongo:align-collections` moves data from inferred names to declared names. It is idempotent, refuses to merge when both names hold data, and never runs at startup.

## Repository pattern

```text
find/read → lean document → mapper → contract-shaped value
save/upsert → strip public id → findByIdAndUpdate($set) → mapper
```

- `AuthIdentityRepository` is the only provider-link writer.
- Signup repositories join one ambient transaction for the customer, credential and provider identity.
- Contact confirmation joins proof consumption, the identifier write and the audit record.

## Query behaviour

- Product listing supports category, tag, status, search, pagination and newest-first sorting, with a `CatalogAudience` that defaults to public. Public reads resolve to `live`, and public callers cannot widen the filter.
- The category tree returns a flat sort by depth and display order. Consumers rebuild the hierarchy.
- Active promotions use a start and end window with priority sorting.
- Credential lookups explicitly request hidden hashes, and public mapping returns none of them.
- Customer email and phone unique-index races become `DuplicateIdentifierError`.
- Customer address writes use one MongoDB statement, so concurrent edits cannot lose data.
- Session, challenge and token repositories select hidden hashes only inside verification paths.
- Order listing is scoped by `userId`.

## Inventory rules

Stock lives on variants. `applyDelta` moves stock with one conditional update, so two writers cannot both spend the same units, and a decrease that would go below zero is refused unless the variant is untracked or allows backorder. Each move appends a ledger row with its `balanceAfter`. The ledger has no update path: a mistake is corrected with a new row.

A manual adjustment needs a reason code, and `other` also needs a note. FIFO cost layers are consumed oldest first, and a sale with too few costed units fails rather than costing the rest at zero. Cost data is never customer-facing.

## Index rules

| Collection                 | Rule                                                                          |
| -------------------------- | ----------------------------------------------------------------------------- |
| `customers`                | Email and phone are unique among statuses other than `deleted`                |
| `adminUserRoleAssignments` | One active row per operator and role. A revoked role can be granted again     |
| `otpChallenges`            | One unconsumed challenge per identifier and purpose                           |
| `adminInvites`             | One open invite per address. Accepted invites have no TTL and stay as records |
| `categoryPlacements`       | A joined `pathKey` is unique, and each category has one canonical placement   |
| `reviews`                  | One review per product, customer and order                                    |
| `messageOutbox`            | One row per idempotency key                                                   |

Sessions expire on their absolute limit. Audit logs, consent events and the stock ledger have no TTL.

## Mapper boundary

Mappers translate:

- Mongo `_id` to public `id`, or to `code` for currencies.
- Mongoose `Date` to ISO strings.
- Adapter documents to contract-shaped objects, without secret hashes.

Nested `Mixed` fields are cast, not parsed. Values are often returned as broad public contracts rather than operation-specific responses.

## Connection behaviour

`buildMongoConfig` accepts a pre-encoded `MONGODB_URI`, which must include `replicaSet=rs0`, or assembles a URI from `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_REPLICA_SET` and `MONGODB_DB_NAME`. Credentials are percent-encoded at runtime. The query string appends `replicaSet=rs0&directConnection=true&retryWrites=true&w=majority`. Local development runs without authentication. Deployed profiles set both username and password; setting only one is rejected.

```text
Local: Docker Desktop → MongoDB 9.0.4 single-node replica set (rs0)
Production: private Docker network → MongoDB 9.0.4 single-node replica set (rs0)
```

### Local replica-set lifecycle

Run these from the repository root:

| Command             | Effect                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `pnpm mongo:up`     | Start `rs0` and wait until healthy (`rs.initiate` is idempotent) |
| `pnpm mongo:status` | Show Compose state and replica-set status                        |
| `pnpm mongo:down`   | Stop the container and keep the data volume                      |
| `pnpm mongo:wipe`   | Stop and delete the data volume (destructive)                    |

The definition is in `docker/mongo/docker-compose.yml`. The default host port is `27017`. A `MONGO_HOST_PORT` override in a gitignored `docker/mongo/.env` moves only the host-side port. The host connection string is `mongodb://127.0.0.1:27017/saha_textile_local?replicaSet=rs0&directConnection=true`.

## Seed and migration tools

| Command (in `@saha-textile/adapters-db-mongo`) | Effect                                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `seed`                                         | Base categories, products, currencies, a promotion and 70 sample customers                                            |
| `seed:demo-catalogue`                          | The demo catalogue, placements, variants, templates and old addresses. Refuses a database without `local` in its name |
| `seed:system-roles`                            | System roles. Run after adding a permission                                                                           |
| `reconcile:indexes`                            | Bring database indexes in line with the models. Drops any index a model does not declare, and has a dry run           |
| `align:collections`                            | Move data to declared collection names                                                                                |
| `split:admin-users`                            | Move operators out of `customers` and rewrite their ids                                                               |
| `extract:credentials`                          | Move embedded hashes into the credential collections                                                                  |
| `rename:admin-user-permissions`                | Rewrite retired permission codes in stored grants                                                                     |

Old-address rows are in `src/seed/legacy-addresses.ts`. The seed writes only approved rows, and an unapproved row fails the seed. The first administrator is created by a [separate command](/api/route-inventory#admin-authorization-routes), not by seed data.

## Integration tests

Integration suites connect to `rs0` and cover repositories, transactions, identity and authority persistence, catalogue structure, inventory, media, governance and content. They run only when `RUN_DB_IT=1` and MongoDB configuration is present. They do not start the replica set, so run `pnpm mongo:up` first.

## Model review checklist

For every model, verify:

1. Domain ownership and retention.
2. Field types, nullability and defaults.
3. Nested schemas instead of unjustified `Mixed`.
4. Unique, compound, partial and TTL indexes.
5. Concurrency and version strategy.
6. Sensitive-field selection and encryption.
7. Domain and response mapping.
8. Transaction participation.
9. Migration history and compatibility.
10. Backup, restore, archive and erasure behaviour.
11. Generated catalogue output and sanitized examples.
12. Tests against the real replica set.

## What MongoDB is authoritative for

MongoDB is authoritative for durable platform facts. Meilisearch is a derived index. Browser caches are a convenience. Spaces stores media objects. Provider systems report external facts, which are verified and reconciled into platform records.
