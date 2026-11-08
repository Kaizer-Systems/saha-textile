---
title: Storefront Search
wide: true
description: How the menu-bar search, the Search page and the suggestion box work, and what search records.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-08'
source_of_truth:
    - apps/storefront/src/app/shared/ui/search-suggest
    - apps/storefront/src/app/layout/header/widgets/search
    - apps/storefront/src/app/features/page/search
    - apps/storefront/src/app/core/search/search-history.ts
    - apps/api/src/catalog/catalog-search.controller.ts
    - apps/api/src/catalog/search-insights.service.ts
    - packages/core-domain/src/catalog/search-analytics.ts
    - packages/adapters-db-mongo/src/repositories/search-analytics.repository.ts
---

# Storefront search

Shoppers search from two places: the bar that opens from the search icon in the header (tablet and desktop), and the Search page at `/search` (every width; the phone's bottom bar opens it). Both use one suggestion box, `app-search-suggest`, and both read `GET /catalog/search`, which Meilisearch answers behind `SearchPort`. English and Bengali titles are indexed together, so either script finds the same products.

## The suggestion box

The host keeps its own field and markup and passes the input element to `app-search-suggest`. The component adds the combobox roles, the keys and the box, which hangs off the field's `.input-group` and floats over the page, so nothing below it moves. It renders only in the browser.

| Field state                     | Box shows                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Empty, with remembered searches | Recent searches (up to 6, removable, Clear all), then products opened from search (up to 4)    |
| Empty, nothing remembered       | Trending now, or Popular while there is too little click data                                  |
| Two or more letters             | Up to 3 matching categories, up to 6 products with the typed part in bold, and See all results |
| No match                        | A short message and tip, then the empty-field list                                             |
| Search service down             | The same "search unavailable" message as the Search page                                       |

- Typing waits 200 ms after the last key and sends one request; a newer word cancels the older request. While a Bengali keyboard is composing a letter (`compositionstart` to `compositionend`), nothing is sent.
- The previous list stays on screen until the new answer arrives, so rows do not blink.
- Categories are matched in the browser from the menu the header has already loaded, by name in the page language or by the English slug, so a Bengali page still finds Jamdani from "jamdani".
- Keys: Arrow Down and Arrow Up move through every row and wrap; Enter opens the highlighted row, or the Search page for the typed words; Escape closes the box, and a second Escape closes the header bar; Delete removes a highlighted recent search; Tab and a press outside close the box.
- The field carries `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; the box is a `listbox` of `option` rows in labelled groups, and a polite live region announces the number of suggestions.
- The box measures the space between the field and the bottom of the window, less the phone's fixed bottom bar, and scrolls inside that space. It measures again when the window resizes, for example when a phone keyboard opens.

## The Search page

The address decides what the page shows: `?search=` holds the words and `?page=` the page (24 results each). Enter, the Search button, See all results, a recent search and a shared link all land on the same results, and Back returns to them. With no words the page lists the catalogue a page at a time. The results line reads "Results for "…": n", and no results shows the shared empty state.

## What search records

Search keeps totals only. Nothing about the shopper is stored: no account, address, cookie or device.

| Event                                    | Counted when                                                                            | Stored in                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| A search                                 | The Search page loads page 1 for new words (`source=page`). Typing and Back never count | `searchQueryAggregates`, one row per normalised words and language                                 |
| A product opened from the box or results | A product row or result link is opened                                                  | `analyticsDailyAggregates`, grain `product`, `metrics.searchClicks`; and `clickCount` on the words |

Words are normalised (NFKC, lower case, single spaces, at most 100 characters) by `normalizeSearchQuery` in core-domain. Search rows expire 180 days after they were last seen and click rows 180 days after their day. A failed count never fails the shopper's request.

`GET /catalog/search/trending` ranks products by search clicks over the last 14 days, each day's clicks counting half as much a week later (`rankTrending`). Only products that can be bought are listed. With fewer than 4 ranked products it returns the shop's bestsellers as `kind: "popular"`. The answer is cached for five minutes per language.

Rate limits: `catalog_search` (120 a minute per address) covers search and trending; `search_click` (30 a minute per address) covers clicks.

## Recent searches in the browser

`st_search` in local storage holds the last 6 search words and the last 4 product slugs opened from search. It is written only while Functional cookies are on, appears in the Cookie settings list, and is deleted when the shopper refuses optional cookies. The server never stores a shopper's searches.

## Tests

- Unit: `search-suggest.spec.ts`, `search-history.spec.ts`, the Search page specs, `catalog-search.test.ts` (API) and `search-analytics.test.ts` (core-domain).
- Database: `search-analytics.persistence.test.ts` runs against the replica set with `RUN_DB_IT=1` and a test database.
- Browser: `e2e/search.spec.ts` covers the header bar, the Search page, keys, counting and the Bengali page on desktop and phone.

## Limitations

- Multi-word searches match all words, so "tant saree" finds fewer products than "tant". Relevance tuning and a search dictionary are separate work.
- A click on a stale row while a newer answer is loading counts that product against the newer words.
