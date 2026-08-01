---
title: Start Developer Portal Early
description: ADR for starting the portal before all generated artifacts exist.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-01'
source_of_truth:
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - apps/developer-portal
---

# Start developer portal early

## Status

Accepted.

## Context

The roadmap says the Docusaurus developer portal should grow incrementally during every phase. Some portal sections depend on real implementation artifacts, including OpenAPI output, Mongo schemas, Storybook builds, TypeDoc, Scalar API Reference, and Pagefind indexes.

## Decision

Start the portal with stable structure, navigation, source-of-truth rules, high-level architecture pages, business-flow templates, and evidence-gated generated sections. Integrate a generated surface only when its source artifact exists, and keep its lifecycle visibly scaffolded until the documented promotion gate passes.

## Consequences

- Documentation habits start early.
- Future PRs have a known place to update operator-facing and developer-facing behavior.
- Storybook and TypeDoc are generated from current source; Scalar and the database catalogue are generated but visibly scaffolded behind their evidence gates.
- The portal can build before the full app surface is complete.

## Related

- [Decision Gate Console](/decisions/gate-console) — the live cockpit of unresolved decision gates and the roadmap chunks and collections each one blocks.
