---
title: Schema Nebula
description: Interactive governed map of all 64 explicit target MongoDB collections, their current evidence, bounded contexts, ownership, decisions and relationships.
slug: /database/schema-nebula
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-08-02'
search_keywords: 'schema nebula collections database mongodb star map models ghosts graph relationships bounded context DEC'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/codex-catalog-db-architecture-assessment-and-plan.mdx
    - docs/engineering-live-context/codex-auth-architecture-db-and-request-plan.mdx
    - docs/engineering-live-context/pending-decisions.mdx
    - docs/engineering-live-context/project-progress.mdx
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - packages/adapters-db-mongo/src/models
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

Schema Nebula is a **governed architecture map**, not a live database browser and not a claim that all 64 collections exist.

| Signal             | Meaning                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Solid star         | A corresponding Mongo adapter model exists in the current repository.                            |
| Dashed ghost       | The collection is part of the ratified target architecture but has no adapter model yet.         |
| Gravity well       | A visual bounded-context cluster. It never collapses several physical collections into one node. |
| Cyan relationship  | The selected collection references that collection.                                              |
| Amber relationship | Another collection references the selected collection.                                           |
| Decision badge     | A stable `DEC-*` decision still affects the collection’s final policy or shape.                  |

The eight solid stars are `categories`, `products`, `promotions`, `orders`, `currencies`, `carts`, `users` and `reviews`. Every other star remains a target-only ghost until exact physical-name model evidence exists.

Chunks D/E expanded the current adapter to 32 models. Source inspection on 2026-08-01 found that Mongoose resolved most new multiword physical names through lowercase defaults (`authsessions`, `categoryplacements`, `inventoryledgers`, `auditlogs`, and so on) rather than the ratified lower-camel graph names, so those models could not promote mismatched stars. On 2026-08-02 the adapter declared every physical name explicitly and migrated the local replica set, so all 32 models now resolve to their ratified names and `packages/adapters-db-mongo/test/collection-names.test.ts` asserts it against this dataset. Promoting the newly eligible stars changes a governed count and remains a separate, reviewed portal-truth reconciliation; `authRateLimits` stays outside the graph either way. Schema Nebula is therefore still published as **64 / 8 / 56**.

## Controls

- Search by collection name, purpose, context, roadmap chunk or decision identifier.
- Use **All**, **Solid** and **Ghost** to compare current implementation with the target.
- Select a bounded-context lens to isolate one gravity well without moving the graph.
- Use the zoom controls—or `+`, `-` and `0` while focused on the map—to inspect dense clusters.
- Tab to stars and use the arrow keys, Home/End and Enter/Space without a mouse.
- Select a relationship chip in the evidence panel to travel directly to that collection.

## Truth and freshness contract

The authored inventory lives in `docs/_data/instruments/schema-nebula.json`. The shared build-time compiler refuses to publish it unless all of the following agree:

1. the ratified route and **64 / 8 / 56** inventory;
2. the current files under `packages/adapters-db-mongo/src/models`, with grouped lowercase D/E model files held as non-target evidence until their physical names align, `reviews` mapped through its grouped content file, and `authRateLimits` excluded by canonical policy;
3. the catalog, auth, notification and roadmap sources;
4. all collection-to-collection references;
5. every remaining `DEC-*` blocker in the 24-item open decision register;
6. the portal manifest, page provenance and verification date.

Adding or removing a model therefore makes a stale constellation fail the portal build. The implementation change and its dataset state must be updated and reviewed together.

## What remains separate

Schema Nebula answers **which physical collections are current or targeted and how they relate**. The separate source-only database catalogue now generates fields, indexes, defaults, enums, select policy and sanitized examples for all 32 current Mongoose models. That broader catalogue evidence does not change the constellation’s exact-name rule or its **64 / 8 / 56** state; stable DTO/migration/retention coverage remains incomplete. Do not treat a target star as implemented schema documentation or deployment proof.

Continue with the [current Mongo adapter map](./current-adapter-map) for implemented model/repository evidence, [transactions and generation](./transactions-and-generation) for the future catalogue contract, and [Mission Control](/mission-control) for roadmap ownership.
