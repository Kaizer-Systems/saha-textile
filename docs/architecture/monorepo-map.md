---
title: Monorepo Map
description: Workspace package ownership and responsibilities.
---

# Monorepo map

| Path                              | Responsibility                                                    |
| --------------------------------- | ----------------------------------------------------------------- |
| `apps/api`                        | NestJS Fastify API and composition root                           |
| `apps/admin`                      | Angular/Analog admin panel                                        |
| `apps/storefront`                 | Angular/Analog storefront                                         |
| `apps/developer-portal`           | Private Docusaurus developer portal                               |
| `packages/contracts`              | Zod schemas and shared API request/response shapes                |
| `packages/core-domain`            | Entities, value objects, use cases, and port interfaces           |
| `packages/adapters-db-mongo`      | Mongo persistence adapter and seed tooling                        |
| `packages/config`                 | Shared TypeScript, lint, and style configuration                  |
| `docs`                            | Human-authored portal content plus future generated documentation |
| `project-context/angular-context` | Planning and architecture source material                         |

## Documentation ownership

Application and package changes that alter behavior should include portal updates in the same PR when the behavior is operator-visible, business-visible, or integration-visible.
