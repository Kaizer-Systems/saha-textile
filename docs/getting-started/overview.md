---
title: Overview
description: Start here when maintaining the Saha Textile platform.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Developer portal overview

The developer portal is the private engineering manual for the Saha Textile platform. It describes the business context, architecture, runtime behaviour and operating procedures that engineers need to maintain the system.

## Documentation scope

The portal contains:

- Architecture, repository layout and dependency rules.
- Business journeys for shoppers and operators.
- Guides for the storefront, admin application, API and database.
- Provider reference material for payments.
- Generated references for components, TypeScript types, HTTP operations and database models.

Engineering Live Context is a separate section. It holds the project roadmap, the decision log and progress records.

## Generated references

| Reference                                       | Content                                         | Route                  |
| ----------------------------------------------- | ----------------------------------------------- | ---------------------- |
| [Storybook](/tools/storybook)                   | Storefront, admin and shared Angular components | `/storybook/`          |
| [TypeDoc](/tools/typedoc)                       | Exported contracts and core-domain symbols      | `/typedoc/`            |
| [Scalar](/tools/scalar)                         | HTTP operations generated from OpenAPI          | `/api/reference/`      |
| [Database catalogue](/tools/database-catalogue) | Mongoose models, fields and indexes             | `/database/catalogue/` |

The command palette (⌘K) searches every page. Its index is generated from page front matter at build time.

## Access

The complete portal runs on a local server that accepts loopback connections only and requires a local username and password. See [Developer portal commands](/getting-started/local-development#developer-portal-commands). These credentials belong to the portal server and are unrelated to storefront or admin accounts.

## Resolving conflicts

Tested code describes current behaviour. The decision log describes intended behaviour. If the portal disagrees with either, follow [Source of truth and freshness](/governance/source-of-truth-and-freshness).
