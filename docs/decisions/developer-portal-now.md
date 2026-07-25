---
title: Start Developer Portal Early
description: ADR for starting the portal before all generated artifacts exist.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-25'
source_of_truth:
    - project-context/angular-context/execution-roadmap.md
    - project-context/angular-context/private-developer-portal-documentation-plan.md
---

# Start developer portal early

## Status

Accepted.

## Context

The roadmap says the Docusaurus developer portal should grow incrementally during every phase. Some portal sections depend on real implementation artifacts, including OpenAPI output, Mongo schemas, Storybook builds, TypeDoc, Scalar API Reference, and Pagefind indexes.

## Decision

Start the portal now with stable structure, navigation, source-of-truth rules, high-level architecture pages, business-flow templates, and placeholders for generated sections.

Defer generated documentation integrations until their source artifacts exist.

## Consequences

- Documentation habits start early.
- Future PRs have a known place to update operator-facing and developer-facing behavior.
- Generated API, database, and component docs are not hand-written prematurely.
- The portal can build before the full app surface is complete.

## Related

- [Decision Gate Console](/decisions/gate-console) — the live cockpit of open owner gates and the roadmap chunks and collections each one blocks.
