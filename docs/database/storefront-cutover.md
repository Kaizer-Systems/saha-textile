---
title: Storefront cutover
description: What the catalogue cutover added for search, addresses, FAQ, and the home rails.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-11-05'
source_of_truth:
    - packages/adapters-db-mongo/src/seed/seed-demo-catalogue.ts
    - packages/adapters-db-mongo/src/seed/legacy-addresses.ts
    - apps/api/src/search/meilisearch-search.ts
    - apps/api/src/worker/weekly-insight.ts
---

The shop reads products from Mongo. Meilisearch is a private container in the local stack. It stores words and ids. The selling price is read back from Mongo. If search is down, a category page still renders and the search box says search is unavailable.

Old addresses live in `packages/adapters-db-mongo/src/seed/legacy-addresses.ts`. The seed writes a row only when it is approved. An unapproved row fails the seed and names itself. The rows approved on 5 November 2026 are the silk-sarees tag, the old request forms, and `/videos`.

Notify Me is a signed-in request for one variant. A guest click stores a short pending intent and replays it after login. FAQ and product questions use the admin screens that already existed. Related and upsell are saved from the product form. Cross-sell and bought-together are written by the weekly job on the media worker.
