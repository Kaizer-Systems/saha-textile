---
title: Database Overview
description: How MongoDB is used, what the adapter holds, and where to find database documentation.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - packages/adapters-db-mongo/src
    - packages/contracts/src
    - docker/mongo/docker-compose.yml
    - docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx
    - docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/schema-nebula.json
---

# Database overview

MongoDB is the platform's system of record. It runs as a self-hosted Docker single-node replica set named `rs0`, so that multi-document transactions are available. Local and deployed environments use the same profile.

Applications reach MongoDB only through `packages/adapters-db-mongo`, which implements the repository ports in `packages/core-domain`.

## What the adapter holds

Models cover:

- Catalogue: categories, placements, facets, attributes, products, variants, bundles, relations, redirects, SEO routes and add-on templates.
- Commerce: carts, orders, promotions and currencies.
- Accounts: `customers` and `adminUsers`, as separate populations, with credentials and provider identities.
- Authentication runtime: sessions, challenges, tokens, invites, rate limits, and pending signup and contact-change records.
- Authorization: roles and role assignments.
- Governance: audit logs, consent events, notification settings, templates and the message outbox.
- Content and media: media assets and roles, content blocks, site settings, FAQ, questions, reviews and rating aggregates.
- Inventory: the stock ledger and FIFO cost layers.
- Merchandising: stock alerts and weekly insight sets.

## Database documentation

| Page                                                                  | Use it to                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [Schema Nebula](./schema-nebula)                                      | Explore existing and planned collections and their relationships |
| [Mongo adapter map](./current-adapter-map)                            | Find models, repositories, mappers and local commands            |
| [Transactions and generated catalogue](./transactions-and-generation) | Understand atomic writes and the generated field reference       |
| [Storefront cutover](./storefront-cutover)                            | See how catalogue data, search and old addresses fit together    |
| [Database catalogue](/tools/database-catalogue)                       | Read fields, defaults, enums and indexes for every model         |
| [Contracts and validation](../backend/contracts-and-validation)       | Compare persistence, request, domain and response shapes         |

## Generated catalogue

The catalogue generator imports model metadata without opening a database connection. It lists each model's fields, defaults, enums, select rules and indexes. Excluded-by-default fields, such as hashes and tokens, are named but left out of synthetic examples. Do not copy field tables by hand.

## Storage enums

Enum values in Mongoose schemas derive from shared contract and domain option sets, not copied lists. Deliberate storage-only differences are documented beside their models.

## Limitations

- Payment, shipment, return, refund and search-outbox records have no collections. Schema Nebula shows them as planned.
- Some models use `Mixed` nested fields, which are flagged as temporary in the catalogue.
- MongoDB integration tests run only with `RUN_DB_IT=1`.
- Backup and restore procedures are planned. See [Operations overview](/operations/overview).
