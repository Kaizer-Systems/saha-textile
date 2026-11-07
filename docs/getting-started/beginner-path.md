---
title: Beginner Path
description: First-day orientation for the repository, architecture, and contribution workflow.
status: implemented
audience: [beginner]
last_verified: '2026-11-07'
source_of_truth:
    - AGENTS.md
    - docs/engineering-live-context/saha-textile-technical-knowledgebase.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Beginner path

Use this path if the repository is new to you, or if you are unsure which application owns a behaviour.

## Repository orientation

Saha Textile is one repository containing four applications:

| Application      | Used by              | Responsibility                                                     |
| ---------------- | -------------------- | ------------------------------------------------------------------ |
| Storefront       | Shoppers             | Catalogue browsing, product detail, cart, account and checkout     |
| Admin            | Staff                | Catalogue, order, customer, content and operational workflows      |
| API              | Storefront and admin | Authentication, validation, business operations and HTTP contracts |
| Developer portal | Engineers            | Architecture, workflows, references and procedures                 |

Shared packages hold domain rules, contracts, configuration and adapters. Dependencies point inward toward the domain. User interfaces call the API; they never call database or payment adapters directly.

## Initial reading sequence

Read these pages in order:

1. [Developer portal overview](/getting-started/overview)
2. [System overview](/architecture/system-overview)
3. [Monorepo map](/architecture/monorepo-map)
4. [Business and commerce journey atlas](/business-flows/overview)
5. [Backend platform atlas](/backend/overview)
6. [Status model](/governance/status-model)
7. [Local development](/getting-started/local-development)

You do not need to read every directory. Start by identifying the application, route, state boundary and API contract that your task involves.

## A safe first change

1. Choose a small documentation or presentation change.
2. Find its source files in the list at the top of the relevant page.
3. Keep the change inside one architectural layer.
4. Run the formatter, type check and focused tests.
5. Update the matching portal page in the same change if behaviour changed.

## When to ask first

Ask before making assumptions about pricing, authentication, authorization, payment, inventory, persistence shape, customer data, production infrastructure, or anything on a page marked **Planned**, **Deferred** or **Deprecated**.
