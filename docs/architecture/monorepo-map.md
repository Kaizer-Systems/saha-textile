---
title: Monorepo Map
description: Workspace package ownership and responsibilities.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-03'
source_of_truth:
    - pnpm-workspace.yaml
    - turbo.json
    - docker/mongo/docker-compose.yml
    - docker/redis/compose.yaml
    - docker/stack/compose.yaml
    - packages
    - scripts
    - AGENTS.md
---

# Monorepo map

| Path                                    | Responsibility                                                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `apps/api`                              | NestJS Fastify API and composition root                                                                           |
| `apps/admin`                            | Angular/Analog admin panel                                                                                        |
| `apps/storefront`                       | Angular/Analog storefront                                                                                         |
| `apps/developer-portal`                 | Private Docusaurus developer portal                                                                               |
| `apps/developer-portal-storybook`       | Single Angular Storybook renderer for Storefront, Admin, and Shared component contexts                            |
| `apps/developer-portal-typedoc`         | Narrow TypeDoc child for exported contracts and core-domain symbols                                               |
| `apps/developer-portal-scalar`          | Scalar child for the source-generated OpenAPI reference and governed Test Request                                 |
| `packages/contracts`                    | Zod schemas and shared API request/response shapes                                                                |
| `packages/core-domain`                  | Entities, value objects, use cases, and port interfaces                                                           |
| `packages/http-transport`               | Framework-free browser CSRF, refresh coordination, request-id and safe-error policy                               |
| `packages/adapters-db-mongo`            | Mongo persistence adapter and seed tooling                                                                        |
| `packages/adapters-notifications-msg91` | MSG91 `NotificationPort` adapter (email / SMS Flow / WhatsApp tools; Authkey from API env)                        |
| `packages/adapters-auth`                | Google and Facebook token verifiers for social sign-in                                                            |
| `packages/adapters-storage-spaces`      | DigitalOcean Spaces `StoragePort` (presigned PUT, private originals, public derivatives)                          |
| `packages/adapters-image-sharp`         | sharp `ImageCodecPort`: decode, resize ladder, WebP/JPEG, blur fill, ThumbHash                                    |
| `packages/adapters-queue-bullmq`        | BullMQ `MediaJobQueuePort` on Redis, plus the worker's schedulers                                                 |
| `packages/adapters-cdn-cloudflare`      | Cloudflare `CdnPurgePort` (purge by URL)                                                                          |
| `packages/adapters-youtube`             | YouTube Data API `YouTubePort` (channel uploads, video check)                                                     |
| `packages/config`                       | Shared TypeScript, lint, and style configuration                                                                  |
| `docker/mongo`                          | Local Docker MongoDB 9.0.4 single-node replica-set (`rs0`) profile                                                |
| `docker/redis`                          | Local Redis for the media queue (`pnpm redis:up`)                                                                 |
| `docker/images`, `docker/stack`         | Production-shaped images (API/worker, storefront, admin) and the local HTTPS stack behind Nginx (`pnpm stack:up`) |
| `scripts`                               | Repo lifecycle, naming, portal validation, local portal auth, and atomic composite runtime                        |
| `docs`                                  | Human-authored portal content plus governed data for generated documentation                                      |
| `docs/engineering-live-context`         | Planning and architecture source material                                                                         |

## Documentation ownership

Application and package changes that alter behavior should include portal updates in the same PR when the behavior is operator-visible, business-visible, or integration-visible.

`pnpm build:product-apps` targets only Storefront, Admin, and API. The unfiltered root build may include developer-portal workspaces and is not the deployment command for a portal-free product release.
