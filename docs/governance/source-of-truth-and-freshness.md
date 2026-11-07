---
title: Source of Truth and Freshness
description: Authority, conflict resolution and review timing for portal content.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - scripts/validate-developer-portal.mjs
---

# Source of truth and freshness

The portal is a maintained view of the system. This page defines which source answers which question and when a page needs review.

## Authority by question

| Question                                        | Primary authority                                       |
| ----------------------------------------------- | ------------------------------------------------------- |
| Which product and architecture decisions apply? | `docs/engineering-live-context/owner-decisions-log.mdx` |
| What architecture is intended?                  | Knowledge-base documents in Engineering Live Context    |
| What behaviour exists?                          | Tested code and observed runtime behaviour              |
| What shape crosses an API boundary?             | zod contracts and generated OpenAPI                     |
| What shape is persisted?                        | Adapter models, validators, indexes and migrations      |
| What must pass before delivery?                 | `execution-roadmap.mdx`, tests and CI rules             |
| How should a maintainer understand it?          | This portal                                             |

## Conflict rule

When sources disagree:

1. Do not choose the most convenient source.
2. Work out whether the difference is planned behaviour or an error.
3. Follow the decision log for intended behaviour and tested code for existing behaviour.
4. Label the gap as scaffolded, planned, deferred or deprecated.
5. Correct the portal and the affected sources in the same change.

## When to review a page

Review a page when any of these change:

- A route, contract or authorization rule.
- A domain use case or port.
- A persistence model, index or migration.
- A user or operator workflow.
- An environment variable, deployment step or recovery procedure.
- A third-party integration or security control.
- A product or architecture decision.
- A major dependency that changes documented behaviour.

## Review intervals

| Page risk                                     |                             Maximum interval |
| --------------------------------------------- | -------------------------------------------: |
| Security, auth, payment, deployment, recovery |                                      30 days |
| API, persistence, business workflow           |                                      60 days |
| Architecture and onboarding                   |                                      90 days |
| Decision record                               | When superseded or a linked decision changes |

The `last_verified` date records a review. It is meaningful only if someone compared the page with its sources.

## Automated freshness check

`scripts/validate-developer-portal.mjs` applies these rules:

1. Every `source_of_truth` path must exist.
2. The validator reads the latest Git change date for each declared file or directory.
3. A working-tree change counts as today.
4. A page fails when `last_verified` is older than any declared source.
5. Internal routes and anchors are checked in the same run.

A directory source means any change below it requires review. Prefer exact files when a page depends on a narrow area. Compare the page with the changed source before you advance `last_verified`.

Interactive components have a stricter check. Their manifest, data file, page front matter and compiled output are compared during validation and during the Docusaurus build.
