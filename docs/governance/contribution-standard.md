---
title: Documentation Contribution Standard
description: Definition of done for developer portal changes.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-08-09'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - scripts/validate-developer-portal.mjs
---

# Documentation contribution standard

Documentation is part of implementation, not a cleanup phase after implementation.

## A portal update is required when

- user-visible or operator-visible behaviour changes;
- a route, state owner, query boundary or API operation changes;
- a contract, schema, index or lifecycle rule changes;
- a security, authorization, payment or privacy rule changes;
- a deployment, rollback, backup or troubleshooting step changes;
- a new architectural decision is accepted or an old one is superseded;
- a planned surface becomes scaffolded or implemented.

## Required page metadata

Every Markdown/MDX page must declare:

- `status` using the five-state model;
- `audience` using one or more portal audience names;
- `last_verified` as an ISO date;
- `source_of_truth` as one or more repository paths.

The portal renders these values near the page title. Validation rejects missing or unsupported values, missing evidence paths, and a verification date older than a declared source's latest Git/working-tree change.

For interactive instruments, project facts belong in the governed manifest/dataset and KB truth pipeline—not in React components. Extend `docs/_data/portal-manifest.json`, the relevant `docs/_data/instruments/*.json`, and the shared portal-data compiler together.

## Writing standard

Write for a competent developer who is new to this repository:

1. Lead with what the reader can accomplish.
2. Define project-specific terms before using abbreviations.
3. Separate current behaviour from intended behaviour.
4. Use exact repository paths, commands, routes and evidence.
5. Explain failure states, recovery and authorization boundaries.
6. Prefer diagrams for cross-layer flows and tables for exact mappings.
7. Never include secrets, real customer data or unsafe production instructions.

## Pull-request checklist

- [ ] Status, audience, verification date and sources are accurate.
- [ ] Current and future behaviour are visibly separated.
- [ ] Local links build without errors.
- [ ] Commands were run or clearly labelled as examples.
- [ ] Diagrams match the prose and dependency direction.
- [ ] The portal content validator passes.
- [ ] The production portal build passes.
- [ ] Desktop and mobile reading remain usable after structural UI changes.
