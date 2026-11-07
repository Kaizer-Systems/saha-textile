---
title: Storefront Cutover
description: How catalogue data, search, old addresses and stock alerts fit together.
status: scaffolded
audience: [beginner, backend, operator]
last_verified: '2026-11-07'
source_of_truth:
    - packages/adapters-db-mongo/src/seed/seed-demo-catalogue.ts
    - packages/adapters-db-mongo/src/seed/legacy-addresses.ts
    - apps/api/src/search/meilisearch-search.ts
    - packages/core-domain/src/catalog/weekly-insight.ts
---

# Storefront cutover

This page explains how the storefront's catalogue data, search, old addresses and related features fit together.

## Catalogue data

The storefront reads products from MongoDB through the API. Meilisearch runs as a private container and stores ids and words. Selling prices are always read back from MongoDB. If search is down, category pages render normally and the search box reports that search is unavailable.

## Old addresses

Addresses from the previous website are listed in `packages/adapters-db-mongo/src/seed/legacy-addresses.ts`. The seed writes a row only when it is approved. An unapproved row fails the seed and names itself.

The storefront resolves an old address in one hop. It checks WordPress patterns first, then an exact redirect row, then the same path under `/en` if that page exists. Anything else answers `410`; the home page is never a fallback. Admin operators manage rows on the redirect screen. A retired collection gets an automatic row unless an operator has saved one for it.

## Stock alerts

**Notify me** is a signed-in request for one variant. A guest's click is held in session storage and replayed after sign-in. The worker checks alerts every 15 minutes and sends a message when the variant can be bought.

## Content and relations

FAQ entries and product questions use the admin FAQ and questions screens. Related and upsell products are saved from the product form. Cross-sell and bought-together relations are written by the weekly insight job on the worker, which also assigns the bestseller and trending badges.
