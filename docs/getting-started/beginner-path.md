---
title: Beginner Path
description: First-day orientation for the repository, architecture, and contribution workflow.
status: implemented
audience: [beginner]
last_verified: '2026-08-09'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Beginner path

Use this path if the repository is unfamiliar, the architecture vocabulary is new, or you are unsure which application owns a behaviour.

## Repository orientation

Saha Textile is one repository containing four application surfaces:

| Surface          | Who uses it          | What it owns                                                               |
| ---------------- | -------------------- | -------------------------------------------------------------------------- |
| Storefront       | Shoppers             | Catalogue browsing, product detail, cart, account and checkout experiences |
| Admin            | Staff                | Catalogue, order, customer, content and operational workflows              |
| API              | Storefront and admin | Authentication, validation, application orchestration and HTTP contracts   |
| Developer portal | Maintainers          | Architecture, workflows, references, runbooks and decision history         |

Shared packages hold domain rules, contracts, configuration and edge adapters. The most important architectural rule is simple: dependencies point inward toward the domain. User interfaces call the API; they do not call database or payment adapters directly.

## Initial reading sequence

Read these pages in order:

1. [Developer portal overview](/getting-started/overview)
2. [System overview](/architecture/system-overview)
3. [Monorepo map](/architecture/monorepo-map)
4. [Business and commerce journey atlas](/business-flows/overview)
5. [Backend platform atlas](/backend/overview)
6. [Status model](/governance/status-model)
7. [Local development](/getting-started/local-development)

Do not begin by reading every directory. First identify the application, route, state/query boundary and backend contract involved in your task.

## A safe first change

For an initial contribution:

1. Choose a small documentation or presentation-only change.
2. Locate its source-of-truth files from the page provenance strip.
3. Keep the change inside one architectural layer.
4. Run the relevant formatter, type check and focused tests.
5. Update the associated portal page in the same change when behaviour changed.

## Escalation boundaries

Stop before making assumptions about pricing, authentication, authorization, payment, inventory, persistence shape, customer data, production infrastructure or a page marked **Planned**, **Deferred** or **Deprecated**.
