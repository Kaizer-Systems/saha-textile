---
title: Database Overview
description: Current Mongo adapter boundary, durable-data status, and future generated catalogue.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-08-15'
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

The Mongo adapter contains real connection configuration, 38 models, indexes, mappers, repositories, seed tooling, 103 tests (99 rs0-gated), and a bound transaction manager. The adapter remains partial at the whole-roadmap level. The interactive [Schema Nebula](./schema-nebula) maps the governed 65-collection target with 35 current nodes, while the separate source-only catalogue documents all 38 current Mongoose models.

## Current implementation boundary

Models currently exist for the original commerce/catalogue surface plus auth sessions/challenges/tokens/rate limits, roles/user assignments, consent, catalogue placement/facets/attributes, variants/bundles/relations, media, inventory ledgers/cost layers, audit/notification/outbox data, FAQs, product questions, reviews and rating aggregates. Chunk E persistence is complete and its atomic workflows are rs0-proven. The RBAC repositories now participate in effective-permission resolution and the admin role/authority APIs, but model presence still does not prove every HTTP use case has adopted those repositories or prove production migration, backup, restore and operational readiness.

## Current-model generated catalogue

| Section                      | Source                         | Portal status                                     |
| ---------------------------- | ------------------------------ | ------------------------------------------------- |
| Collection fields            | Mongo model definitions        | **Scaffolded** source-generated current evidence  |
| Required/default/enum/select | Model and validation rules     | **Scaffolded**; temporary `Mixed` shapes flagged  |
| Indexes                      | Adapter index declarations     | **Scaffolded** source-generated current evidence  |
| Example documents            | Sanitised synthetic examples   | **Scaffolded**; sensitive excluded fields omitted |
| Stable DTO/migration mapping | Contracts, mappers, migrations | **Deferred** until mappings and migrations mature |

The catalogue generator imports model metadata without opening a database connection. It remains explicitly current-model-only and scaffolded. The deterministic 2026-08-15 regeneration measures **38 models / 456 fields / 103 indexes / 27 temporary shapes** and omits all **13** excluded-by-default fields from synthetic previews.

Do not manually duplicate field tables once generation is available.

## Database documentation map

- [Schema Nebula](./schema-nebula) — interactive 65-node current-versus-target collection constellation, context lenses, decisions and relationships.
- [Current Mongo adapter map](./current-adapter-map) — models, indexes, repositories, mappings and verified gaps.
- [Transactions and generated catalogue](./transactions-and-generation) — atomic-write boundary, replica-set proof, generation trigger and page contract.
- [Contracts and validation](../backend/contracts-and-validation) — persistence versus request/domain/response shapes.
- [Composition and adapters](../backend/composition-and-adapters) — how repositories are bound into the API.

## Current limitations and evidence boundaries

- Connection configuration and `.env.example` implement the ratified self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`), with the same profile locally and in production; previous hosted-cluster/SRV assumptions are removed. Start the local set with `pnpm mongo:up` (see [current adapter map](./current-adapter-map#local-replica-set-lifecycle)).
- Current models use multiple `Mixed` nested structures, which are weaker than the future generated validator/catalogue needs.
- `TransactionManagerPort` and `MongoTransactionManager` are bound in API composition and commit/rollback-proven against rs0. Order creation adopts the capability for order save plus cart consumption; idempotency and the wider inventory, payment, audit, and outbox transaction boundary remain open.
- Payment, shipment, return/refund and search-outbox records remain target-only. Inventory, consent, notifications and broad audit evidence now have current models.
- Every model declares its physical collection name. Schema Nebula promotes 32 graph-backed names; `authRateLimits`, `productQuestions`, and `ratingAggregates` remain current catalogue evidence outside the fixed graph.
- DB integration suites remain opt-in through `RUN_DB_IT=1`; all 103 adapter tests have recorded proof (four source-only plus 99 against rs0), while CI and HTTP/workflow adoption remain separate readiness requirements.
