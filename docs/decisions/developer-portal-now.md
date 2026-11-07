---
title: Start Developer Portal Early
description: ADR for starting the portal before all generated artifacts exist.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/execution-roadmap.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
    - apps/developer-portal
---

# Start developer portal early

## Status

Accepted.

## Context

The developer portal should grow with the product. Some sections depend on implementation artifacts: OpenAPI output, Mongo schemas, Storybook builds and TypeDoc.

## Decision

Start the portal with stable structure, navigation, source-of-truth rules, architecture pages and business-flow pages. Add a generated reference only when its source exists, and label it **Scaffolded** until it meets its completion criteria.

## Consequences

- Documentation is written alongside the code.
- Each change has a known place for operator and developer documentation.
- Storybook and TypeDoc are generated from source. Scalar and the database catalogue are generated and carry the **Scaffolded** status.
- The portal builds before the full application surface is complete.
- The complete portal runs behind a local sign-in. That sign-in is loopback-only and separate from the API, MongoDB and customer accounts.
- `DEC-PORTAL-PRIVATE-ACCESS` covers hosted access. The local sign-in does not settle that decision.

## Related

- [Decision Gate Console](/decisions/gate-console)
