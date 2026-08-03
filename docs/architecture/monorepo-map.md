---
title: Monorepo Map
description: Workspace package ownership and responsibilities.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-08-02'
source_of_truth:
    - pnpm-workspace.yaml
    - turbo.json
    - docker/mongo/docker-compose.yml
    - scripts
    - AGENTS.md
---

# Monorepo map

| Path                              | Responsibility                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/api`                        | NestJS Fastify API and composition root                                                    |
| `apps/admin`                      | Angular/Analog admin panel                                                                 |
| `apps/storefront`                 | Angular/Analog storefront                                                                  |
| `apps/developer-portal`           | Private Docusaurus developer portal                                                        |
| `apps/developer-portal-storybook` | Single Angular Storybook renderer for Storefront, Admin, and Shared component contexts     |
| `apps/developer-portal-typedoc`   | Narrow TypeDoc child for exported contracts and core-domain symbols                        |
| `packages/contracts`              | Zod schemas and shared API request/response shapes                                         |
| `packages/core-domain`            | Entities, value objects, use cases, and port interfaces                                    |
| `packages/adapters-db-mongo`      | Mongo persistence adapter and seed tooling                                                 |
| `packages/config`                 | Shared TypeScript, lint, and style configuration                                           |
| `docker/mongo`                    | Local Docker MongoDB 8.3 single-node replica-set (`rs0`) profile                           |
| `scripts`                         | Repo lifecycle, naming, portal validation, and atomic persistent composite-runtime scripts |
| `docs`                            | Human-authored portal content plus governed data for generated documentation               |
| `docs/engineering-live-context`   | Planning and architecture source material                                                  |

## Documentation ownership

Application and package changes that alter behavior should include portal updates in the same PR when the behavior is operator-visible, business-visible, or integration-visible.
