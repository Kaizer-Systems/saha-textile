---
title: Search Index
description: The versioned Meilisearch index, the search change queue, search at release time and the nightly check.
status: implemented
audience: [backend, operator]
last_verified: '2026-11-10'
source_of_truth:
    - apps/api/src/search/search-index-version.ts
    - apps/api/src/search/meilisearch-search.ts
    - apps/api/src/search/search-release.ts
    - apps/api/src/rebuild-search-index.ts
    - apps/api/src/worker/media-worker.ts
    - packages/core-domain/src/catalog/search-sync.ts
    - packages/core-domain/src/ports/search-outbox.repository.ts
    - packages/adapters-db-mongo/src/release/search-marker.ts
---

# Search index

MongoDB is the source of truth. The Meilisearch index is derived from it and can always be rebuilt. This page covers how the index is named and built, how product changes reach it, what happens to search during a release, and the nightly check.

## Versioned index

The index name carries a version: `products_v<SEARCH_INDEX_VERSION>`, for example `products_v1`. The version lives in `apps/api/src/search/search-index-version.ts`.

- Raise `SEARCH_INDEX_VERSION` only when the index's fields or settings change. A new version is built beside the live one, while the shop keeps reading the old index.
- Each build is recorded in `<base>_builds` with its version, product count and finish time. Reads switch to the new version only once its build record is complete.
- The previous version is kept for rollback; older versions are removed.
- Waiting on Meilisearch follows task progress. A build fails when a task fails or when no progress is seen for 60 seconds, not after a fixed total time, so a large catalogue does not fail a release.

## Change queue

Product saves reach the index through a queue in MongoDB, `searchOutbox`, so a save never waits for search and a change is never lost while search is down.

- The queue row is written in the same transaction as the product save, one row per product.
- The worker drains the queue every 30 seconds. A failed row is retried with backoff from 30 seconds up to 30 minutes.
- Finished rows are kept for 14 days, then removed by a TTL index.
- After an index build, the queue is replayed, so changes made during the build are not lost. The worker also catches up once when it starts.
- `GET /health/ready` reports search as `degraded`, with the queue size and oldest waiting change, when the index is unreachable. The shop keeps selling; `GET /catalog/search` answers 503.

## Search at release time

The release steps include a search step (see [Release steps](../deployment/release-steps.md)).

- If this release's search version is already built, the step only applies current settings and search words.
- If it is missing, the step builds it before the apps switch.
- If Meilisearch is down and the search version has not changed, the release goes ahead with search marked `degraded`; queued changes are applied when search returns. A release that needs a new search version waits for search.
- The deployed version is recorded in the `releaseMarkers` collection.

## Nightly check

At 03:00 IST the worker compares the index with MongoDB. It queues live products missing from the index, index entries without a matching live product, and every product changed in the last day; the next drain repairs them like any other change. Each result (live, indexed, missing, extra, recent, queued) is stored in `searchChecks` for 90 days.

## Commands

| Command                                                    | What it does                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm --filter @saha-textile/api search:rebuild`           | Rebuilds this version's index from MongoDB. Safe to repeat.                            |
| `pnpm --filter @saha-textile/api search:rebuild --release` | Builds only when this version is missing; otherwise applies settings and search words. |
| `pnpm local:refresh`                                       | Runs every release step on this computer, search included.                             |
