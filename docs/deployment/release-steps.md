---
title: Release Steps
description: The checks and refreshes every release runs before the apps switch, their JSON events, and how to run them locally.
status: implemented
audience: [operator, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/api/src/release-steps.ts
    - packages/core-domain/src/release/release-steps.ts
    - packages/adapters-db-mongo/src/release/database-steps.ts
    - packages/adapters-db-mongo/src/release/data-migrations.ts
    - apps/api/src/search/search-release.ts
    - docker/production/bin/deploy.sh
---

# Release steps

One runner does every refresh a release needs, in order, before the new apps take traffic. A deploy runs it from the new release's image while the old release keeps serving. The first failed step stops the deploy before the switch.

## The steps

| Step (`step`)                                 | Runs          | What it does                                                                                         |
| --------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| System roles and permissions (`system-roles`) | every release | Adds missing system roles and permissions, then checks them. Never overwrites changes made in admin. |
| Database indexes (`database-indexes`)         | when changed  | Creates indexes that the models declare and the database lacks, then checks them.                    |
| Data migrations (`data-migrations`)           | once each     | Runs each migration missing from the `releaseMigrations` ledger and records it there.                |
| Search index (`search-index`)                 | every release | See [Search index](../backend/search-index.md#search-at-release-time).                               |

Data migrations live in `packages/adapters-db-mongo/src/release/data-migrations.ts`. Write each change in two halves across two releases (add, then remove), so the previous release keeps working if a rollback is needed.

## Running it

| Where                | Command                                                               |
| -------------------- | --------------------------------------------------------------------- |
| Deploy               | `node dist/release-steps.js`, called by `deploy.sh` before the switch |
| This computer        | `pnpm local:refresh`                                                  |
| From the API package | `pnpm --filter @saha-textile/api release:steps`                       |

Options:

- `--json` prints one JSON event per line, for tools such as the Release Console.
- `--without-search` leaves the search step out, for a computer with no search engine running.

The runner exits with code 1 at the first failed step.

## JSON events

With `--json`, every line is one event:

```json
{
	"type": "release-step",
	"step": "database-indexes",
	"label": "Database indexes",
	"cadence": "when-changed",
	"phase": "done",
	"detail": "2 created",
	"at": "2026-11-10T07:39:55.635Z",
	"ms": 412
}
```

| Field     | Meaning                                                   |
| --------- | --------------------------------------------------------- |
| `phase`   | `start`, `run`, `check`, `done`, `skip` or `fail`         |
| `cadence` | `every-release`, `when-changed` or `once`                 |
| `detail`  | What the step found or did, in plain words                |
| `at`      | When the event happened                                   |
| `ms`      | Time since the step started, on `done`, `skip` and `fail` |
