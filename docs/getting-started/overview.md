---
title: Overview
description: Start here when maintaining the Saha Textile platform.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-26'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Developer portal overview

This portal is the private operating manual for the Saha Textile platform. It should explain enough business context, architecture, runtime behavior, and operational procedure for another developer to maintain the system without reverse-engineering the repository first.

## What belongs here now

- Stable decisions from `docs/engineering-live-context`.
- Monorepo maps, phase boundaries, and dependency rules.
- Business flows at the level already locked by the knowledge base.
- Generated Storybook and TypeDoc children plus visibly scaffolded current-evidence Scalar and MongoDB catalogue surfaces.

## What waits for implementation

- Scalar renders the current generated OpenAPI at the locked route; the operation contract remains scaffolded until its completeness gates pass.
- Generated database collection pages wait for the catalogue generator; models and indexes already exist in the Mongo adapter.
- Storybook links wait until storefront/admin components and stories exist.
- Pagefind remains a deferred optional full-text layer. The current ⌘K palette already receives a build-generated index from every page's frontmatter, so new routes appear without maintaining a static command list.

## Source-of-truth rule

Use [Source of Truth and Freshness](/governance/source-of-truth-and-freshness) to resolve conflicts. The portal presents evidence; it does not override tested implementation or locked owner decisions.
