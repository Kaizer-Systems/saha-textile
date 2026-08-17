---
title: Schema Nebula
description: Interactive governed map of all 65 explicit target MongoDB collections, their current evidence, bounded contexts, ownership, decisions and relationships.
slug: /database/schema-nebula
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-08-18'
search_keywords: 'schema nebula collections database mongodb star map models ghosts graph relationships bounded context DEC'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/account-separation-task-handoff.mdx
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx
    - docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx
    - docs/engineering-live-context/pending-decisions.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - packages/adapters-db-mongo/src/models
    - packages/adapters-db-mongo/src/collection-names.ts
    - packages/adapters-db-mongo/test/collection-names.test.ts
    - packages/adapters-db-mongo/test/rbac-persistence.test.ts
    - packages/contracts/src/notification.ts
    - docs/_data/portal-manifest.json
    - docs/_data/instruments/schema-nebula.json
    - apps/developer-portal/plugins/portal-data/compiler.js
    - apps/developer-portal/src/data/portal-data.ts
    - apps/developer-portal/src/data/schema-nebula.ts
    - apps/developer-portal/src/components/SchemaNebula
hide_table_of_contents: true
---

import { SchemaNebula } from '@site/src/components/SchemaNebula';

<SchemaNebula />

## How to read the constellation

Schema Nebula is a **governed architecture map**, not a live database browser and not a claim that all 65 collections exist.

| Signal             | Meaning                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Solid star         | A corresponding Mongo adapter model exists in the current repository.                            |
| Dashed ghost       | The collection is part of the ratified target architecture but has no adapter model yet.         |
| Gravity well       | A visual bounded-context cluster. It never collapses several physical collections into one node. |
| Cyan relationship  | The selected collection references that collection.                                              |
| Amber relationship | Another collection references the selected collection.                                           |
| Decision badge     | A stable `DEC-*` decision still affects the collection’s final policy or shape.                  |

Thirty-five solid stars represent graph collections backed by exact physical-name model and test evidence. The remaining 30 stars stay target-only ghosts until equivalent adapter evidence exists.

The current adapter contains 40 exported Mongoose models. Every model declares an exact physical collection name, and adapter tests assert those names. Thirty-five models resolve to graph nodes. `authRateLimits`, `pendingSignups`, and `pendingContactChanges` are transient runtime machinery deliberately outside the graph. `productQuestions` and `ratingAggregates` are durable implemented collections awaiting graph reconciliation; the catalogue reports them without inventing stars. Schema Nebula stands at **65 / 35 / 30**.

## Controls

- Search by collection name, purpose, context, roadmap chunk or decision identifier.
- Use **All**, **Solid** and **Ghost** to compare current implementation with the target.
- Select a bounded-context lens to isolate one gravity well without moving the graph.
- Use the zoom controls—or `+`, `-` and `0` while focused on the map—to inspect dense clusters.
- Tab to stars and use the arrow keys, Home/End and Enter/Space without a mouse.
- Select a relationship chip in the evidence panel to travel directly to that collection.

## Truth and freshness contract

The authored inventory lives in `docs/_data/instruments/schema-nebula.json`. The shared build-time compiler refuses to publish it unless all of the following agree:

1. the ratified route and **65 / 35 / 30** inventory;
2. the current files under `packages/adapters-db-mongo/src/models`, including grouped files that implement several distinct physical collections, with five non-graph collections excluded from star promotion;
3. the catalog, auth, notification and roadmap sources;
4. all collection-to-collection references;
5. every remaining `DEC-*` blocker in the 28-item open decision register;
6. the portal manifest, page provenance and verification date.

Adding or removing a model therefore makes a stale constellation fail the portal build. The implementation change and its dataset state must be updated and reviewed together.

## What remains separate

Schema Nebula answers **which ratified physical collections are current or targeted and how they relate**. The separate source-only database catalogue generates fields, indexes, defaults, enums, select policy, and sanitized examples for all 40 current Mongoose models, including the five current non-graph collections. That broader catalogue evidence does not change the constellation’s 65-node boundary; stable DTO, migration, and retention coverage remains incomplete. Do not treat a target star as implemented schema documentation or deployment proof.

Continue with the [current Mongo adapter map](./current-adapter-map) for implemented model/repository evidence, [transactions and generation](./transactions-and-generation) for the future catalogue contract, and [Mission Control](/mission-control) for roadmap ownership.
