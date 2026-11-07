---
title: Maintenance Overview
description: Routine maintenance for dependencies, schemas, permissions and translations.
status: planned
audience: [frontend, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - package.json
    - docs/engineering-live-context/execution-roadmap.mdx
---

# Maintenance overview

This page describes routine maintenance for the platform.

## Dependency upgrades

Versions are pinned. Do not upgrade a major version silently.

1. Read the dependency's release notes.
2. Upgrade in a dedicated change.
3. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm e2e`.
4. Update the portal if behaviour changes.

## Schema and index changes

Follow [Migration discipline](/database/transactions-and-generation#migration-discipline). After changing a model:

1. Update `collection-names.ts` for a new collection.
2. Update `docs/_data/instruments/schema-nebula.json`.
3. Regenerate the catalogue.
4. Run `pnpm mongo:reconcile-indexes` in each environment.

## Adding a permission

1. Add the code to `packages/contracts/src/permission.ts`.
2. Declare it on the route with `@RequirePermissions`.
3. Run `seed:system-roles` in each environment, or existing administrators will not hold it.

## API compatibility

Follow the [evolution rules](/backend/contracts-and-validation#evolution-rules). Run `pnpm --filter @saha-textile/api check:openapi` after route changes.

## Translations

Add every key to both `en.json` and `fr.json`. `pnpm check:i18n-parity` enforces this.

## Security

- Run `pnpm audit` regularly.
- Rotate secrets on the schedule in the operations runbook, and at once after a suspected leak.
- Keep Docker base images pinned.

## Planned coverage

Release checklists and payment-provider change procedures are planned.
