---
title: Source of Truth and Freshness
description: Authority, conflict resolution and review timing for portal content.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-09'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - scripts/validate-developer-portal.mjs
---

# Source of truth and freshness

`docs/engineering-live-context/` is the portal-visible canonical source set.
The rest of the portal is a maintained view of authoritative evidence and is
not allowed to become an independent version of the system.

## Authority by question

| Question                                               | Primary authority                                       |
| ------------------------------------------------------ | ------------------------------------------------------- |
| Which product and architecture decisions are ratified? | `docs/engineering-live-context/owner-decisions-log.mdx` |
| What architecture is intended?                         | Current Angular knowledge-base documents and ADRs       |
| What behaviour exists now?                             | Tested code and observed runtime behaviour              |
| What shape crosses an API boundary?                    | zod contracts and generated OpenAPI                     |
| What shape is persisted?                               | Adapter models, validators, indexes and migrations      |
| What must pass before delivery?                        | `execution-roadmap.mdx`, tests and CI rules             |
| How should a maintainer understand it?                 | Canonical Live Context plus derived portal guidance     |

## Conflict rule

When sources disagree:

1. Do not silently choose the most convenient source.
2. Determine whether the disagreement is intended design versus current implementation, or simple drift.
3. Follow the ratified decision for intended direction and tested code for claims about current behaviour.
4. Label the gap explicitly as scaffolded, planned, deferred or deprecated.
5. Reconcile the portal and affected source documents in the same coherent change.

## Freshness triggers

A page must be reverified when any of the following changes:

- a route, request/response contract or authorization rule;
- a domain use case or port;
- a persistence model, index or migration;
- a user or operator workflow;
- an environment variable, deployment step or recovery procedure;
- a third-party integration or security control;
- a ratified product or architecture decision;
- a major dependency that changes documented behaviour.

## Review intervals

| Page risk                                     |               Maximum unattended interval |
| --------------------------------------------- | ----------------------------------------: |
| Security, auth, payment, deployment, recovery |                                   30 days |
| API, persistence, business workflow           |                                   60 days |
| Architecture and onboarding                   |                                   90 days |
| Historical ADR                                | On supersession or linked-decision change |

The date is a review signal, not proof by itself. A recent date without named sources and actual verification is not acceptable provenance.

## Automated freshness boundary

`scripts/validate-developer-portal.mjs` makes the declared evidence graph executable:

1. every `source_of_truth` path must exist;
2. the validator reads the latest Git change date for each declared file or directory;
3. a working-tree change counts as today because it is newer than committed evidence;
4. the page fails validation when `last_verified` predates any declared evidence;
5. internal routes and anchors are checked in the same run.

A directory source is deliberately conservative: any changed file below it requires reverification. Prefer exact files when only a narrow behavior supports the page; retain a directory when the page genuinely summarizes that whole area. Never advance `last_verified` merely to silence the gate—compare the claims with the changed evidence and fix any drift first.

Governed interactive instruments add a stricter layer. Their manifest, authored dataset, KB/progress evidence, page frontmatter, component binding, and compiled global data are cross-checked during validation and again during the Docusaurus build.
