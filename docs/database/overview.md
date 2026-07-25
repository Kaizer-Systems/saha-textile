---
title: Database Overview
description: Current Mongo adapter boundary, durable-data status, and future generated catalogue.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - packages/adapters-db-mongo/src
    - packages/contracts/src
    - docker/mongo/docker-compose.yml
    - project-context/angular-context/codex-catalog-db-architecture-assessment-and-plan.md
---

# Database overview

The Mongo adapter contains real connection configuration, models, indexes, mappers, repositories, seed tooling and an integration test. The adapter is scaffolded and partially implemented; the generated portal catalogue described below does not exist yet.

## Current implementation boundary

Models currently exist for users, categories, products, carts, orders, currencies and promotions. Their presence does not prove production migration, validator, backup, restore or operational readiness.

## Deferred generated catalogue

| Section                      | Source                         | Portal status                                   |
| ---------------------------- | ------------------------------ | ----------------------------------------------- |
| Collection fields            | Mongo model definitions        | **Deferred** until the generator is implemented |
| Required and nullable fields | Model and validation rules     | **Deferred**                                    |
| Indexes                      | Adapter index declarations     | **Deferred**                                    |
| Example documents            | Sanitised generated examples   | **Deferred**                                    |
| DTO mappings                 | Contracts plus adapter mappers | **Deferred**                                    |

## Generation trigger

Create the catalogue generator when the persistence model is stable enough that generated output will reduce drift instead of repeatedly documenting temporary schema shapes. Generated pages must link back to their model, index and contract sources.

Do not manually duplicate field tables once generation is available.

## Database documentation map

- [Current Mongo adapter map](./current-adapter-map) — models, indexes, repositories, mappings and verified gaps.
- [Transactions and generated catalogue](./transactions-and-generation) — atomic-write boundary, replica-set proof, generation trigger and page contract.
- [Contracts and validation](../backend/contracts-and-validation) — persistence versus request/domain/response shapes.
- [Composition and adapters](../backend/composition-and-adapters) — how repositories are bound into the API.

## Current reconciliation warnings

- Connection configuration and `.env.example` now implement the locked self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`), with the same profile locally and in production; the previous hosted-cluster/SRV assumptions have been removed. Start the local set with `pnpm mongo:up` (see [current adapter map](./current-adapter-map#local-replica-set-lifecycle)).
- Current models use multiple `Mixed` nested structures, which are weaker than the future generated validator/catalogue needs.
- No unit-of-work/transaction port or session-aware repository contract exists.
- Order, payment, shipment, return, refund, inventory, auth-session, consent, notification, audit and search-outbox records are not represented by the current seven-model scaffold.
- The live integration suite normally skips itself and does not prove transaction rollback.
