---
title: Core Domain, Pricing, and Ports
wide: true
description: Dependency direction, business logic, ports and swappability.
status: scaffolded
audience: [beginner, backend]
last_verified: '2026-11-16'
source_of_truth:
    - packages/core-domain/src
    - packages/core-domain/test
    - packages/contracts/src
    - AGENTS.md
    - docs/engineering-live-context/api-db-development-roadmap-with-pending-decision-gates.mdx
    - docs/engineering-live-context/owner-decisions-log.mdx
---

# Core domain, pricing, and ports

`packages/core-domain` holds business rules and port interfaces. It knows nothing of NestJS, Fastify, Mongoose, MongoDB, Meilisearch, Spaces or any payment or shipping provider.

## Dependency direction

```mermaid
flowchart BT
    External["Provider SDKs and databases"] --> Adapters["Adapter packages"]
    Adapters --> Ports["Core port interfaces"]
    API["NestJS application/composition"] --> Ports
    API --> Domain["Core rules/use cases"]
    Frontends["Angular applications"] --> HTTP["HTTP contracts"]
    HTTP --> API

    Domain -. must not import .-> External
    Frontends -. must not import .-> Adapters
```

Imports point inward. Runtime calls flow outward only through a port that composition supplies.

## Domain modules

| Folder            | Contains                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth/`           | Password, PIN and signup policy, rate-limit policy, effective permissions, client-address scope                                                       |
| `catalog/`        | Card price, badges, listing filters and facets, product visibility, relations, legacy address resolution, measurements, stock alerts, weekly insights |
| `media/`          | Ingest policy, derivative plan, asset processing, image resolution, garbage collection, review photos, YouTube feed, storage keys, size roles         |
| `pricing/`        | Money, discounts and PayPal gross-up                                                                                                                  |
| `blog/`           | Go Live gaps, address and excerpt rules, reading time, article HTML cleaning                                                                          |
| `events/`         | Launch and sale event rules, start and end times, sale price resolution                                                                               |
| `communications/` | Settings › Communications change rules and the send gate                                                                                              |
| `stores/`         | Store location rules for Contact Us                                                                                                                   |
| `mailbox/`        | Mailbox access rights, folder labels, reply subjects                                                                                                  |
| `dashboard/`      | Admin home periods and stock states                                                                                                                   |
| `payments/`       | Deciding a payment result from the gateway's reply                                                                                                    |
| `ports/`          | Repository and provider interfaces                                                                                                                    |

## Pricing functions

| Function            | Responsibility                           | Guardrails                                    |
| ------------------- | ---------------------------------------- | --------------------------------------------- |
| `roundMoney`        | Round to a set number of decimals        | Rejects non-finite input                      |
| `convertFromINR`    | Multiply INR by a stored rate            | Rejects negative INR and non-positive rates   |
| `discountAmountINR` | Compute a percentage or fixed discount   | Caps percentage at 100 and fixed at the price |
| `applyDiscountINR`  | Subtract the resolved discount           | Never below zero                              |
| `paypalGrossUp`     | Preserve a net amount after fees         | Percentage must be in `[0,1)`                 |
| `cardPrice`         | Single price or range for a product card | Catalogue amounts are tax-inclusive rupees    |

These functions do not form a checkout engine. Tax, promotion stacking, shipping and exchange-rate staleness are outside them.

## Port inventory

### Repositories

| Port                                                                                              | Capability                                           |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `ProductRepository`, `CategoryRepository`                                                         | Products and categories                              |
| `ProductVariantRepository`, `ProductBundleRepository`, `ProductRelationRepository`                | Variants, bundles and relations                      |
| `CategoryPlacementRepository`, `CategoryFacetConfigRepository`, `AttributeDefinitionRepository`   | Taxonomy, facets and attributes                      |
| `SeoRedirectRepository`, `SeoRouteRepository`, `AddonTemplateRepository`                          | Old addresses, head data and add-on templates        |
| `StockAlertRepository`, `ProductInsightSetRepository`                                             | Stock alerts and weekly insights                     |
| `SearchAnalyticsRepository`                                                                       | Search totals and search-result clicks               |
| `SearchTermRepository`                                                                            | The admin's search words (`searchDictionary`)        |
| `FaqRepository`, `ProductQuestionRepository`, `ReviewRepository`                                  | FAQ, questions and reviews                           |
| `InventoryRepository`, `InventoryCostLayerRepository`                                             | Stock ledger and FIFO cost layers                    |
| `CartRepository`, `OrderRepository`, `CurrencyRepository`, `PromotionRepository`                  | Commerce records                                     |
| `CustomerRepository`, `AdminUserRepository`                                                       | Public account records                               |
| `CustomerAuthRepository`, `AdminUserAuthRepository`                                               | Credentials and account security state               |
| `AuthSessionRepository`, `OtpChallengeRepository`, `OAuthStateRepository`                         | Sessions and challenges                              |
| `PasswordResetTokenRepository`, `EmailVerificationTokenRepository`, `AdminInviteRepository`       | Single-use tokens                                    |
| `AuthRateLimitRepository`, `AuthIdentityRepository`                                               | Rate-limit counters and provider identity links      |
| `PendingSignupRepository`, `PendingContactChangeRepository`                                       | Short-lived proof state                              |
| `RoleRepository`, `AdminUserRoleAssignmentRepository`                                             | Roles and assignments                                |
| `AuditLogRepository`, `ConsentRepository`                                                         | Audit trail and consent history                      |
| `NotificationSettingsRepository`, `NotificationTemplateRepository`, `MessageOutboxRepository`     | Notification settings, templates and outbox          |
| `MediaAssetRepository`, `MediaRoleRepository`, `ContentBlockRepository`, `SiteSettingsRepository` | Media, banners and settings                          |
| `BlogPostRepository`, `BlogCategoryRepository`, `BlogTagRepository`                               | Blog posts, categories and tags                      |
| `ShopEventRepository`                                                                             | Launch and sale events                               |
| `StoreLocationRepository`                                                                         | The shop's stores                                    |
| `CommunicationSwitchRepository`                                                                   | Settings › Communications message × channel switches |
| `WishlistRepository`                                                                              | Saved products per customer                          |
| `MailboxRepository`, `MailboxAccessRepository`, `MailboxTokenStore`, `ContactMessageRepository`   | Mailboxes, access lists, tokens, Contact Us messages |
| `DashboardRepository`                                                                             | Admin home figures                                   |

Every repository has a Mongo implementation in `packages/adapters-db-mongo`. Inventory, cost-layer and facet repositories have no HTTP workflow.

### Capability ports

| Port                     | Capability                                  | Adapter                                                  |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------- |
| `AuthPort`               | Password hashing and JWT operations         | `Argon2JwtAuth`                                          |
| `OAuthVerifierPort`      | Provider token verification                 | Google and Facebook verifiers                            |
| `TransactionManagerPort` | Opaque atomic unit of work                  | `MongoTransactionManager`                                |
| `SearchPort`             | Index, remove and search products           | `MeilisearchSearch`                                      |
| `NotificationPort`       | Deliver or suppress a message               | `Msg91NotificationAdapter`, `ConsoleNotificationAdapter` |
| `StoragePort`            | Object storage and signed URLs              | `SpacesStorageAdapter`                                   |
| `ImageCodecPort`         | Decode and encode images                    | `SharpImageCodec`                                        |
| `MediaJobQueuePort`      | Queue background media work                 | `BullMqMediaJobQueue`                                    |
| `CdnPurgePort`           | Purge CDN URLs                              | `CloudflareCdnPurge`, `LogOnlyCdnPurgeAdapter`           |
| `YouTubePort`            | Read channel uploads, check a video         | `YouTubeDataApi`                                         |
| `PaymentGatewayPort`     | Start, verify, enquire and refund a payment | `adapters-payments` (CCAvenue), bound and unused         |
| `MailboxPort`            | Read, send and label mail in a mailbox      | `GmailMailbox` (`adapters-mail-gmail`)                   |
| `ShippingPort`           | Obtain shipping quotes                      | None                                                     |
| `FxRatePort`             | Fetch INR exchange rates                    | None                                                     |
| `VideoTranscodePort`     | Queue HLS transcoding                       | None                                                     |

`DuplicateIdentifierError` carries an email or phone unique-index race across the persistence boundary without exposing a Mongo error.

## What belongs in a port

A port names a capability the application needs:

```ts
interface ShippingPort {
	getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]>;
}
```

It must not expose provider tokens, SDK clients, response classes, error payloads or configuration names. An adapter translates those.

## Port design checklist

- Is the interface in domain language?
- Are inputs and outputs stable across plausible providers?
- Does it avoid framework and SDK types?
- Does it express idempotency and correlation where the use case needs them?
- Can errors be translated into retryable categories?
- Can tests supply a deterministic in-memory implementation?
- Does it avoid becoming a general-purpose repository?
- Does transaction context cross only where atomic work requires it?

## Repository versus provider port

- A **repository port** loads and stores facts controlled by this platform.
- A **provider port** calls an external capability such as payment, shipping, messaging, search or storage.

Do not hide a provider call inside a Mongo repository. Do not make provider payloads part of a domain entity.

## Swappability test

To replace MongoDB with PostgreSQL:

1. Create a PostgreSQL adapter implementing the same ports.
2. Map SQL rows to domain values.
3. Change the composition bindings.
4. Run the same port contract tests.

If controllers, Angular clients, checkout rules or core pricing must change, the boundary has leaked.

## Contracts boundary

`packages/contracts` is the single source of shared shapes. Core may use those shapes with `import type` only. The compiled core must contain no contracts or zod import. Value imports from contracts, and all framework, adapter, database and provider imports, are forbidden.

ESLint enforces this rule. A runtime-purity test also compiles the package and rejects emitted imports outside Node built-ins and the package's own modules.

## Media pipeline

`packages/core-domain/src/media` owns image rules. `MediaService` in the API and the worker call them.

1. **Presign.** The API checks the declared type, size and dimensions, creates a `mediaAssets` record and returns a presigned PUT for a private original.
2. **Upload.** The browser sends the file directly to Spaces.
3. **Finalize.** The API queues a `process` job.
4. **Process.** The worker claims the asset, decodes the file, checks the decoded image again, computes a placeholder, renders each size and writes it under a content-hashed key with a one-year immutable cache header.
5. **Status.** The uploader polls until the state is `ready` or `failed`.

Public images are served by the CDN. A private image, such as a review photo awaiting moderation, is reachable only through a short-lived signed URL and is never cached.

Decoding is the real check: a renamed file fails here, and its object is deleted. Each render honours EXIF orientation, drops metadata, converts to sRGB, flattens transparency onto white and sharpens lightly after resizing. Review photos drop their original after processing.

### Ingest rules

| Rule                    | Value                                                              |
| ----------------------- | ------------------------------------------------------------------ |
| Accepted types          | JPEG, PNG                                                          |
| Maximum file size       | 25 MB                                                              |
| Maximum image size      | 8192 px long edge, 50 megapixels                                   |
| Minimum short edge      | 1600 px for product and category images                            |
| Target shape            | 3:4 product and category, 2:1 blog, 4:3 store, 1:1 avatar and icon |
| Review photos           | Five per review. A long edge below 500 px warns                    |
| Upload URL lifetime     | 15 minutes                                                         |
| Signed preview lifetime | 10 minutes                                                         |

An image more than 5% off its target shape receives a warning and is letterboxed on white. `GET /media/upload-rules` publishes these limits to clients.

### Size roles

`SEEDED_MEDIA_ROLES` defines the sizes: `thumb`, `card`, `gallery`, `zoom`, image swatches, `share`, `story`, `feed_square`, `email_thumb`, `review_thumb`, `review_full`, `brand_logo`, `brand_icon`, `site_share`, `banner`, `blog`, `store_photo`, `category_icon` and `avatar`. Operators can edit widths and quality from the admin application. Purposes, shape, fit and format are fixed in code.

Each role fits the image one of five ways: `inside` keeps the source shape, `cover` crops to fill the box, `pad` letterboxes on white, `blur` sets the image over a blurred enlargement of itself, and `story` places it above an empty band for a phone to write into. Two fixed fields adjust a fit: `inset` keeps a white margin inside a padded picture (`site_share` keeps 12%), and `brandStrip` draws the Brand Kit logo in a strip along the foot (`share`). See [Sharing and Brand](../storefront/sharing-and-brand.md).

The worker never upscales: a width the source cannot fill is skipped and reported. Banners skip widths beyond twice their slot's widest display. `share`, `story`, `feed_square` and `email_thumb` apply only to an image that serves as a product's main image (`servesAsPrimary`). Saving a product marks its first photo and queues a reprocess; the demo catalogue seed marks its photos the same way.

Editing a role's widths or quality increases its version. Files are written once: the new settings apply to files made afterwards. The 15-minute `reprocess-stale` job only regenerates files made before photo versions existed (those without a `versionId`); after the release migration there are none.

### Image profiles and versions

An image profile (`mediaProfiles`, `MediaProfileRepository`) says what the worker makes for one kind of use: a shape, or the photo's own shape; the size families it makes (role keys from `mediaRoles`); the fills it offers when a photo's shape differs; the smallest photo it wants (warn or refuse); the largest upload; and the accepted types. `SEEDED_MEDIA_PROFILES` in `media/profiles.ts` lists the twelve a database starts with:

| Profile             | Shape    | Size families                        | Fills offered                       | Built in |
| ------------------- | -------- | ------------------------------------ | ----------------------------------- | -------- |
| Product 3:4         | 3:4      | thumb, card, gallery, zoom, swatches | White padding, blurred fill, crop   | Yes      |
| Category 3:4        | 3:4      | thumb, card                          | White padding, blurred fill, crop   | Yes      |
| Hero 21:9           | 21:9     | banner                               | Crop, blurred fill, colour bars     | No       |
| Hero 16:9           | 16:9     | banner                               | Crop, blurred fill, colour bars     | No       |
| Phone banner 4:5    | 4:5      | banner                               | Crop, blurred fill                  | No       |
| Banner (keep shape) | Its own  | banner                               | —                                   | Yes      |
| Blog cover 2:1      | 2:1      | blog                                 | Crop, blurred fill                  | Yes      |
| Store photo 4:3     | 4:3      | store_photo                          | Crop, blurred fill, white padding   | Yes      |
| Square 1:1          | 1:1      | avatar, category_icon                | White padding, colour bars, crop    | No       |
| Browser icon 1:1    | 1:1      | brand_icon                           | White background, brand colour      | Yes      |
| Logo (keep shape)   | Its own  | brand_logo                           | —                                   | Yes      |
| Link preview 1.91:1 | 1200:630 | share                                | Blurred fill, made for a main photo | Yes      |

Stretching is never offered. A built-in profile can be edited and switched off but not deleted; each API start puts back a built-in profile that has gone missing (`reconcileBuiltInProfiles`) and never re-adds one an admin deleted. `GET /admin/media/profiles` lists them with how many photos hold a version of each.

A photo's **versions** (`MediaAsset.versions`) are its branches: one per profile and fill, with the id `profile.fill` (for example `hero_21x9.crop`), so a photo holds each version once. Each derivative carries the `versionId` it belongs to. Pictures made once per photo (`share`, `story`, `feed_square`, `email_thumb`, `site_share`) and review photos carry none. One version may hold the same role and width as another; within a version the pair is unique. A version records the profile's `version` it was made under; versions are written once, and later profile edits apply to versions made afterwards.

**Making versions.** A Media page photo upload (`POST /admin/media/library/files/presign`, JPEG or PNG) sends its size as the browser decoded it and the versions to make, a profile and a fill each. `checkVersionRequest` refuses, before a byte moves, a profile that does not exist, is switched off or is made by itself (the link preview), a fill the photo cannot have (`fillsForPhoto`: “As is” alone when the photo already has the shape, otherwise the profile's fills), a photo below a refusing minimum, over the profile's upload limit, or of a type it does not accept; a warning-only minimum adds `below_recommended_size`. `checkCaps` holds every photo to JPEG or PNG, 25 MB, 8192 px on the long edge and 50 megapixels. The storage check counts the original plus `estimateVersionBytes`. The versions are stored as `making`; finishing the upload queues a `process` job.

The worker re-checks every version against the decoded photo and makes it with `planVersion`: each of the profile's size families at each width, fitted by the fill — White padding and Brand colour pad onto white or the Brand Kit colour, Colour bars pad onto the photo's dominant colour, Blurred fill sets the photo over a blurred enlargement, Crop fills the box, As is keeps the photo whole. A family with its own box (the square swatches inside Product 3:4) keeps its own crop. Nothing is enlarged; banner widths beyond twice the slot are skipped. Files go under the version's folder, `media/{asset}/{profile-fill}/{slug}-{role}-{width}w-{hash}.webp` (`versionStorageKey`). Versions already made are never touched; pictures made once per photo are added only where missing. A version that cannot be made fails alone (`error`: a refusal code, `too_small` or `render_failed`) and its half-made files are deleted. `settleVersions` writes the run field by field, so a version asked for meanwhile stays `making`, and a new `reprocess` job (reason `versions`) picks it up. Every file is upright and carries no location or camera details (C1, C2, tested on real photos in `adapters-image-sharp`).

The release migration `0001-media-profiles-and-versions` adds the starting profiles and names the version every stored photo already is (`assignExistingVersions`): a product photo letterboxed on white becomes `product_3x4.white`, one already 3:4 becomes `product_3x4.as_is`, every banner becomes `banner_keep_shape.as_is`, a Brand Kit picture becomes `logo_keep_shape.as_is` plus `browser_icon_1x1.white`. No file moves or changes, and the date modified stays. A photo uploaded through the older purpose-based screens (no versions asked for) is still made by `planDerivatives` and named the same way afterwards.

### Deletion

A library delete is refused while anything uses the image. Otherwise the asset is soft-deleted. The daily garbage collection soft-deletes unreferenced assets older than 48 hours, restores any that gained an owner, and removes files 30 days after soft deletion. It runs as a dry run until `MEDIA_GC_LIVE` is true, and each run writes an audit record.

## Search boundary

`SearchPort` is bound to `MeilisearchSearch` in `apps/api/src/search/meilisearch-search.ts`. The index holds ids and words, and prices are read back from MongoDB. If the index is down, `GET /catalog/search` answers 503 and never falls back to a MongoDB text query. Product saves reach the index through the `searchOutbox` change queue, written in the same transaction, so a save never waits for search and no change is lost while search is down. The index is versioned (`products_v<SEARCH_INDEX_VERSION>`), built before a release switches, and checked nightly. See [Search index](./search-index.md).

Search counts go through `SearchAnalyticsRepository`, bound to `MongoSearchAnalyticsRepository`. It stores totals only: searches per normalised words and language in `searchQueryAggregates`, and search-result clicks per product per day in `analyticsDailyAggregates`. The ranking for Trending (`rankTrending`) and the word normaliser (`normalizeSearchQuery`) live in core-domain. Search words go through `SearchTermRepository`; `searchVocabulary` turns the live ones and the Storefront settings "show first" categories into index synonyms and per-product words. See [Storefront search](../storefront/search.md).

## Domain test strategy

Pure domain tests need no Nest application, network, MongoDB, wall clock or provider credentials. Inject clocks, identifiers and policies when determinism matters. Test rules, boundary values, rounding, lifecycle transitions, idempotency decisions and failure categories directly.
