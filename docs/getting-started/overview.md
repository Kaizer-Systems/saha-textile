---
title: Overview
description: Start here when maintaining the Saha Textile platform.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - project-context/angular-context/private-developer-portal-documentation-plan.md
    - project-context/angular-context/owner-decisions-log.md
---

# Developer portal overview

This portal is the private operating manual for the Saha Textile platform. It should explain enough business context, architecture, runtime behavior, and operational procedure for another developer to maintain the system without reverse-engineering the repository first.

## What belongs here now

- Stable decisions from `project-context/angular-context`.
- Monorepo maps, phase boundaries, and dependency rules.
- Business flows at the level already locked by the knowledge base.
- Placeholders for generated API, database, and UI documentation.

## What waits for implementation

- Scalar API Reference waits for the real OpenAPI document to be integrated into the portal at the locked route.
- Generated database collection pages wait for the catalogue generator; models and indexes already exist in the Mongo adapter.
- Storybook links wait until storefront/admin components and stories exist.
- Pagefind waits until the portal has enough built pages to index usefully.

## Source-of-truth rule

Use [Source of Truth and Freshness](/governance/source-of-truth-and-freshness) to resolve conflicts. The portal presents evidence; it does not override tested implementation or locked owner decisions.
