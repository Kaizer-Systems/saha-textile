---
title: Schema Nebula
description: Interactive map of existing and planned MongoDB collections and their relationships.
slug: /database/schema-nebula
wide: true
status: implemented
audience: [beginner, backend, operator]
last_verified: '2026-11-07'
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
    - packages/contracts/src/stock-alert.ts
    - packages/contracts/src/stock-alert.ts
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

## How to read the map

Schema Nebula is an interactive map of the MongoDB collections in the platform design. Each star is one physical collection. The map is not a live database browser, and it does not show data.

| Signal             | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| Solid star         | A Mongo model exists for this collection.              |
| Dashed star        | The collection is planned and has no model.            |
| Cluster            | A visual grouping by business context.                 |
| Cyan relationship  | The selected collection references that collection.    |
| Amber relationship | Another collection references the selected collection. |
| Decision badge     | An open decision affects the collection's final shape. |

`authRateLimits`, `pendingSignups` and `pendingContactChanges` are short-lived runtime collections and do not appear on the map.

## Controls

- Search by collection name, purpose, context or decision identifier.
- Use **All**, **Solid** and **Ghost** to compare existing and planned collections.
- Select a context to isolate one cluster.
- Use the zoom controls, or `+`, `-` and `0` while the map has focus.
- Tab to stars, and use the arrow keys, Home, End, Enter and Space without a mouse.
- Select a relationship chip to move to that collection.

## How the data is maintained

The collection list is in `docs/_data/instruments/schema-nebula.json`. The portal build compares it with the model files in `packages/adapters-db-mongo/src/models`, the collection references, the open decision register and the page metadata. Adding or removing a model without updating the file fails the build.

## Related pages

Schema Nebula shows which collections exist and how they relate. For fields and indexes, use the [database catalogue](/tools/database-catalogue). For repositories and commands, use the [Mongo adapter map](./current-adapter-map).
