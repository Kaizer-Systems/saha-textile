---
title: Release Console
description: The owner's dashboard for releases and servers, its local API, how to run it, and how it is checked.
status: scaffolded
audience: [operator, frontend, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/release-console
    - apps/release-console-api
    - packages/release-console-contracts
    - .github/workflows/ci.yml
---

# Release Console

The Release Console is an owner-only dashboard for releases, servers and cloud accounts. It runs only on the owner's computer and is never deployed or published as an image. It is in English only.

| Part          | Package                              | Where it runs                                 |
| ------------- | ------------------------------------ | --------------------------------------------- |
| Console app   | `apps/release-console`               | Angular, client-only, `http://localhost:4400` |
| Local API     | `apps/release-console-api`           | NestJS on Fastify, `http://127.0.0.1:4410`    |
| Shared shapes | `packages/release-console-contracts` | zod schemas used by both                      |

## Running it

```bash
pnpm console
```

This starts the app and its API together. The `release-console` and `release-console-api` entries in `.claude/launch.json` start them one at a time.

## Local API

The API listens on `127.0.0.1` only and accepts browser requests only from the console page (`CONSOLE_ORIGIN`, default `http://localhost:4400`). It reads; it changes nothing.

| Route                      | Answer                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `GET /api/health`          | `{ status: 'ok', version }`                                                           |
| `GET /api/local/services`  | Every container of the local stack from Docker: state, health, uptime, CPU and memory |
| `GET /api/local/readiness` | The shop API's `/health/ready` answer: `ok`, `degraded` or `down`                     |

Every answer is parsed with the shared zod schemas before the app uses it.

| Setting                   | Default                              |
| ------------------------- | ------------------------------------ |
| `CONSOLE_API_PORT`        | `4410`                               |
| `CONSOLE_ORIGIN`          | `http://localhost:4400`              |
| `CONSOLE_STACK_PREFIX`    | `saha-textile`                       |
| `CONSOLE_LOCAL_READY_URL` | `http://localhost:4000/health/ready` |

## The app

The app shows the approved menu with its search (⌘K). Items the console cannot do are red and disabled, with a note to use the provider's own portal; items it can do in part are yellow. Overview and Services read live data from the local stack. Screens without live data describe what they will show.

## Checks

The shop's CI skips the console. A separate `console` job runs `pnpm check:console` (lint, types, tests and build) only when a pull request changes the console packages or shared setup files such as the lock file, root `package.json`, `turbo.json` or the CI file.
