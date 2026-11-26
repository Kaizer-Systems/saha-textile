---
title: Languages
description: How the shop and the admin get one list of languages from the API, how languages are named, listed and counted, and the rules for Bengali text, names and numbers.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-11-17'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - packages/core-domain/src/catalog/languages.ts
    - apps/api/src/languages
    - apps/storefront/src/app/core/i18n/locale.ts
    - apps/storefront/src/app/core/i18n/active-locale.ts
    - apps/admin/src/app/core/i18n/active-languages.ts
    - apps/admin/src/app/shared/pipes/language.pipes.ts
    - packages/contracts/src/common.ts
    - apps/api/src/languages/language-store.ts
---

# Languages

The shop serves English (`en`) and Bengali (`bn`); Settings › Languages adds others. English is the default and the fallback. Bengali replaced French on 8 November 2026; the decisions log holds the reasoning.

## Where each language lives

| Part              | English                              | Bengali                  |
| ----------------- | ------------------------------------ | ------------------------ |
| Storefront pages  | `/en/…`                              | `/bn/…`                  |
| Interface text    | `assets/i18n/en.json`                | `assets/i18n/bn.json`    |
| Legal pages       | Admin › Pages (database)             | Admin › Pages (database) |
| Catalogue content | the `en` key of each language object | the `bn` key             |
| Link previews     | `og:locale` `en_IN`                  | `og:locale` `bn_IN`      |

Product and category addresses stay in English letters in both languages. Only the language prefix changes.

## One list of languages

Settings › Languages decides which languages exist, separately for the admin and the shop; see [Settings › Languages](../admin/languages.md). The API keeps the stored list in memory and serves it:

