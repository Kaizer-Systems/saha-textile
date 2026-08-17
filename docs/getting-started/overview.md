---
title: Overview
description: Start here when maintaining the Saha Textile platform.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-18'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Developer portal overview

This portal is the private engineering manual for the Saha Textile platform. It provides the business context, architecture, runtime behavior, operational procedures, and evidence boundaries required to understand and maintain the system.

## Documentation scope

- Stable decisions from `docs/engineering-live-context`.
- Monorepo maps, phase boundaries, and dependency rules.
- Business flows at the level ratified by the canonical knowledge base.
- Generated Storybook and TypeDoc children plus visibly scaffolded current-evidence Scalar and MongoDB catalogue surfaces.

## Generated-reference boundaries

- Scalar renders the current generated OpenAPI at its stable route; the operation contract remains scaffolded until its completeness gates pass.
- The source-generated database catalogue renders all 40 current Mongoose models, but stays scaffolded until its model, mapping, migration, retention, and validator gates pass.
- Storybook is built with one Angular renderer and a green 140/140 reusable-component coverage gate; application-shell behavior remains integration-test scope.
- Pagefind remains a deferred optional full-text layer. The current ⌘K palette already receives a build-generated index from every page's frontmatter, so new routes appear without maintaining a static command list.

## Source-of-truth rule

Use [Source of Truth and Freshness](/governance/source-of-truth-and-freshness) to resolve conflicts. The portal presents evidence; it does not override tested implementation or ratified engineering decisions.
