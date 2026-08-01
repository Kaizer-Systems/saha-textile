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

The Mongo adapter contains real connection configuration, 14 models, indexes, mappers, repositories, seed tooling, gated integration tests, and a bound transaction manager. The adapter remains partial. The interactive [Schema Nebula](./schema-nebula) maps the governed 64-collection target, while the separate source-only catalogue documents all 14 current Mongoose models.

## Current implementation boundary

Models currently exist for users, categories, products, carts, orders, currencies and promotions plus D1 auth sessions, OTP challenges, OAuth states, password-reset tokens, email-verification tokens, admin invites and auth rate-limit counters. The auth additions are persistence capabilities only: D2–D5 still own HTTP session lifecycle, endpoints, RBAC, consent/privacy and BOLA adoption. Model presence does not prove production migration, validator, backup, restore or operational readiness.

## Current-model generated catalogue

| Section                      | Source                         | Portal status                                     |
| ---------------------------- | ------------------------------ | ------------------------------------------------- |
| Collection fields            | Mongo model definitions        | **Scaffolded** source-generated current evidence  |
| Required/default/enum/select | Model and validation rules     | **Scaffolded**; temporary `Mixed` shapes flagged  |
| Indexes                      | Adapter index declarations     | **Scaffolded** source-generated current evidence  |
| Example documents            | Sanitised synthetic examples   | **Scaffolded**; sensitive excluded fields omitted |
| Stable DTO/migration mapping | Contracts, mappers, migrations | **Deferred** until mappings and migrations mature |

The catalogue generator imports model metadata without opening a database connection. It remains explicitly current-model-only and scaffolded. The 2026-08-01 regeneration measures **14 models / 192 fields / 43 indexes / 13 temporary shapes** and omits every excluded-by-default hash field from synthetic previews.

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
- Payment, shipment, return, refund, inventory, consent-event, notification, audit and search-outbox records are not represented by current models. D1 auth persistence exists, but D2–D5 runtime adoption does not.
- The six Schema Nebula auth targets are still ghosts because D1’s Mongoose defaults resolve lowercase physical names rather than the locked camelCase collection names; `authratelimits` is intentionally outside the 64-node target graph.
- DB integration suites remain opt-in through `RUN_DB_IT=1`; transaction and D1 auth-persistence suites have real rs0 proof, while CI and HTTP/workflow adoption remain separate readiness requirements.
