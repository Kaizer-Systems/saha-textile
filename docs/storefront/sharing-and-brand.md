---
title: Sharing and Brand
wide: true
description: How the product share button builds its message and pictures, how link previews and short addresses work, and how the shop reads the Brand Kit for logos, icons, colours, profiles and app badges.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/storefront/src/app/features/shop/product-detail/widgets/product-social-share
    - apps/storefront/src/app/core/catalog/short-address.ts
    - apps/storefront/src/server/middleware/locale.ts
    - apps/storefront/src/app/core/i18n/locale-seo.ts
    - apps/storefront/src/app/core/brand/brand-head.ts
    - apps/storefront/src/server/middleware/web-manifest.ts
    - apps/storefront/src/app/layout/layout.ts
    - apps/api/src/media/brand.service.ts
    - apps/api/src/catalog/share-settings.service.ts
    - packages/core-domain/src/media/seeded-roles.ts
---

# Sharing and brand

## The share button

The product page's share button opens the theme's "Share it" block in a popover beside the wishlist and compare buttons. Nothing is stored per product: the message is built when the menu opens, from the product on the page and the wording in the language files.

- **The message** carries the product name, the live price with any offer, three of the product's facts and an invitation, in the page's language.
- **The link** opens the colour or design the shopper is looking at (`?variant=`).
- **The apps** come from Storefront settings › Sharing through `GET /catalog/share-settings`: WhatsApp, Instagram (phones), Facebook, Telegram, email, X, LinkedIn and Pinterest. Link and More are always offered. More opens the phone's own share sheet for every other app.
- **X** names the shop's X account as "via @…" and adds up to three tags from the product's facts when hashtags are on. The account is the Brand Kit's X profile.
- **Phones** whose share sheet accepts a picture with text get a shorter menu. Sharing hands the sheet a JPEG named for the product together with the caption.
- **Instagram** never links a caption, so it gets the short address `/p/<product code>`, short enough to read and type. The caption is copied first, because Instagram drops text passed from other apps.

No app needs an account or key from the shop; each one opens its own share page or the phone's share sheet.

## Pictures made for sharing

The image pipeline makes three sizes for sharing. They are part of `SEEDED_MEDIA_ROLES` and are made only for a picture that leads a product (`servesAsPrimary`) or is the Brand Kit's link preview picture:

| Role         | Size        | Use                                                                                                                                                                           |
| ------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `share`      | 1200 × 630  | A product's link preview. The photo sits over a blurred copy of itself, with the Brand Kit logo in a strip along the foot (`brandStrip`).                                     |
| `story`      | 1080 × 1920 | Status and Story cards. The photo sits above an empty band; the phone writes the product's name and facts into the band when it shares.                                       |
| `site_share` | 1200 × 630  | The link preview of the home page, a category, a blog post or any page without its own picture. The picture keeps a 12% white margin (`inset`), because chat apps crop edges. |

A product's first photo is marked as its lead photo when the product is saved, which queues a reprocess for the extra sizes. A new Brand Kit logo redraws the logo strip on existing link previews in the background.

## Link previews

Every page sets Open Graph and Twitter card tags through `LocaleSeo`. A product page adds its price (`og:price:amount`, `product:price:amount`, in INR), its facts, its stock and the shop name, with its `share` picture.

A page without its own picture uses the Brand Kit's link preview picture. With none set, it uses the computer logo's `site_share` copy, and with no logo either, the shop's built-in 512 px app icon. A shop never shares another brand's picture.

## Short addresses

`/p/<product code>` is answered on the server by `src/server/middleware/locale.ts`. It asks `GET /catalog/code/:code` for the product's address and answers with a 301 to the product page, keeping any query.

Like every Nitro handler, the middleware reaches the API through `serverApiUrl()`, which reads `SAHA_TEXTILE_PUBLIC_CONFIG`. Nitro handlers never run Angular's start-up, so the built-in `environment.apiUrl` (a localhost default) would point a deployed server at nothing. The same address loads the old-address redirect rows and the live product and category paths.

## The Brand Kit in the shop

`GET /storefront/brand` returns the Brand Kit as the shop reads it. The API resolves each picture to its sizes and caches the answer for 60 seconds.

| Part                     | Where it shows                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Computer and phone logos | Header, footer and popups; the dark versions on dark backgrounds                                                         |
| Browser icon             | The tab icon and Apple touch icon (`brand-head.ts`), with a dark-browser version when a dark phone logo is set           |
| Browser bar colour       | The `theme-color` meta tag and the web manifest                                                                          |
| Light/dark switch        | The moon and sun button in the top bar, shown while `modeSwitch` is on; dark mode uses the dark logos where they are set |
| Social profiles          | The footer icons and the organisation's `sameAs` list for search engines; YouTube comes from the YouTube setting         |
| App store links          | A Google Play or App Store badge in the footer, shown only when its link is saved                                        |
| Shop name and icons      | The web manifest (`/manifest.webmanifest`), built on the server from the Brand Kit                                       |

## Limitations

- Whether Instagram offers Stories for a shared picture depends on the phone and app version.
- Pictures uploaded before a sharing size existed get it only when reprocessed.
