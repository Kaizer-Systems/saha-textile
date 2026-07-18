---
title: Source of Truth and Freshness
description: Authority, conflict resolution and review timing for portal content.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-07-18'
source_of_truth:
    - AGENTS.md
    - project-context/angular-context/owner-decisions-log.md
    - project-context/angular-context/private-developer-portal-documentation-plan.md
---

# Source of truth and freshness

The portal is a maintained view of authoritative evidence. It is not allowed to become an independent version of the system.

## Authority by question

| Question                               | Primary authority                                        |
| -------------------------------------- | -------------------------------------------------------- |
| What has the owner locked?             | `project-context/angular-context/owner-decisions-log.md` |
| What architecture is intended?         | Current Angular knowledge-base documents and ADRs        |
| What behaviour exists now?             | Tested code and observed runtime behaviour               |
| What shape crosses an API boundary?    | zod contracts and generated OpenAPI                      |
| What shape is persisted?               | Adapter models, validators, indexes and migrations       |
| What must pass before delivery?        | `execution-roadmap.md`, tests and CI rules               |
| How should a maintainer understand it? | This portal, derived from the authorities above          |

## Conflict rule

When sources disagree:

1. Do not silently choose the most convenient source.
2. Determine whether the disagreement is intended design versus current implementation, or simple drift.
3. Follow the owner decision for intended direction and tested code for claims about current behaviour.
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
- a locked owner decision;
- a major dependency that changes documented behaviour.

## Review intervals

| Page risk                                     |               Maximum unattended interval |
| --------------------------------------------- | ----------------------------------------: |
| Security, auth, payment, deployment, recovery |                                   30 days |
| API, persistence, business workflow           |                                   60 days |
| Architecture and onboarding                   |                                   90 days |
| Historical ADR                                | On supersession or linked-decision change |

The date is a review signal, not proof by itself. A recent date without named sources and actual verification is not acceptable provenance.
