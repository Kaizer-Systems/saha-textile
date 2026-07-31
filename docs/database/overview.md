---
title: Database Overview
description: Current Mongo adapter boundary, durable-data status, and future generated catalogue.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-08-01'
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

The Mongo adapter contains real connection configuration, seven models, indexes, mappers, repositories, seed tooling, gated integration tests, and a bound transaction manager. The adapter remains partial. The interactive [Schema Nebula](./schema-nebula) maps the governed 64-collection target, while the separate source-only catalogue documents only today’s seven model files.

## Current implementation boundary

Models currently exist for users, categories, products, carts, orders, currencies and promotions. Their presence does not prove production migration, validator, backup, restore or operational readiness.

## Current-model generated catalogue

| Section                      | Source                         | Portal status                                     |
| ---------------------------- | ------------------------------ | ------------------------------------------------- |
| Collection fields            | Mongo model definitions        | **Scaffolded** source-generated current evidence  |
| Required/default/enum/select | Model and validation rules     | **Scaffolded**; temporary `Mixed` shapes flagged  |
| Indexes                      | Adapter index declarations     | **Scaffolded** source-generated current evidence  |
| Example documents            | Sanitised synthetic examples   | **Scaffolded**; sensitive excluded fields omitted |
| Stable DTO/migration mapping | Contracts, mappers, migrations | **Deferred** until mappings and migrations mature |

The catalogue generator imports model metadata without opening a database connection. It remains explicitly current-model-only and scaffolded; Pass 4 regenerates its measured field/index/temporary-shape counts after the product lifecycle change.

Do not manually duplicate field tables once generation is available.

## Database documentation map

- [Schema Nebula](./schema-nebula) — interactive 64-node current-versus-target collection constellation, context lenses, decisions and relationships.
- [Current Mongo adapter map](./current-adapter-map) — models, indexes, repositories, mappings and verified gaps.
- [Transactions and generated catalogue](./transactions-and-generation) — atomic-write boundary, replica-set proof, generation trigger and page contract.
- [Contracts and validation](../backend/contracts-and-validation) — persistence versus request/domain/response shapes.
- [Composition and adapters](../backend/composition-and-adapters) — how repositories are bound into the API.

## Current reconciliation warnings

- Connection configuration and `.env.example` now implement the locked self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`), with the same profile locally and in production; the previous hosted-cluster/SRV assumptions have been removed. Start the local set with `pnpm mongo:up` (see [current adapter map](./current-adapter-map#local-replica-set-lifecycle)).
- Current models use multiple `Mixed` nested structures, which are weaker than the future generated validator/catalogue needs.
- `TransactionManagerPort` and `MongoTransactionManager` exist, are bound in API composition, and are commit/rollback-proven against rs0. The current order path and repositories have not adopted the capability for atomic workflow writes.
- Order, payment, shipment, return, refund, inventory, auth-session, consent, notification, audit and search-outbox records are not represented by the current seven-model scaffold.
- DB integration suites remain opt-in through `RUN_DB_IT=1`; the transaction suite has real rs0 proof, while CI/workflow adoption remains a separate readiness requirement.
