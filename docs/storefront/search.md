---
title: Storefront Search
wide: true
description: How the menu-bar search, the Search page and the suggestion box work, how the admin's search words and Storefront settings shape results, and what search records.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/storefront/src/app/shared/ui/search-suggest
    - apps/storefront/src/app/layout/header/widgets/search
    - apps/storefront/src/app/features/page/search
    - apps/storefront/src/app/core/search/search-history.ts
    - apps/api/src/catalog/catalog-search.controller.ts
    - apps/api/src/catalog/search-insights.service.ts
    - packages/core-domain/src/catalog/search-analytics.ts
    - packages/adapters-db-mongo/src/repositories/search-analytics.repository.ts
    - packages/core-domain/src/catalog/search-terms.ts
    - apps/api/src/catalog/search-terms.service.ts
    - apps/api/src/search/meilisearch-search.ts
    - apps/admin/src/app/features/search-term
    - apps/admin/src/app/features/storefront-setting
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

## How results are ranked

The index ranks by these rules, in order: every typed word found, fewest typos, the Storefront settings "show first" order, where the words were found (title, then search words, then facts, then description), how close together they are, and exact matches. "Show first" rides on the text search's own sort, so category listings, which search with no words and their own sort, keep their order.

## Search words (admin)

Staff manage search words under Products › Search words. A search word has a name in every shop language, other spellings per language, and one shared set of tagged categories and products (a category also covers the categories under it).

- Every live search word's names and spellings, in all languages, are synonyms of each other in the index, so "pujo" also finds a title that says "puja".
- They are also written onto every product the word tags, in the `searchTerms` field, so a search for any of them, or a near-miss typo, finds those products even when no title says the word ("puja" finds Laal Paar and Red & White sarees).
- Go Live needs the name in every language and at least one category or product; the list has bulk Go Live and Take off shop.
- A save re-indexes only the products the word tags or used to tag, in the background, and replaces the synonyms at once. A category change refreshes the vocabulary too. Every save is in the audit log.
- Permissions: `search_term.index`, `.create`, `.edit`, `.destroy`. Run `seed:system-roles` after deploying so the Administrator role holds them.
- A spelling makes two words mean the same thing everywhere. Keep a distinct style out of a broader word's spellings: "dhakai" as a spelling of Jamdani made every Jamdani match a Dhakai search equally.

## Storefront settings (admin)

Store front › Storefront settings holds small shop-wide settings, one group per side tab. The Search group sets the categories that show first when the words fit two products equally well (`storefront.search` site setting). With Sarees chosen, "banarasi" lists Banarasi sarees before Banarasi suits, while "banarasi suit" still lists suits first. Saving re-indexes the whole shop in place, in the background.

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

- Unit: `search-suggest.spec.ts`, `search-history.spec.ts`, the Search page specs, `catalog-search.test.ts` and `search-terms.test.ts` (API), `search-analytics.test.ts` and `search-terms.test.ts` (core-domain), and the admin `search-term.spec.ts`.
- Database: `search-analytics.persistence.test.ts` and `search-term.persistence.test.ts` run against the replica set with `RUN_DB_IT=1` and a test database.
- Browser: `e2e/search.spec.ts` covers the header bar, the Search page, keys, counting and the Bengali page on desktop and phone.

## Limitations

- A word the catalogue never uses finds nothing until staff add it as a search word.
- Fabric and colour words that live only in a product's facts rank below title matches, so "black georgette" can list black sarees in another fabric first.
- A click on a stale row while a newer answer is loading counts that product against the newer words.
