---
title: Settings › Languages
wide: true
description: Adding, switching and removing languages for the admin and the shop, the rules the API applies, the to-do counts, the 301s for a language the shop stops showing, and the 30-day reminder before stored text is erased.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-15'
source_of_truth:
    - packages/contracts/src/language.ts
    - packages/core-domain/src/catalog/language-rules.ts
    - packages/core-domain/src/ports/language.repository.ts
    - packages/adapters-db-mongo/src/repositories/language.repository.ts
    - packages/adapters-db-mongo/src/repositories/language-coverage.repository.ts
    - packages/adapters-db-mongo/src/repositories/localized-text-registry.ts
    - apps/api/src/languages
    - apps/admin/src/app/features/setting/languages
    - apps/admin/src/app/core/i18n/active-languages.ts
    - apps/admin/src/app/core/i18n/missing-language.ts
    - apps/storefront/src/app/core/i18n/locale.ts
---

# Settings › Languages

Settings › Languages (`/setting/languages`) holds every language the shop and the admin use. English is the default: always on in both, never switched off or removed. Every other language has two switches and a to-do count.

| Column | Meaning                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin  | Staff may turn the admin itself into this language from the header's language menu.                                                                                             |
| Shop   | The shop shows it at `/xx/…`, in its language menu, in the sitemap and in Google alternates. The badge reads **Draft** (never shown since it was added), **On** or **Off**.     |
| To do  | Everything still empty in the language that stops the shop showing it. The red count opens the list by area; each line's **Open** shows that list filtered to the missing text. |

The page and every change need `language.manage`, which only the Administrator role holds at first. Every signed-in admin reads the working list (`GET /admin/languages`), because every form shows every added language.

## Writing a language's text (the Admin switch)

The Admin switch is only about the admin's own words. Writing a language's text for the shop never waits on it: once a language is added, every form's Language switch shows its button with a yellow **Draft** badge and red to-do counts. Text missing in a draft language never stops Go Live: the Go Live checks ask only for the languages the shop shows.

## Menu and button text comes with a release

Every word the apps show that is not stored in the database ships as one file per language per app: `apps/admin/public/assets/i18n/xx.json` and `apps/storefront/public/assets/i18n/xx.json`, checked by `pnpm check:i18n-parity`. The API's build records which languages both apps ship (`dist/shipped-languages.json`, written by `write-language-manifest.ts` from the same commit; on a developer's Mac the API reads the files directly). The shop's legal pages count too: `apps/storefront/public/assets/data/pages/<slug>(.xx).json`.

So a new language takes two steps:

1. A release brings its files for both apps.
2. **Add a language** offers it; languages shipped in one app only show as "Not in this release yet".

Files for a language that is not added sit unused. If a release removes a file while the language is in use, its to-do count turns red and the apps fall back to English words.

## The rules

The rules live in `decideLanguageChange` (core); the API applies them on every request and answers the whole page after each change. A refusal answers 400 with the rule's code, which the page names in its own words.

| Action   | Allowed when                                                 | What happens                                                                                              |
| -------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Add      | Its files are in this release, in both apps                  | A draft for the shop, Admin off. A language deleted earlier comes back with whatever text is stored.      |
| Admin on | The admin's file for it is complete                          | The header's language menu offers it.                                                                     |
| Shop on  | Nothing is left to do                                        | Pages at `/xx/…`, the language menu, the sitemap and alternates.                                          |
| Shop off | Any time                                                     | Every `/xx/…` address answers 301 to the same page in English. The text stays.                            |
| Delete   | The shop does not show it                                    | It leaves every list and switch; its text stays stored.                                                   |
| Keep it  | It is deleted                                                | The bell's reminder waits another 30 days.                                                                |
| Erase    | It is deleted, and its own name is typed (for example বাংলা) | Its stored text is removed from every item for good. Files in the code stay until a release removes them. |

Every change writes an audit row (`language.add`, `language.admin.switch`, `language.shop.switch`, `language.delete`, `language.reminder.keep`, `language.erase`); erase records how many items it changed, never the text.

## What counts as a to-do

`GET /admin/languages/:code/todo` answers one line per area:

- **Files from the release**: shop menu and button text, admin menu and button text, and the four legal pages. The admin's own words never stop the shop; they decide only the Admin switch.
- **Text written in the admin**, counted only for what the shop shows: live products (title, both descriptions, search text, every option and value name, the delivery line once English has one), options and values, categories, photos the website uses (alt text in every language; a title or caption once English has one), active banners, live blog posts, categories and tags, published launches and sales, active stores, live FAQs, live search words, and add-on templates.

One list in the database adapter, `LOCALIZED_TEXT_REGISTRY`, names every stored per-language field with its rule. The same list counts the to-dos, filters a list page (`?missing=xx`), counts the items that hold a language's text, and erases it. A schema-walking test fails when a model gains a free-form field that is neither in the list nor named as not text.

Photos count when something the shop shows uses them (`MEDIA_OWNER_REGISTRY` with each owner's live state); unused photos in Media never count. Messages (email, SMS, WhatsApp) fall back to English and never block a language.

## Filtered lists

**Open** on a to-do line opens the list with `?missing=xx`, and an amber line above it says what it shows, with **Show all**. Paged lists (products, blog posts, launches and sales, search words) send `missing` to their API, which narrows the page. Lists that load every row (options, categories, blog categories and tags, stores, FAQs, add-on templates, banner slots) keep the rows in `GET /admin/languages/:code/missing/:area`. The category trees keep the branches that lead to a missing category. Photos show their count without a link until the Media file manager replaces the library page.

## Switching the shop off

The public list (`GET /storefront/languages`) carries `redirect`: languages the shop showed once and does not show now. The shop's locale middleware answers every page under such a prefix with a 301 to the same page in English (`retiredLocaleRedirect`), before any saved redirect, kept for an hour so switching the language back on brings its pages back. The sitemap lists only the languages the shop shows; a language switched on later gets its pages from the English rows.

## The 30-day reminder

A deleted language whose text is still stored appears in the header's bell for whoever holds `language.manage`, 30 days after it was deleted and every 30 days after **Keep it**. The reminder opens the erase popup (`/setting/languages?erase=xx`).

## How every app reads the list

The API keeps the stored list in memory (`LanguageStore`) and reads it again every 30 seconds and after every change, so several API processes and the media worker agree within half a minute. An empty list is seeded once from `ACTIVE_LOCALES`; from then on the database decides.

| Reader                                                                 | List                                               |
| ---------------------------------------------------------------------- | -------------------------------------------------- |
| Go Live checks, sitemap, search titles' order, emails, saved redirects | `shop()`: what the shop shows                      |
| Forms, review photo alt text, search documents                         | `content()`: every added language, drafts included |
| Header language menu, Transloco                                        | `admin()`                                          |
| Shop middleware                                                        | `redirect()`: 301 to English                       |

The admin's `ActiveLanguages` reads the public list before sign-in and the working list once signed in, and keeps this browser's last copy (`st_admin_languages`).
