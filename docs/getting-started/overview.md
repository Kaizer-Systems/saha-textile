---
title: Overview
description: Start here when maintaining the Saha Textile platform.
---

# Developer portal overview

This portal is the private operating manual for the Saha Textile platform. It should explain enough business context, architecture, runtime behavior, and operational procedure for another developer to maintain the system without reverse-engineering the repository first.

## What belongs here now

- Stable decisions from `project-context/angular-context`.
- Monorepo maps, phase boundaries, and dependency rules.
- Business flows at the level already locked by the knowledge base.
- Placeholders for generated API, database, and UI documentation.

## What waits for implementation

- OpenAPI and Redoc output wait until `apps/api` exposes the finished controller surface.
- Database collection pages wait until Mongo schemas and indexes exist in the adapter.
- Storybook links wait until storefront/admin components and stories exist.
- Pagefind waits until the portal has enough built pages to index usefully.

## Source-of-truth rule

When portal content conflicts with code or `project-context/angular-context`, treat the portal as stale and update it in the same PR as the code change.
