---
title: Languages
description: How the shop serves English and Bengali, and the rules for Bengali text, names and numbers.
status: implemented
audience: [frontend, backend, operator]
last_verified: '2026-11-10'
source_of_truth:
    - docs/engineering-live-context/owner-decisions-log.mdx
    - apps/storefront/src/app/core/i18n/locale.ts
    - packages/contracts/src/common.ts
---

# Languages

The shop serves two languages: English (`en`) and Bengali (`bn`). English is the default and the fallback. Bengali replaced French on 8 November 2026; the decisions log holds the reasoning.

## Where each language lives

| Part              | English                              | Bengali                            |
| ----------------- | ------------------------------------ | ---------------------------------- |
| Storefront pages  | `/en/…`                              | `/bn/…`                            |
| Interface text    | `assets/i18n/en.json`                | `assets/i18n/bn.json`              |
| Legal pages       | `assets/data/pages/<slug>.json`      | `assets/data/pages/<slug>.bn.json` |
| Catalogue content | the `en` key of each language object | the `bn` key                       |
| Link previews     | `og:locale` `en_IN`                  | `og:locale` `bn_IN`                |

Product and category addresses stay in English letters in both languages. Only the language prefix changes. The list of languages is configuration: `ACTIVE_LOCALES` for the API and `supportedLocales` in the storefront's served `config.json`.

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

Bengali pages use English digits for prices, sizes, PIN codes, phone and order numbers, and dates. Month and weekday names stay Bengali. Code that formats a number for a page language passes it through `intlLocale()`, which turns `bn` into `bn-IN-u-nu-latn`.

## Names and delivery details

Every stored name (profile, recipient, billing) and every delivery detail is in English letters, because couriers, invoices and staff searches read them. Reviews, questions and messages may be in any language.

- The API enforces this through `EnglishName`, `EnglishDeliveryText` and `AddressInput` in `packages/contracts/src`.
- Bengali digits (০–৯) are turned into English digits before the check.
- The storefront forms show "Please use English letters" on the field, using the existing error line.
- A Google or Facebook name in another script is not kept as the profile name.

## The stored language

A new account records the language of the page it was created on (`preferredLocale`), and an order records the language it was placed in (`locale`). Emails, the order page and later WhatsApp messages use it. The storefront names the page language on those two calls.

## Type on Bengali pages

The font stack is Public Sans, then Noto Sans Bengali, so Latin letters and digits keep the shop's font. One style block for `:lang(bn)` turns off letter spacing, gives headings, buttons and labels taller lines so vowel signs are not clipped, and makes capital-letter labels semibold. The admin sets the page language when its switcher changes, so the same block applies there.

## Moving stored French to Bengali

`pnpm --filter @saha-textile/adapters-db-mongo migrate:french-to-bengali` counts French values and page addresses. With `-- --write` it fills Bengali from the language object or its translation table, removes the French, and deletes the French page addresses. It writes nothing while any French value lacks Bengali. On a local database, run `seed:showcase-catalogue` first, then the migration, then `search:rebuild` in the API. Take a backup before `--write`.