- `GET /storefront/languages` (public, cached for a minute, outside the shared rate limit) answers `{ "default": "en", "active": [...], "admin": [...], "redirect": [...] }` (contracts' `ActiveLocaleConfig`): the languages the shop shows, the languages staff may use the admin in, and the languages whose addresses answer 301 to English.
- `GET /admin/languages` gives every signed-in admin the working list, drafts included.

English is always in every list and always first. `ACTIVE_LOCALES` only seeds an empty list once.

| Reader | How it gets the list                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin  | `ActiveLanguages` (`core/i18n/active-languages.ts`) loads the public list before the app starts and the working list once signed in, and keeps this browser's last copy (`st_admin_languages`). Every Language switch and per-language form reads `list()` (every added language); the header's page-language menu and Transloco read `adminList()`.                                            |
| Shop   | The server's locale middleware refreshes it at most once a minute (`refreshSupportedLocales` in `core/i18n/locale.ts`) and hands it to the renderer on the request. `ACTIVE_LOCALE` adopts it and passes it to the browser in the page's transfer state. Address prefixes, the language menu, `hreflang` and `og:locale` tags, the sitemap and the manifest use it; `redirect` drives the 301s. |
| API    | `LanguageStore`: `shop()` for Go Live, sitemaps, messages and saved redirects; `content()` for search documents and review photo alt text.                                                                                                                                                                                                                                                      |

Until the shop has heard from the API once, any well-formed language prefix counts as a language, so an outage at start-up can never send `/bn/…` on a permanent redirect to `/en/bn/…`. A Contact Us message in a language the shop does not offer is stored in English.

## Naming, listing and counting

The rules are shared, browser-safe code in `@saha-textile/core-domain/languages`:

- **Names are always in the language's own script**: "English", "বাংলা", "हिन्दी", in buttons, menus, sentences, Go Live reports and emails, whatever language the reader uses. `languageName(code)` takes them from `Intl.DisplayNames`, so a new language is named without anyone typing it. The admin's `languageName` pipe and the flags beside the page-language menus (`languageFlag`) use the same rules.
- **Lists** follow the reader: `languageList(codes, reader)` joins the names with `Intl.ListFormat`, so English reads "English and বাংলা" (Indian English, no comma before "and") and Bengali reads "English এবং বাংলা". In the admin, the `languageList` pipe; a sentence takes the list as a value, such as `{{languages}}` in Settings › Stores' help.
- **Counts** pick their wording with `Intl.PluralRules`: a sentence with a count has one key per form (`image_count_one`, `image_count_other`) in each language file, and the admin's `plural` pipe (or `translateCount` in code) chooses the key and writes the count with the language's digits. A language whose file lacks a form falls back to `_other`.

No sentence writes a language list or a plural by hand.

## Adding interface text

Add every key to `en.json` and `bn.json` in the same change. `pnpm check:i18n-parity` fails when a key is missing, when a Bengali value has no Bengali letters, or when the brand is shortened instead of written as সাহা টেক্সটাইল. Values that read the same in both languages, such as brand names, go on its shared-words list.

## How the Bengali is written

- Everyday Kolkata Bengali, polite (আপনি), in Paschimbanga Bangla Akademi spelling.
- Shop words are Bengali (শাড়ি, পাড়, আঁচল, সুতি). Words people learned from shopping apps stay as they say them (কার্ট, চেকআউট, অর্ডার).
- Actions use a Bengali verb (খুঁজুন, কিনুন, দেখুন).
- Short forms stay in English letters: OTP, PIN, SKU, GST, and sizes such as S, M and XL.
- The brand is সাহা টেক্সটাইল in running text. Page titles end in `| Saha Textile`.

### Interface wording

Interface text balances Bengali words with the English words shoppers and staff already use. Choose the word a Kolkata shop assistant or app user would say, not the most formal one.

| Use                                    | Instead of                          | Why                                    |
| -------------------------------------- | ----------------------------------- | -------------------------------------- |
| ক্যাটাগরি, সেভ, এডিট, আপডেট, কভার, পেজ | শ্রেণি, সংরক্ষণ, সম্পাদনা, হালনাগাদ | These are the words people use in apps |
| পণ্য, খসড়া, ফলাফল, পুরোনো, নিচে       | English loanwords                   | Common Bengali words read naturally    |
| ফলাফল for search results               | ফল                                  | ফল also means fruit                    |
| নাকচ করুন for Reject                   | বাতিল করুন                          | বাতিল করুন already means Cancel        |

- **Placeholders.** Never attach a case ending to a language name in a placeholder: `{{language}}-এ` prints বাংলা-এ. Write `{{language}} ভাষায়` instead. Names, addresses and codes may take a hyphenated ending, as in `{{name}}-এর`.
- **Menu names.** A sentence that names an admin screen uses its Bengali menu name, such as সেটিংস › মেলবক্স, so the words match what the reader sees in the menu.
- **Product names.** Gmail, WhatsApp, Google and similar names stay in English letters.
- **Legal pages.** The privacy, shipping and other policy pages keep a formal register, so a word such as হালনাগাদ may stay there. Interface text describing the same thing uses the everyday word.

The full glossary is in the decisions log. Catalogue words come from `packages/adapters-db-mongo/src/seed/demo-bengali.ts` and `scripts/showcase-catalogue-motifs-bn.ts`. The catalogue builder stops when a word has no Bengali, so English never lands in a Bengali field.

## Numbers

Bengali pages use English digits for prices, sizes, PIN codes, phone and order numbers, and dates. Month and weekday names stay Bengali. Code that formats a number for a page language passes it through `intlLocale()` (shared in `@saha-textile/core-domain/languages`), which turns `bn` into `bn-IN-u-nu-latn`.

## Names and delivery details

Every stored name (profile, recipient, billing) and every delivery detail is in English letters, because couriers, invoices and staff searches read them. Reviews, questions and messages may be in any language.

- The API enforces this through `EnglishName`, `EnglishDeliveryText` and `AddressInput` in `packages/contracts/src`.
- Bengali digits (০–৯) are turned into English digits before the check.
- The storefront forms show "Please use English letters" on the field, using the existing error line.
- A Google or Facebook name in another script is not kept as the profile name.

## The stored language

A new account records the language of the page it was created on (`preferredLocale`), and an order records the language it was placed in (`locale`). Emails, the order page and later WhatsApp messages use it. The storefront names the page language on those two calls.

## Type on Bengali pages

The font stack is Public Sans, then Noto Sans Bengali, so Latin letters and digits keep the shop's font. Both fonts are served from the apps' own addresses; see [Styles, Dark Mode and Fonts](../storefront/styles-and-fonts.md). One style block for `:lang(bn)` turns off letter spacing, gives headings, buttons and labels taller lines so vowel signs are not clipped, and makes capital-letter labels semibold. The admin sets the page language when its switcher changes, so the same block applies there.

## Moving stored French to Bengali

`pnpm --filter @saha-textile/adapters-db-mongo migrate:french-to-bengali` counts French values and page addresses. With `-- --write` it fills Bengali from the language object or its translation table, removes the French, and deletes the French page addresses. It writes nothing while any French value lacks Bengali. On a local database, run `seed:showcase-catalogue` first, then the migration, then `search:rebuild` in the API. Take a backup before `--write`.
