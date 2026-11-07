---
title: Operations Overview
description: Available operational tools, background jobs and required runbooks.
status: planned
audience: [operator, backend]
last_verified: '2026-11-07'
source_of_truth:
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - docs/engineering-live-context/execution-roadmap.mdx
    - .cursor/rules/mcp-tools.mdc
---

# Operations overview

This page lists the operational tools available, and the runbooks required before production.

## Available operations

| Area                | Tool                                                                                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local MongoDB       | `pnpm mongo:up`, `mongo:status`, `mongo:down`, `mongo:wipe`. See [local development](../getting-started/local-development#local-mongodb-docker-replica-set) |
| Local stack         | `pnpm stack:up`, `stack:status`, `stack:logs`, `stack:down`. See [Deployment overview](/deployment/overview)                                                |
| Health              | `/health/live` and `/health/ready`                                                                                                                          |
| First administrator | `pnpm --filter @saha-textile/api bootstrap:first-admin -- --email <address>`                                                                                |
| System roles        | `pnpm --filter @saha-textile/adapters-db-mongo seed:system-roles`. Run this after adding a permission                                                       |
| Database indexes    | `pnpm mongo:reconcile-indexes`                                                                                                                              |
| Search index        | `pnpm --filter @saha-textile/api search:rebuild`. Safe to repeat. Run on a fresh index and after bulk catalogue changes                                     |

## Background jobs

The worker runs from the API image with `node dist/worker.js`, and uses the BullMQ queue `saha-textile-media` on Redis. Concurrency comes from `MEDIA_WORKER_CONCURRENCY`, default 2.

| Job               | Schedule           | Effect                                                       |
| ----------------- | ------------------ | ------------------------------------------------------------ |
| `process`         | On upload          | Decodes an original and renders every size                   |
| `reprocess`       | On demand          | Regenerates sizes from the retained original                 |
| `delete-objects`  | On demand          | Deletes storage objects and purges their CDN URLs            |
| `purge`           | On demand          | Purges CDN URLs                                              |
| `reprocess-stale` | Every 15 minutes   | Queues assets whose size role changed, in batches of 50      |
| `stock-alerts`    | Every 15 minutes   | Sends **Notify me** messages for variants that can be bought |
| `gc`              | Daily, 03:30 IST   | Soft-deletes orphaned media, and removes files after 30 days |
| `youtube-refresh` | Daily, 00:00 IST   | Refreshes the cached channel feed                            |
| `weekly-insight`  | Mondays, 04:00 IST | Writes badges and bought-together relations from paid orders |

Failed jobs retry five times with exponential backoff, starting at 10 seconds. Completed jobs are kept for a day and failed jobs for a week. A repeated `process` or `reprocess` request for the same asset collapses into one job.

`gc` runs as a dry run until `MEDIA_GC_LIVE` is true. Each run writes an audit record.

## Configuration

Secrets reach only the containers that need them, and Angular applications receive a public `config.json`. See [Deployment overview](/deployment/overview#runtime-configuration-and-secrets-model).

## Required runbooks

These runbooks are required before production:

- Deployment and rollback.
- Backup and restore.
- Secret rotation.
- Monitoring and alerting.
- Incident response.
- Third-party service checks.

## Limitations

The worker has no health endpoint. Logs go to Docker's default driver. No monitoring or alerting is configured.
