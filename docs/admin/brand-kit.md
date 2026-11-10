---
title: Brand Kit
wide: true
description: The Settings › Brand Kit screen, what each field stores, how the admin's own logos and theme colour work, and how the values reach the API and the shop.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-10'
source_of_truth:
    - apps/admin/src/app/features/setting/brand-kit
    - apps/admin/src/app/shared/ui/image-upload
    - apps/admin/src/app/core/brand/theme-color.ts
    - apps/admin/public/assets/scss/utils/_theme-color.scss
    - packages/contracts/src/site-settings.ts
    - apps/api/src/media/brand.service.ts
    - apps/api/src/media/app-link-check.ts
    - apps/api/src/media/admin-content.controller.ts
---

# Brand Kit

Settings › Brand Kit (`/setting/brand`) holds everything that names and draws the shop: its name, logos, browser icons, link preview picture, social profiles, app store links and colours. It is one stored value, `brand` in site settings, validated by `BrandSettings` in `packages/contracts/src/site-settings.ts`. Pictures are uploaded through the media pipeline with the `brand` purpose, so another shop built from this code uploads its own after deployment.

Reading needs `setting.index`; saving needs `setting.edit`. The routes are `GET` and `PUT /admin/settings/brand` and `POST /admin/settings/brand/app-link`.

## Logo sets

A logo set has four pictures and a browser icon choice:

| Field             | Shown as                        | Use                                                             |
| ----------------- | ------------------------------- | --------------------------------------------------------------- |
| `logoAssetId`     | Computer logo                   | The wide logo with the shop's name, for headers and footers     |
| `logoDarkAssetId` | Computer logo, dark             | Optional; used on dark backgrounds instead of a white band      |
| `sealAssetId`     | Phone logo                      | The small square logo, for phones and the collapsed admin menu  |
| `sealDarkAssetId` | Phone logo, dark                | Optional dark version                                           |
| `sealAsFavicon`   | Also use it as the browser icon | On by default. Off shows a Browser icon slot (`faviconAssetId`) |

Each slot takes one picture. The uploader's `oneOnly` mode hides the add button while a picture is set, so it has to be removed before another is chosen. Dark slots preview on a dark tile (`tone="dark"`). Previews show the `brand_logo` size, which keeps a clear background.

**The admin uses its own logos** (`adminOwnLogos`) shows a second set for the admin, for a shop whose admin carries another company's brand. Each empty slot in the admin set falls back to the shop's picture; the API resolves the fallback, so the admin reads one finished set.

## Sharing and profiles

- **Link preview picture** (`shareImageAssetId`): the picture chat apps show for pages without their own. It is made at 1200 × 630 with a 12% white margin. With none set, the computer logo is used the same way. See [Sharing and Brand](../storefront/sharing-and-brand.md).
- **Social profiles** (`socials`): Facebook, Instagram, X, Pinterest, LinkedIn and Threads addresses. This is the only place they are stored. The X box under Storefront settings › Sharing reads and writes the same value, and YouTube comes from the YouTube setting.
- **App store links** (`apps.android`, `apps.ios`): Google Play and App Store addresses. Validate asks Google Play, or Apple's lookup service, whether the app exists and shows its name. Only store hosts are contacted. A changed link must be validated before Save is accepted. The shop shows a store's badge only when its link is saved.
- **Browser bar colour** (`themeColor`): the shop's `theme-color` and web manifest colour.

## Admin theme colour

**Admin theme colour** (`adminThemeColor`) is the one colour every admin screen is drawn in, the sidebar included. `applyThemeColor()` in `core/brand/theme-color.ts` sets the CSS variable `--theme-color` on the page root, and keeps the last colour in this browser so the next start paints in it without a flash of the default.

Picking a colour previews it at once. Leaving the page without saving puts the saved colour back.

Styles never type the theme's hex value. They read the variable through the helpers in `public/assets/scss/utils/_theme-color.scss`:

| Helper            | Gives                                                          |
| ----------------- | -------------------------------------------------------------- |
| `tc($c)`          | `var(--theme-color)`                                           |
| `tc-alpha($c, n)` | The theme colour at `n` percent, through `color-mix()`         |
| `tc-shade($c, n)` | The theme colour `n` points lighter or darker, keeping its hue |

Charts read the colour at run time through `themeColor()`.

## Saving

Save sends the whole value. The API refuses any picture whose media purpose is not `brand`, then stores the value and clears its 60-second brand cache. A new computer logo redraws the logo strip on existing product link previews in the background. Every screen reading `['brand']` reloads after a save.

## Limitations

- Brand changes reach the shop within 60 seconds, the length of the API's brand cache.
- Saving the X account from Brand Kit and from Sharing in two open tabs keeps the last save.
- The shop's own theme colour is set in the shop theme, not here.
