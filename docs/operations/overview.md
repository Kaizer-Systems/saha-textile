---
title: Operations Overview
description: Runtime operations landing page.
status: planned
audience: [operator, backend]
last_verified: '2026-07-26'
source_of_truth:
    - docker/mongo/docker-compose.yml
    - scripts/mongo-up.sh
    - docs/engineering-live-context/execution-roadmap.mdx
    - .cursor/rules/mcp-tools.mdc
---

# Operations overview

Operations docs should cover backups, restores, rollbacks, scheduled jobs, monitoring, logging, incident response, and third-party service checks.

These pages should become mandatory before production deployment.

## What exists now

- **Local MongoDB lifecycle** — a self-hosted Docker MongoDB 8.3 single-node replica set (`rs0`) profile in `docker/mongo/docker-compose.yml`, managed with `pnpm mongo:up | mongo:status | mongo:down | mongo:wipe`. The same profile shape is used locally and in deployments for parity. See [local development](../getting-started/local-development#local-mongodb-docker-replica-set).
- **Configuration-injection model (locked)** — secrets reach the **API container only** (env file / Docker Compose secrets); the Angular apps receive a public `config.json` and never a secret. The automated deploy workflow that performs this injection is not yet written (tracked as a blocked deployment task).

Backups, restore drills, monitoring, and incident runbooks remain planned.
