---
title: Admin Search
wide: true
description: How the header search finds admin pages, tabs and Brand Kit sections, how results are matched and ranked, and how to add a new page to it.
status: implemented
audience: [beginner, frontend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/admin/src/app/core/admin-search/admin-search.ts
    - apps/admin/src/app/layout/header/widgets/search
    - apps/admin/src/app/shared/data/menu.ts
    - apps/admin/src/app/features/storefront-setting/storefront-setting.ts
    - apps/admin/src/app/features/setting/brand-kit/brand-kit.html
---

# Admin search

The search box in the admin header finds places in the admin: menu pages, the tabs inside Storefront settings, and the sections of the Brand Kit. It runs entirely in the browser. The admin has about fifty places, so a list built from the menu answers instantly and needs no API call. Product search is separate and stays on Meilisearch; see [Storefront Search](../storefront/search.md).

## What it lists

`searchEntries()` in `core/admin-search/admin-search.ts` builds the list from two sources:

| Source                              | Entries                                                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `shared/data/menu.ts` (the sidebar) | Every menu row with a path, with its parent rows as the trail and the parent's icon                                                      |
| `SECTIONS` in `admin-search.ts`     | Storefront settings › Search, YouTube and Sharing; Brand Kit logo, phone logo, admin logos, sharing and profiles, and admin theme colour |

Each entry has an `id` (the path with `/` and `-` turned into `_`, such as `setting_brand`), a title key, the trail keys above it, an icon, extra search words and the permission codes that open it.

A section entry opens its page on a part of it:

- Storefront settings tabs use `?tab=search`, `?tab=youtube` or `?tab=share`. The page reads the parameter and opens that tab.
- Brand Kit sections use a fragment, such as `#shop_seal_section` or `#brand_sharing`. The router's anchor scrolling brings the section into view.

## Text in both languages

Titles and trails use the menu's own language keys, read the way the sidebar reads them (`title.replace(' ', '_')`). Each entry has a one-line hint under `search_hint_<id>` in `public/assets/i18n/en.json` and `bn.json`. The dropdown's labels use the `search_*` keys in the same files.

## Matching and ranking

The query is split into words. Bengali vowel signs stay inside their words. Every word must match the entry somewhere:

| Where the word matches                             | Points (exact word / start of a word / inside a word) |
| -------------------------------------------------- | ----------------------------------------------------- |
| Title, in the language shown or as its key         | 120 / 100 / 60                                        |
| Extra search words (English, such as `gst`, `via`) | 80 / 60 / 30                                          |
| Trail                                              | 45 / 35 / 15                                          |
| Hint                                               | 40 / 30 / 12                                          |

A word matches inside another word only when it has three letters or more. Results are sorted by points, then by menu order, and the first eight are shown.

When nothing matches, each word of four letters or more is compared with the titles, trails and extra words. A word one letter away is read as the close one; from seven letters, two letters away. The dropdown names the change, for example "Close match for “favicn”: showing “favicon”".

## Who sees what

An entry is listed only when the signed-in operator holds one of its permission codes, the same rule the sidebar applies. A child menu row without its own codes uses its parent's. This shapes the list only; the API still checks every request.

## The dropdown

`layout/header/widgets/search` keeps the theme's search box and adds the dropdown below it:

- **Nothing typed:** the places opened last (up to three, under `search_group_recent`) and Go to (Add product, All orders).
- **Typed:** Pages, best first, then one place opened before that is not already listed.
- **No match:** a short message with an example of what to type.

Each row shows the trail, the title and the hint, with the highlighted row in the theme colour. The dropdown is Bootstrap's card and list group with the theme's colour classes and `<kbd>` key hints. The highlighted row also sets its background to `var(--theme-color)` inline, because the dark theme's list-group rule outranks `theme-bg-color`. The dropdown is positioned inside the theme's search form, which can carry a transform, and stays inside the window at any width.

| Key         | Action                        |
| ----------- | ----------------------------- |
| ↑ / ↓       | Move, wrapping at either end  |
| Enter       | Open the highlighted place    |
| Esc         | Close                         |
| ⌘K / Ctrl K | Open the search from any page |

The list of places opened lives in this browser only, under `st_admin_recent_pages` in local storage, five places at most. A page opened from the sidebar counts too. A browser that refuses storage keeps the list for the visit.

## Adding a page

A new menu row is listed automatically. Add its hint as `search_hint_<id>` to both language files, and its extra words to `KEYWORDS` if people call it something else. `admin-search.spec.ts` fails when a menu page has no hint in either language, when ids repeat, or when a section points at a page that is not in the menu. For a new tab or section, add a `SECTIONS` entry and make the page honour its `?tab=` value or carry the fragment's `id`.

## Limitations

- Only places in the admin are found. Orders by number, customers by phone and products are not.
- The search reads the language on screen, page keys and the English extra words. Bengali typed while the admin shows English finds nothing.
