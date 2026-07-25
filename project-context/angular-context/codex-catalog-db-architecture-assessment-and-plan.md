# Codex Catalog, Category, Product, Search, Commerce, and Reporting DB Architecture Assessment

**Status:** Target catalog, commerce, search, and reporting architecture
**Last reconciled:** 2026-07-25
**Authority:** `owner-decisions-log.md`; unresolved choices: `pending-decisions.md`

This is a target design, not proof that every collection or capability exists.
Current delivery status lives in `project-progress.md`; Zod contracts, adapter
models/indexes, tests, and runtime behavior govern implemented truth.

## 1. Sources Read

- Current `owner-decisions-log.md`, `pending-decisions.md`, and retained technical KB.
- Existing contracts, ports, Mongo models, mappers, repositories, seed data, tests, and catalog API surface.
- Live-site observations below are dated discovery evidence, not a current production inventory guarantee.
- User-provided product setup screenshot context: Fastkart status/setup toggles include Featured, Safe Checkout, Secure Checkout, Social Share, Encourage Order, Encourage View, Trending, Return, and Status; these must be retained in the custom product setup plan.
- Live `sahatextile.com` public WooCommerce data fetched on 2026-06-28:
    - `/wp-json/wc/store/v1/products?per_page=100` returned 23 public products.
    - `/wp-json/wc/store/v1/products/categories?per_page=100` returned 26 public category nodes.
    - `/wp-json/wp/v2/product_cat?per_page=100` returned 77 product-category terms.
    - `/product-sitemap.xml` listed 23 product URLs.
    - `/product_cat-sitemap.xml` listed 26 public product-category URLs.
    - Product pages parsed: `/product/salwaar-002/` and `/product/test-product-tailoring/`.

## 2. Context Already Locked

- Frontend stack is Angular + AnalogJS, Bootstrap 5/ng-bootstrap/SCSS, NgRx hybrid, TanStack Angular Query, Transloco, Workbox via `vite-plugin-pwa`, Vitest, Playwright.
- Fastkart is UI and behaviour reference only. It is not the architecture and must not be forked.
- Backend remains NestJS on Fastify.
- Architecture remains hexagonal: contracts and core-domain are inward; Mongo, search, payment, shipping, FX, and storage are edge adapters.
- MongoDB remains the primary database engine, but production is **self-hosted Docker MongoDB 8.3** on the DigitalOcean droplet, not Atlas. Local dev must run Docker MongoDB 8.3 with a single-node replica set through Docker Desktop for transaction parity.
- DigitalOcean Spaces stores media. Product/order documents store media metadata and Spaces keys, not image binaries.
- Canonical product price is INR. Other currencies are derived by the backend.
- Product archive/disable behavior is required because fashion inventory churns.
- Every business-editable storefront/admin string must be translatable through Transloco JSON keys or DB i18n objects.
- FAQ, Q&A, blog, category copy, product copy, SEO metadata, product relations, payment/shipping labels, and admin reporting labels must be modeled with translation readiness from day one.
- Storefront product cards must support manual and analytics-derived badges/markers such as Sale, Featured, Hot, Popular, Most Viewed, Most Bought, and Most Searched.
- Pricing, tax, FX, payment, shipping, purchase invoices, inventory costing, and analytics/reporting must be designed together because profit and business dashboards depend on all of them.

## 3. Resolved Infrastructure Decision

Earlier versions of this file discussed a MongoDB Atlas M0/free-tier conflict. That conflict is resolved by the owner decision recorded on 2026-06-29 and reinforced on 2026-07-04.

Production database plan:

- Self-host Docker MongoDB 8.3 on the DigitalOcean droplet.
- Enable a single-node replica set so multi-document transactions work.
- Bind Mongo only to the Docker private network; never expose public `27017`.
- Persist data through a named volume or bind-mounted data directory on the droplet SSD.
- Use resource caps and WiredTiger cache limits so Mongo does not starve API/search.
- Take scheduled backups and later archive backup/export artifacts to DigitalOcean Spaces.
- Use the same Docker MongoDB 8.3 single-node replica-set profile for local Mac development through Docker Desktop.

Atlas-specific capabilities such as Atlas Search, Atlas Data Federation, and Atlas Online Archive are no longer part of the launch plan. Mongo remains the source of truth; Meilisearch is the derived search index; Spaces stores media and possible future cold archive JSON.

## 4. Live Site Facts That Must Drive the Model

- Current public catalog: 23 products; 20 simple and 3 variable.
- Current public category tree: 26 public category URLs, but WordPress exposes 77 product-category terms, including empty/future/admin terms.
- Top-level public categories are `Saree`, `Dress Materials`, and `Uncategorized`.
- `Saree` is three levels deep in places:
    - `Saree > Jamdani > Dhakai Jamdani`
    - `Saree > Budget Range > Printed Chiffon`
    - `Saree > Printed > Pure Silk`
    - `Saree > Pure Cotton > Cotton Jamdani`
- `Dress Materials` currently has children:
    - `Banarasi`
    - `Cotton Chikankari`
    - `Georgette Chikankari`
- Duplicate display names exist under different paths. Example: `Pure Silk` exists as `saree/pure-silk` and as `saree/printed/pure-silk-printed`.
- Products can belong to many categories at once:
    - `Demo Saree 3` belongs to `Printed Silks`, `Pure Silk`, `Pure Silk` under Printed, and `Semi Silk`.
    - `Demo Saree 4` belongs to `Printed Chiffon`, `Printed Kalamkari`, `Royal Jamdani`, and `Traditional Jamdani`.
    - `Demo Saree 1` belongs to `Cotton Chikankari`, `Party Wear`, and `Saree`.
- Tags exist and are used as merchandising/search terms:
    - `Wedding Collection`
    - `black salwaar`
    - `red salwaar`
    - `black saree`
    - `red saree`
- Live attribute taxonomies:
    - `Blouse Designs`: variation-driving; terms `Blouse Design 1`, `Blouse Design 2`, `Blouse Design 3`, `No Blouse`.
    - `Salwaar Designs`: variation-driving; terms `No Stitching`, `Salwaar Design 1`, `Salwaar Design 2`, `Salwaar Design 3`, `Salwaar Design 4`.
    - `Color`: filter/descriptive on observed Salwaar products, not variation-driving in Woo Store API; terms `Black`, `Gray`, `Pink`, `Red`, `White`.
- `Salwaar 002` has 5 variation rows keyed only by `Salwaar Designs`, not by color:
    - `No Stitching`: INR 1000, regular INR 1400.
    - `Salwaar Design 1`: INR 1250, regular INR 1500.
    - `Salwaar Design 2`: INR 1530, regular INR 1560.
    - `Salwaar Design 3`: INR 1550, regular INR 1600.
    - `Salwaar Design 4`: INR 1750, regular INR 1800.
- `Salwaar 002` has conditional measurement add-ons:
    - `Shoulder`, `Waist`, `Sleeve`, `Chest`.
    - They show only for stitched design selections, not for `No Stitching`.
- `Test Product Tailoring` has 4 variation rows keyed by `Blouse Designs`:
    - `No Blouse`: INR 1800, regular INR 2000.
    - `Blouse Design 1`: INR 2000, regular INR 2250.
    - `Blouse Design 2`: INR 2200, regular INR 2300.
    - `Blouse Design 3`: INR 2300, regular INR 2350.
- `Test Product Tailoring` has conditional measurement add-ons:
    - `Shoulder`, `Waist`, `Sleeve`.
    - They show only for blouse design selections, not for `No Blouse`.
- Live WordPress plugins/features visible from page HTML:
    - WooCommerce variable products.
    - Woo variation swatches.
    - Advanced product fields for measurements.
    - Woo bought-together.
    - Wishlist.
    - Advanced Woo Search/live search.
    - Phone/email OTP login plugin.
    - Multi-currency/WPML WooCommerce multilingual.
    - AIOSEO metadata and JSON-LD.

## 5. Existing Repo Gaps

- `ProductStatus` is only `draft | published | archived`; the KB also discusses disabled/discontinued. The final contract should include a richer lifecycle.
- `Category` has a single `parentId`; live behavior and future merchandising need multi-placement or category/collection separation.
- Current product variants are embedded inside `products`. That is acceptable for the present catalog, but a first-class `productVariants` collection is cleaner for SKU uniqueness, stock changes, status changes, and search indexing.
- Current `ProductRepository.list()` uses regex over slug/SKU/tags. This is not sufficient for typeahead, multilingual aliases/transliteration, typo tolerance, suggestions, or large archived catalogs.
- SearchPort exists but is not wired to a real search adapter.
- Orders snapshot product lines, but tax, payment, shipment, return, refund, and audit collections are not yet fully separated.
- Category subtree querying currently relies on `parentId` and path arrays but not multi-placement.
- Seed data correctly captures the design/no-stitching pattern but does not reflect full live category complexity or conditional add-on rules yet.

## 6. Target Data Model Principles

- Separate taxonomy, merchandising collections, tags, attributes, variants, bundles, inventory, search dictionaries, and order snapshots.
- Treat category hierarchy as presentation and SEO structure, not as the only classification system.
- Allow one product to appear in many categories, collections, and campaign groupings.
- Preserve one canonical product URL, with optional secondary category placements and redirects.
- Store immutable snapshots on order lines so archived/deleted product changes never corrupt historical orders.
- Index only active storefront surfaces heavily. Archived items must be retained but cheap to store and cheap to ignore.
- Never run typeahead over full product documents.
- Store canonical product prices in INR; derive display currencies on the backend using persisted FX rates and admin-configured gateway markup rules.
- Keep MRP/sale price as catalog pricing; keep purchase price as inventory/accounting input. Do not mix the two.
- Preserve purchase-cost history at the inventory unit/layer level so gross margin, COGS, stock valuation, product/category profitability, and purchase reports can be produced later.
- Keep raw analytics small and temporary; materialize daily/monthly aggregates for admin dashboards instead of scanning raw events or orders on every dashboard load.
- Persist weekly business inference sets separately from raw reporting so storefront rails/banners and product-card badges can use stable curated data without querying analytics live.
- Keep admin-facing manual tags separate from transient analytics badges unless the admin explicitly promotes an insight into a tag.
- Never store images in Mongo.
- Do not make measurement fields variation axes. They are cart-line customization inputs.
- Do not model color as always variation-driving. It can be variation axis, filter-only attribute, or descriptive attribute per product.
- Do not model bought-together/cross-sell as product composition unless it affects cart pricing/inventory.
- Storefront category/sidebar filters are a separate facet layer. `filter_only` means eligible for search/facets; category/placement facet config decides public visibility, order, display style, counts, and SEO behavior.

## 7. Recommended Collections

### Cross-plan canonical inventory

The owner locked the developer portal’s Schema Nebula to **64 explicit collection nodes** on 2026-07-25. This document contributes 45 distinct catalog, content, commerce, inventory, and reporting collection names. The complete cross-plan inventory adds the reconciled auth family, notifications, `carts`, and `sequences`.

The count follows a one-node-per-physical-collection rule. Multi-collection headings below—such as `taxClasses` and `taxRules`—count separately. The auth plan’s former `securityAuditLogs` concept is absorbed by the broad `auditLogs` collection locked for admin and security evidence. The governed inventory lives in `docs/_data/instruments/schema-nebula.json`; it is a derived map of this plan, the auth plan, the backend roadmap, current adapter models, and owner decisions.

### 7.1 `categories`

Purpose: category/collection node identity, SEO metadata, labels, and admin lifecycle.

Recommended shape:

```ts
{
  _id: string;
  kind: 'taxonomy' | 'collection' | 'occasion' | 'fabric' | 'weave' | 'budget' | 'admin';
  name: Record<string, string>;
  slug: string;
  status: 'active' | 'hidden' | 'archived';
  description?: Record<string, string>;
  seo?: {
    title?: Record<string, string>;
    description?: Record<string, string>;
    canonicalPath?: string;
    noindex?: boolean;
  };
  media?: {
    bannerAssetId?: string;
    thumbnailAssetId?: string;
  };
  display?: {
    menuVisible: boolean;
    filterVisible: boolean;
    homepageVisible: boolean;
    displayOrder: number;
  };
  externalRefs?: {
    wooCategoryId?: number;
    legacyUrl?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Indexes:

- Unique `{ slug: 1 }`.
- `{ kind: 1, status: 1, 'display.displayOrder': 1 }`.

### 7.2 `categoryPlacements`

Purpose: arbitrary category nesting, duplicate display names under different paths, and multi-parent placement without corrupting node identity.

Recommended shape:

```ts
{
  _id: string;
  categoryId: string;
  parentCategoryId: string | null;
  pathCategoryIds: string[];
  pathSlugs: string[];
  pathLabel: string;
  depth: number;
  isCanonical: boolean;
  displayOrder: number;
  status: 'active' | 'hidden' | 'archived';
  externalRefs?: {
    legacyPath?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- A category can have multiple placements.
- Exactly one placement should be canonical if the category has storefront pages.
- `pathSlugs.join('/')` is the category route path.
- Moving a placement creates redirects from old paths.
- Prevent cycles at write time.

Indexes:

- Unique `{ pathSlugs: 1 }`.
- `{ categoryId: 1, isCanonical: 1 }`.
- `{ parentCategoryId: 1, status: 1, displayOrder: 1 }`.

### 7.2A `categoryFacetConfigs`

Purpose: control the Fastkart-style category/sidebar/off-canvas filter UI per category path without confusing product option semantics with storefront merchandising.

Recommended shape:

```ts
{
  _id: string;
  scope: 'global' | 'category' | 'category_placement' | 'product_group';
  categoryId?: string;
  categoryPlacementId?: string;
  productGroupId?: string;
  localeOverrides?: Record<string, Record<string, string>>;
  facets: Array<{
    code: string;
    source: 'category' | 'tag' | 'attribute' | 'variant_option' | 'price' | 'rating' | 'stock' | 'shipping' | 'merchandising_flag' | 'badge';
    attributeCode?: string;
    label: Record<string, string>;
    enabled: boolean;
    displayOrder: number;
    displayStyle: 'checkbox' | 'swatch' | 'range' | 'rating' | 'toggle' | 'chips' | 'radio';
    collapsedByDefault: boolean;
    showCounts: boolean;
    desktopVisible: boolean;
    mobileVisible: boolean;
    seoPolicy: 'never_index' | 'allow_curated_landing_only';
    valueLimit?: number;
    minCountToShow?: number;
  }>;
  status: 'active' | 'draft' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- Resolve facet config by most specific scope first: category placement, then category, then product group, then global default.
- `attributeDefinitions.filterConfig` controls eligibility/defaults; `categoryFacetConfigs` controls public sidebar exposure.
- A facet may be available in Meilisearch but hidden from a category UI if it would create noise or bad merchandising.
- Variation-axis facets must match products through active purchasable variants; do not show a size/color as available if every matching variant is inactive/out of stock unless the admin deliberately allows out-of-stock filtering.
- Product-level `filter_only` values match denormalized product metadata.
- Named add-ons and bundle component options are not sidebar facets by default; expose them only if the admin explicitly marks the facet as merchandising-relevant, e.g. `Custom blouse available`.
- Shipping filters are coarse flags (`domesticShipping`, `internationalShipping`, `codEligible`, `freeShippingEligible`). Exact pincode/courier serviceability remains PDP/cart/checkout.
- Rating filters use persisted product aggregates (`ratingAverage`, `ratingCount`, rating buckets), not live review scans. Aggregates are recomputed from **approved** verified reviews only (owner-locked 2026-07-23).
- Price facets use canonical INR effective prices; converted storefront ranges are translated to INR before filtering and converted back for display.
- Arbitrary facet combinations are `noindex,follow`; only curated `productGroups`/SEO routes may become indexable landing pages.

Indexes:

- `{ scope: 1, status: 1 }`.
- `{ categoryPlacementId: 1, status: 1 }`.
- `{ categoryId: 1, status: 1 }`.
- `{ productGroupId: 1, status: 1 }`.
- `{ pathCategoryIds: 1, status: 1 }`.

Why separate placements instead of only `parentId`: it handles `Pure Silk` in multiple merchandising contexts and future category overlaps without duplicating products or corrupting breadcrumbs.

### 7.3 `categoryRedirects`

Purpose: preserve SEO when Woo paths are cleaned, categories are merged, or archived category pages are redirected.

```ts
{
	_id: string;
	sourcePath: string;
	targetPath: string;
	statusCode: 301 | 302 | 410;
	reason: string;
	createdAt: Date;
}
```

Indexes:

- Unique `{ sourcePath: 1 }`.

### 7.4 `tags`

Purpose: loose merchandising and search labels, not hierarchy.

```ts
{
  _id: string;
  name: Record<string, string>;
  slug: string;
  type: 'style' | 'occasion' | 'color' | 'campaign' | 'search' | 'analytics' | 'system_badge' | 'legacy';
  status: 'active' | 'hidden' | 'archived';
  synonyms?: string[];
  externalRefs?: { wooTagId?: number };
}
```

Indexes:

- Unique `{ slug: 1 }`.
- `{ type: 1, status: 1 }`.

Rules:

- Tags have full CRUD in admin.
- Product setup must retain the searchable multi-select tag dropdown with selected chips/removable cross buttons.
- Categories and tags in product setup can share the same dropdown component pattern, configured for multi-select.
- Analytics-derived labels such as `Most Bought` may create `type: 'analytics'` tags only when the admin chooses to persist/promote them; normal weekly product-card markers should use `productBadgeAssignments` so SEO/search taxonomy is not polluted by temporary trends.

### 7.5 `attributeDefinitions`

Purpose: global attribute definitions and term dictionaries.

```ts
{
  _id: string;
  code: string;
  label: Record<string, string>;
  defaultRole: 'filter_only' | 'variation_axis' | 'named_add_on' | 'bundle_component_option' | 'descriptive' | 'search';
  defaultDisplayStyle: 'rectangle' | 'circle' | 'image_swatch' | 'color_swatch' | 'radio' | 'dropdown';
  valueType: 'term' | 'color' | 'number' | 'text';
  terms: Array<{
    code: string;
    label: Record<string, string>;
    slug: string;
    hex?: string;
    swatchAssetId?: string;
    aliases?: string[];
    isBase?: boolean;
  }>;
  filterConfig?: {
    visible: boolean;
    sortOrder: number;
    facetEligible?: boolean;
    defaultFacetDisplayStyle?: 'checkbox' | 'swatch' | 'range' | 'rating' | 'toggle' | 'chips' | 'radio';
    defaultFacetLabel?: Record<string, string>;
    showCountsByDefault?: boolean;
  };
  externalRefs?: {
    wooTaxonomy?: string;
  };
}
```

Rules:

- Fastkart's admin calls these records "Attributes"; in our domain they are reusable option/attribute definitions only.
- Business meaning is not decided globally here. A product can override `defaultRole` and `defaultDisplayStyle` per option group.
- `Color` may be filter-only on one product and variation-driving on another.
- `No Stitching` and `No Blouse` are base terms, not special hardcoded business rules.
- Attribute terms carry aliases for search and transliteration.
- `color_swatch` requires `hex`; `image_swatch` requires `swatchAssetId` or option media before publishing.
- `filterConfig` is only the reusable default. The public category/sidebar filter decision lives in `categoryFacetConfigs`.

Indexes:

- Unique `{ code: 1 }`.
- `{ 'terms.slug': 1 }`.

### 7.6 `addonTemplates`

Purpose: reusable tailoring/customization fields and conditional visibility.

```ts
{
  _id: string;
  code: string;
  label: Record<string, string>;
  fields: Array<{
    code: string;
    label: Record<string, string>;
    type: 'number' | 'text' | 'select';
    unit?: 'in' | 'cm';
    required: boolean;
    validation?: {
      min?: number;
      max?: number;
      decimals?: number;
    };
  }>;
  appliesWhen?: Array<{
    attributeCode: string;
    termCodes: string[];
  }>;
  status: 'active' | 'archived';
}
```

Examples:

- Blouse tailoring template: Shoulder, Waist, Sleeve; applies when `blouse_designs` is not `no_blouse`.
- Salwaar tailoring template: Shoulder, Waist, Sleeve, Chest; applies when `salwaar_designs` is not `no_stitching`.

### 7.7 `products`

Purpose: product identity, SEO, classification, option definitions, merchandising, lifecycle, and searchable summary.

Recommended shape:

```ts
{
  _id: string;
  productType: 'simple' | 'variable' | 'bundle' | 'grouped';
  title: Record<string, string>;
  slug: string;
  sku?: string;
  status: 'draft' | 'published' | 'hidden' | 'archived' | 'discontinued';
  lifecycle: {
    publishedAt?: Date;
    hiddenAt?: Date;
    archivedAt?: Date;
    discontinuedAt?: Date;
    archiveReason?: string;
  };
  merchandisingFlags: {
    featured: boolean;
    safeCheckout: boolean;
    secureCheckout: boolean;
    socialShare: boolean;
    encourageOrder: boolean;
    encourageView: boolean;
    trending: boolean;
    returnEligible: boolean;
    saleBadgeEnabled: boolean;
    saleBadgeSource: 'manual' | 'price_rule' | 'analytics' | 'disabled';
  };
  productCardBadges: Array<{
    code: 'sale' | 'new' | 'featured' | 'hot' | 'popular' | 'most_viewed' | 'most_bought' | 'most_searched' | 'trending';
    label: Record<string, string>;
    source: 'manual' | 'analytics' | 'promotion' | 'system';
    priority: number;
    startsAt?: Date;
    endsAt?: Date;
  }>;
  primaryCategoryId?: string;
  categoryIds: string[];
  tagIds: string[];
  attributeValues: Array<{
    attributeCode: string;
    termCodes?: string[];
    textValue?: string;
    numberValue?: number;
    isFilterable: boolean;
    isSearchable: boolean;
  }>;
  optionDefinitions: Array<{
    attributeCode: string;
    label: Record<string, string>;
    semanticRole: 'filter_only' | 'variation_axis' | 'named_add_on' | 'bundle_component_option';
    displayStyle: 'rectangle' | 'circle' | 'image_swatch' | 'color_swatch' | 'radio' | 'dropdown';
    requiredSelection: boolean;
    defaultTermCode?: string;
    terms: Array<{
      code: string;
      label: Record<string, string>;
      isBase?: boolean;
      swatchAssetId?: string;
      hex?: string;
      priceDeltaINR?: number;
      requiresMeasurements?: boolean;
      sortOrder: number;
    }>;
  }>;
  namedAddonGroups: Array<{
    code: string;
    label: Record<string, string>;
    displayStyle: 'rectangle' | 'circle' | 'image_swatch' | 'color_swatch' | 'radio' | 'dropdown';
    requiredSelection: boolean;
    defaultTermCode: string;
    optionTerms: Array<{
      code: string;
      label: Record<string, string>;
      priceDeltaINR?: number;
      swatchAssetId?: string;
      hex?: string;
      addonTemplateIds?: string[];
      sortOrder: number;
      status: 'active' | 'hidden' | 'archived';
    }>;
  }>;
  addonTemplateIds: string[];
  priceSummaryINR: {
    min: number;
    max: number;
    compareAtMin?: number;
    compareAtMax?: number;
  };
  media: {
    primaryAssetId?: string;
    galleryAssetIds: string[];
  };
  seo: {
    title?: Record<string, string>;
    description?: Record<string, string>;
    canonicalPath?: string;
    noindex?: boolean;
    ogTitle?: Record<string, string>;
    ogDescription?: Record<string, string>;
    ogImageAssetId?: string;
    robots?: 'index,follow' | 'noindex,follow' | 'noindex,nofollow';
    structuredDataMode?: 'auto' | 'manual_override' | 'disabled';
    structuredDataOverrides?: Record<string, unknown>;
  };
  relations: {
    relatedProductIds: string[];
    crossSellProductIds: string[];
    upsellProductIds: string[];
    boughtTogetherGroupIds: string[];
  };
  search: {
    normalizedTitle: string;
    aliases: string[];
    keywords: string[];
    localeTokens: Record<string, string[]>;
  };
  externalRefs?: {
    wooProductId?: number;
    legacyUrl?: string;
    importHash?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- Store only active merchandising/search fields on `products`.
- Product detail responses can join variants and add-on templates.
- `semanticRole` decides behavior; `displayStyle` decides only the Fastkart-style renderer.
- Only `variation_axis` option groups generate `productVariants` matrix rows.
- `named_add_on` groups customize included sub-parts/services and do not generate variant Cartesian products.
- `bundle_component_option` groups resolve through `productBundles` when they consume separate inventory.
- `filter_only` terms feed search/facets/display only.
- Archived products stay queryable in admin but are excluded from storefront, sitemap, search, related products, and typeahead.
- Product URL should use `seo.canonicalPath` or `/product/{slug}`. Category path should not be required to identify a product.

Indexes:

- Unique `{ slug: 1 }`.
- Unique sparse `{ sku: 1 }`.
- `{ status: 1, primaryCategoryId: 1, updatedAt: -1 }`.
- `{ status: 1, categoryIds: 1, updatedAt: -1 }`.
- `{ status: 1, tagIds: 1, updatedAt: -1 }`.
- `{ status: 1, 'priceSummaryINR.min': 1 }`.
- `{ status: 1, 'merchandisingFlags.saleBadgeEnabled': 1 }` for product-table filtering and storefront badge queries.
- `{ status: 1, tagIds: 1 }` for tag-filtered admin/storefront lists.
- `{ updatedAt: -1 }`.

Self-hosted Mongo note: keep indexes few and deliberate. Extra indexes still consume RAM/disk and can punish the small launch droplet even though the old 512 MB M0 ceiling is gone.

### 7.8 `productVariants`

Purpose: purchasable SKU rows, prices, stock, variant media, and option selections.

```ts
{
  _id: string;
  productId: string;
  sku?: string;
  status: 'active' | 'hidden' | 'archived' | 'discontinued';
  optionSelections: Array<{
    attributeCode: string;
    termCode: string;
  }>;
  optionSelectionHash: string;
  isBaseVariant: boolean;
  priceINR: number;
  compareAtPriceINR?: number;
  salePriceINR?: number;
  saleWindow?: {
    startsAt?: Date;
    endsAt?: Date;
  };
  stock: {
    tracked: boolean;
    quantity: number;
    lowStockThreshold?: number;
    allowBackorder: boolean;
  };
  shippingProfile?: {
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  };
  taxProfile?: {
    hsnCode?: string;
    taxClassId?: string;
  };
  media?: {
    primaryAssetId?: string;
  };
  externalRefs?: {
    wooVariationId?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- `optionSelectionHash` prevents duplicate rows for the same combination.
- Variant rows are generated only from product option groups whose `semanticRole = 'variation_axis'`.
- For `Salwaar 002`, variants are keyed by `salwaar_designs` only, while `Color` remains filter/descriptive unless explicitly made variation-driving.
- `No Stitching` and `No Blouse` rows should have `isBaseVariant: true`.
- Stock writes should target variants, not the parent product.
- Named add-ons such as a saree's attached `Blouse Design` group do not appear in `optionSelections`; they are cart/order-line customization selections with optional price deltas and measurement requirements.

Indexes:

- `{ productId: 1, status: 1 }`.
- Unique `{ productId: 1, optionSelectionHash: 1 }`.
- Unique sparse `{ sku: 1 }`.
- `{ status: 1, updatedAt: -1 }`.

### 7.9 `productBundles`

Purpose: true compound products, kits, sets, and multi-level grouped purchase logic.

This is separate from cross-sell, upsell, related products, bought-together displays, and named add-ons. Use it only when selecting one product changes cart lines, price policy, or inventory consumption by resolving to separate components.

```ts
{
	_id: string;
	productId: string;
	bundleType: 'fixed-kit' | 'choose-one-per-group' | 'optional-addons';
	pricePolicy: 'sum-components' | 'fixed-bundle-price' | 'discounted-components';
	groups: Array<{
		code: string;
		label: Record<string, string>;
		minSelections: number;
		maxSelections: number;
		components: Array<{
			productId: string;
			variantId?: string;
			quantity: number;
			required: boolean;
			priceAdjustmentINR?: number;
		}>;
	}>;
	allowNestedBundles: boolean;
	maxDepth: number;
	status: 'active' | 'archived';
}
```

Rules:

- Bundles must be acyclic.
- Resolve bundles into concrete order lines at checkout.
- Order lines must snapshot every resolved component.
- Default recommendation: `allowNestedBundles: false` for launch; use `maxDepth: 2` only if the business confirms real nested bundles.

### 7.10 `productRelations`

Purpose: explicit related-product, cross-sell, upsell, substitute, complete-the-look, and bought-together relationships.

This collection is for merchandising relationships that change discovery or cart suggestions but do not by themselves change pricing or inventory. If the relationship creates a single purchasable kit, use `productBundles` instead.

```ts
{
  _id: string;
  sourceProductId: string;
  relationType:
    | 'related'
    | 'cross_sell'
    | 'upsell'
    | 'bought_together'
    | 'complete_the_look'
    | 'substitute'
    | 'same_collection'
    | 'manual_feature';
  targetType: 'product' | 'variant' | 'product_group';
  targetId: string;
  surface: Array<'product_detail' | 'cart' | 'checkout' | 'post_purchase' | 'search_zero_state' | 'category_listing'>;
  rank: number;
  source: 'manual' | 'rule' | 'imported_woocommerce' | 'analytics';
  reason?: string;
  startsAt?: Date;
  endsAt?: Date;
  status: 'active' | 'paused' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- Product detail can show `related`, `same_collection`, and `complete_the_look`.
- Cart can show `cross_sell`, `bought_together`, and low-friction add-ons.
- Product detail comparison modules can show `upsell` and `substitute`.
- Checkout suggestions must not create surprise; use only low-risk `cross_sell` or `bought_together`.
- Relation targets must be `published/active` when surfaced publicly.
- If target product is archived, automatically pause the relation.
- Avoid circular upsell chains in UI: A upsells to B, B should not upsell back to A in the same slot.

Indexes:

- `{ sourceProductId: 1, relationType: 1, status: 1, rank: 1 }`.
- `{ targetId: 1, status: 1 }`.
- `{ surface: 1, status: 1 }`.

Self-hosted Mongo note: this is a small collection; keep only active and useful archived rows. Do not log every recommendation impression here.

### 7.11 `productGroups`

Purpose: curated product groupings, lookbooks, campaign rails, bought-together sets, and category landing-page sections.

Use this when multiple products need to be managed as one merchandising unit but are still bought as independent items.

```ts
{
  _id: string;
  groupType:
    | 'collection_rail'
    | 'complete_the_look'
    | 'bought_together'
    | 'festival_edit'
    | 'wedding_edit'
    | 'budget_edit'
    | 'new_arrivals'
    | 'clearance'
    | 'manual_admin_group';
  title: Record<string, string>;
  slug?: string;
  description?: Record<string, string>;
  status: 'draft' | 'active' | 'hidden' | 'archived';
  items: Array<{
    productId: string;
    variantId?: string;
    role?: 'primary' | 'supporting' | 'addon' | 'alternative';
    rank: number;
    label?: Record<string, string>;
  }>;
  rules?: {
    includeCategoryIds?: string[];
    includeTagIds?: string[];
    includeAttributeTerms?: Array<{ attributeCode: string; termCode: string }>;
    minPriceINR?: number;
    maxPriceINR?: number;
  };
  display: {
    surfaces: Array<'home' | 'category' | 'product_detail' | 'cart' | 'checkout' | 'blog' | 'search'>;
    categoryIds?: string[];
    startAt?: Date;
    endAt?: Date;
  };
  seo?: {
    routable: boolean;
    canonicalPath?: string;
    title?: Record<string, string>;
    description?: Record<string, string>;
    noindex?: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- `productGroups` may be manual, rule-based, or mixed.
- A `productGroups` record can drive a homepage rail, a product-detail complete-the-look block, or a cart bought-together block.
- If a group is routable, it needs canonical path, metadata, sitemap policy, and index/noindex policy.
- If a group is not routable, it should not generate a public URL.
- Do not use product groups for true bundle pricing; use `productBundles`.

Indexes:

- `{ groupType: 1, status: 1 }`.
- `{ 'display.surfaces': 1, status: 1 }`.
- `{ 'display.categoryIds': 1, status: 1 }`.
- Unique sparse `{ slug: 1 }`.

### 7.12 `seoRoutes`

Purpose: canonical route registry and SEO rendering source for products, categories, groups, blog pages, and static pages.

```ts
{
  _id: string;
  entityType: 'product' | 'category' | 'product_group' | 'blog_post' | 'page';
  entityId: string;
  locale: string; // configured active locale
  path: string;
  canonicalPath: string;
  status: 'indexable' | 'noindex' | 'redirect' | 'gone' | 'draft';
  title: string;
  metaDescription: string;
  h1?: string;
  breadcrumbs: Array<{
    label: string;
    path: string;
  }>;
  hreflangGroupId?: string;
  structuredDataTypes: Array<'Product' | 'ProductGroup' | 'BreadcrumbList' | 'ItemList' | 'FAQPage' | 'Organization' | 'WebSite'>;
  lastSignificantModifiedAt: Date;
  sitemap: {
    include: boolean;
    priority?: number;
    changefreq?: 'daily' | 'weekly' | 'monthly';
  };
  createdAt: Date;
  updatedAt: Date;
}
```

Rules:

- Every public indexable route has one `seoRoutes` row per locale.
- `path` and `canonicalPath` must be absolute path strings, not full origin URLs.
- Products with many category placements still have one canonical product URL.
- Category filters/facets do not create indexable routes unless explicitly whitelisted.
- Archived/discontinued products flip to `gone` or `redirect`, never silent soft-404.

Indexes:

- Unique `{ locale: 1, path: 1 }`.
- `{ entityType: 1, entityId: 1, locale: 1 }`.
- `{ status: 1, 'sitemap.include': 1, lastSignificantModifiedAt: -1 }`.

### 7.13 `seoRedirects`

Purpose: legacy WooCommerce URL preservation, category moves, product slug changes, and archived/discontinued routes.

```ts
{
  _id: string;
  sourcePath: string;
  targetPath?: string;
  statusCode: 301 | 302 | 410;
  reason: 'legacy_woo' | 'slug_change' | 'category_move' | 'product_archived' | 'category_archived' | 'manual';
  entityType?: string;
  entityId?: string;
  createdAt: Date;
}
```

Rules:

- Use `301` for permanent replacement.
- Use `410` for discontinued products with no suitable replacement.
- Use product/category target redirects only when intent remains equivalent.
- Never redirect all discontinued products to home; that is poor UX and weak SEO.

Indexes:

- Unique `{ sourcePath: 1 }`.
- `{ entityType: 1, entityId: 1 }`.

### 7.14 `inventoryLedger`

Purpose: stock audit without building a warehouse system.

```ts
{
  _id: string;
  variantId: string;
  productId: string;
  type: 'manual_adjustment' | 'order_reserved' | 'order_released' | 'order_fulfilled' | 'return_restocked' | 'damage_writeoff';
  quantityDelta: number;
  /** Required when type === 'manual_adjustment'. Fixed taxonomy (owner-locked 2026-07-23). */
  reasonCode?:
    | 'damage'
    | 'lost_missing'
    | 'manual_recount_correction'
    | 'supplier_shortage'
    | 'return_restocked'
    | 'return_not_restocked'
    | 'internal_use_sample'
    | 'photoshoot_display_use'
    | 'system_migration_correction'
    | 'other';
  /** Optional for most manual reason codes; mandatory when reasonCode === 'other'. */
  note?: string;
  orderId?: string;
  returnId?: string;
  actorUserId?: string;
  createdAt: Date;
}
```

Rules (owner-locked 2026-07-23):

- Manual adjustments **must** set `reasonCode` from the fixed enum above (not free-text reasons as the primary key).
- `note` is optional except when `reasonCode === 'other'` (then required).
- Automated `type` values keep their own provenance (`orderId` / `returnId`); they do not use the manual reason taxonomy.
- Prefer `type: 'manual_adjustment'` + `reasonCode: 'damage'` (etc.) over inventing parallel free-text `reason` strings for reporting.

Indexes:

- `{ variantId: 1, createdAt: -1 }`.
- `{ orderId: 1 }`.
- `{ type: 1, reasonCode: 1, createdAt: -1 }` (manual adjustment reports).

### 7.15 `mediaAssets`

Purpose: Spaces media catalogue, alt text, image reuse, and SEO metadata.

```ts
{
  _id: string;
  storageKey: string;
  publicUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  alt: Record<string, string>;
  usage: Array<{
    entityType: 'product' | 'variant' | 'category' | 'blog' | 'page';
    entityId: string;
  }>;
  externalRefs?: {
    wooMediaId?: number;
    legacyUrl?: string;
  };
  createdAt: Date;
}
```

Indexes:

- Unique `{ storageKey: 1 }`.
- `{ 'usage.entityType': 1, 'usage.entityId': 1 }`.

### 7.16 `searchDictionary`

Purpose: curated transliteration, misspelling, synonym, and merchandising query intelligence.

```ts
{
  _id: string;
  canonical: string;
  locale: string | 'mixed';
  aliases: string[];
  misspellings: string[];
  transliterations: string[];
  targetType: 'product' | 'category' | 'tag' | 'attribute' | 'query';
  targetIds: string[];
  boost: number;
  status: 'active' | 'archived';
  notes?: string;
  updatedAt: Date;
}
```

Examples to seed manually:

- `banarasi`: aliases `benaroshi`, `benarasi`, `banaroshi`, Bengali spellings.
- `saree`: aliases `sari`, `sharee`, Bengali spellings.
- `salwaar`: aliases `salwar`, `salwar suit`, `salwaar suit`.
- `jamdani`: aliases `jamdanee`.
- `chikankari`: aliases likely misspellings observed in search logs.

Rules:

- Do not rely on the search engine alone for locale-aware transliteration. Curate dictionary entries.
- Store only aggregate search learning, not user-identifiable search history.

### 7.17 `searchOutbox`

Purpose: reliable async sync from Mongo source-of-truth to search engine.

```ts
{
  _id: string;
  entityType: 'product' | 'variant' | 'category' | 'tag';
  entityId: string;
  operation: 'upsert' | 'delete';
  status: 'pending' | 'processing' | 'done' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Indexes:

- `{ status: 1, createdAt: 1 }`.
- `{ entityType: 1, entityId: 1, operation: 1 }`.

### 7.18 `searchQueryAggregates`

Purpose: suggestions, popular searches, no-result analysis, and spell-correction improvements.

```ts
{
  _id: string;
  normalizedQuery: string;
  locale?: string | 'mixed';
  count: number;
  resultCountAvg: number;
  lastSeenAt: Date;
  suggestedTargetIds?: string[];
}
```

Rules:

- Aggregate server-side.
- Do not store raw IP/user-level query logs beyond short operational TTL if not required.
- Use this to improve `searchDictionary`.

### 7.19 `promotions`

Purpose: scoped discounts/coupons/campaigns.

Keep the existing polymorphic design but add explicit targeting and lifecycle fields:

```ts
{
  _id: string;
  name: string;
  status: 'draft' | 'active' | 'paused' | 'expired' | 'archived';
  discountType: 'percentage' | 'fixed_inr' | 'free_shipping';
  value: number;
  scope: 'global' | 'category' | 'product' | 'variant' | 'attribute_term' | 'tag' | 'cart';
  targets: Array<{
    type: string;
    idOrCode: string;
  }>;
  couponCode?: string;
  stackable: boolean;
  priority: number;
  startsAt?: Date;
  endsAt?: Date;
  conditions?: {
    minCartINR?: number;
    firstOrderOnly?: boolean;
    customerRoles?: string[];
  };
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.20 `orders`

Purpose: commerce record and immutable customer-facing order state.

Order lines must snapshot:

- Product title and slug at purchase time.
- Product id and variant id if still available.
- SKU.
- Chosen attributes.
- Chosen add-on measurements.
- Product/variant image URL or asset id.
- Unit and total price in INR.
- Unit and total price in paid currency.
- Tax lines.
- Promotion lines.
- Return/refund eligibility facts.

Important addition:

```ts
lineSnapshot: {
  productStatusAtPurchase: string;
  productType: string;
  primaryCategoryId?: string;
  hsnCode?: string;
  taxClassId?: string;
}
```

Why: archived products must not affect order history, return processing, GST/tax reports, or refund calculations.

**Public track-order (owner-locked 2026-07-23):** not a launch feature. When later implemented, public lookup must require **order number + email or phone** match (never order-number-only), with rate limits and a minimal tracking response derived from order + shipment status — not a full order dump. Authenticated account order history remains the launch path.

### 7.21 `payments`

Purpose: gateway attempts and settlement data, separate from order.

```ts
{
  _id: string;
  orderId: string;
  gateway: 'ccavenue' | 'paypal';
  status: 'initiated' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
  amountPaid: number;
  currency: string;
  amountINR: number;
  gatewayRef?: string;
  rawProviderSummary?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

### 7.22 `shipments`

Purpose: Shiprocket/domestic/international shipment lifecycle.

```ts
{
  _id: string;
  orderId: string;
  provider: 'shiprocket' | 'manual' | 'other';
  status: 'quote' | 'label_created' | 'picked_up' | 'in_transit' | 'delivered' | 'failed' | 'cancelled';
  destination: Record<string, unknown>;
  package: {
    weightGrams?: number;
    lengthCm?: number;
    widthCm?: number;
    heightCm?: number;
  };
  quote: {
    value: number;
    currency: string;
    valueINR: number;
  };
  tracking?: {
    awb?: string;
    url?: string;
  };
  events: Array<{
    status: string;
    at: Date;
    raw?: Record<string, unknown>;
  }>;
}
```

### 7.23 `returns`

Purpose: return request and item-level return workflow.

```ts
{
  _id: string;
  orderId: string;
  userId?: string;
  status: 'requested' | 'approved' | 'rejected' | 'received' | 'closed';
  lines: Array<{
    orderLineId: string;
    quantity: number;
    reasonCode: string;
    condition?: string;
    restockDecision?: 'restock' | 'do_not_restock' | 'repair';
  }>;
  requestedAt: Date;
  resolvedAt?: Date;
}
```

### 7.24 `refunds`

Purpose: financial reversal records independent of return logistics.

```ts
{
  _id: string;
  orderId: string;
  returnId?: string;
  paymentId?: string;
  status: 'pending' | 'processed' | 'failed';
  amount: number;
  currency: string;
  amountINR: number;
  reason: string;
  gatewayRefundRef?: string;
  createdAt: Date;
}
```

### 7.25 `taxClasses` and `taxRules`

Purpose: GST/HSN/tax policy without baking tax into product forever.

```ts
{
  _id: string;
  name: string;
  hsnCode?: string;
  ratePct: number;
  includedInDisplayPrice: boolean;
  country: string;
  state?: string;
  status: 'active' | 'archived';
}
```

Order lines snapshot the resolved tax result.

### 7.26 `auditLogs`

Purpose: admin + security-sensitive accountability (owner-locked 2026-07-23: broad audit, tiered retention).

```ts
{
  _id: string;
  actorUserId?: string; // may be null for some system events; prefer always set when known
  actorAudience?: 'admin' | 'system';
  action: string;
  entityType: string;
  entityId: string;
  /** Important field diffs only — not unbounded full documents; never secrets/tokens/card data. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** Helps retention jobs: 'financial_security' | 'catalog_admin' | 'security_auth' etc. */
  retentionClass?: 'financial_security' | 'catalog_admin' | 'security_auth';
  ipHash?: string;
  requestId?: string;
  createdAt: Date;
}
```

Rules (owner-locked 2026-07-23):

- **Every admin mutating write** creates an audit row (floor). Explicit coverage includes catalog, pricing, inventory, purchase invoices, orders, payments/refunds, shipping/tax/gateway/currency/commission/notification config, RBAC/user-admin, admin auth failures/lockouts, session revocation/reuse-detection, relevant draft-restore conflicts.
- **Retention defaults:** `financial_security` / security auth family → **7 years**; catalog/general admin mutation → **5 years**. Accountant may lengthen financial/security; do not silently shorten.
- **Raw analytics events** are **not** this collection; after rollup retain raw events ~**90 days** then TTL/cold-archive.
- Redact secrets; prefer diffs; avoid unbounded before/after blobs. Cold-archive compacted audit JSON to Spaces only if disk pressure / retention policy requires (restore is explicit, not live query).

Indexes:

- `{ entityType: 1, entityId: 1, createdAt: -1 }`.
- `{ actorUserId: 1, createdAt: -1 }`.
- `{ retentionClass: 1, createdAt: 1 }` (retention/TTL jobs).
- `{ createdAt: -1 }` (admin viewer).

### 7.27 `faqEntries` and `contentBlocks`

Purpose: translatable storefront content for FAQs, category editorial copy, product help text, CMS blocks, and SEO-safe accordion content.

```ts
type FaqEntryDoc = {
	_id: string;
	ownerType: 'site' | 'product' | 'category' | 'product_group' | 'blog' | 'page';
	ownerId?: string;
	question: Record<string, string>;
	answerHtml: Record<string, string>;
	status: 'draft' | 'published' | 'archived';
	includeInStructuredData: boolean;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
};

type ContentBlockDoc = {
	_id: string;
	ownerType: 'home' | 'category' | 'product' | 'product_group' | 'blog' | 'page';
	ownerId?: string;
	placement: string;
	title?: Record<string, string>;
	bodyHtml?: Record<string, string>;
	ctaLabel?: Record<string, string>;
	ctaHref?: string;
	mediaAssetId?: string;
	status: 'draft' | 'published' | 'archived';
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- Product/category fields stay embedded as i18n objects when they belong only to that entity.
- Reusable or ordered content, especially FAQs, lives in `faqEntries`/`contentBlocks`.
- FAQ answers must render in initial SSR HTML and remain in the DOM when collapsed.
- Publish validation must require the default locale and report missing content for every configured active locale.

Indexes:

- `{ ownerType: 1, ownerId: 1, status: 1, sortOrder: 1 }`.
- `{ status: 1, updatedAt: -1 }`.

### 7.28 `currencies`

Purpose: admin-controlled enabled currencies, display settings, gateway selection, and rounding.

```ts
type CurrencyDoc = {
	_id: string;
	code: string; // INR, USD, GBP, EUR, etc.
	label: Record<string, string>;
	symbol: string;
	decimalPlaces: number;
	roundingMode: 'none' | 'nearest_0_01' | 'nearest_0_05' | 'nearest_1';
	enabled: boolean;
	isDefault: boolean;
	gateway: 'ccavenue' | 'paypal';
	rateFromINR: number;
	rateSource: string;
	rateFetchedAt: Date;
	staleAfter: Date;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- INR is canonical and always uses factor `1`.
- INR routes to CCAvenue; non-INR routes to PayPal unless explicitly disabled.
- Display price is calculated by backend; Angular never owns conversion math.

Indexes:

- Unique `{ code: 1 }`.
- `{ enabled: 1, isDefault: 1 }`.

### 7.29 `currencyExchangeRates`

Purpose: persisted FX history and audit trail for currency conversion.

```ts
type CurrencyExchangeRateDoc = {
	_id: string;
	baseCurrency: 'INR';
	quoteCurrency: string;
	rateFromINR: number;
	provider: 'exchangerate-api' | 'frankfurter' | 'exchangerate-host' | 'manual';
	fetchedAt: Date;
	validForDate: string; // YYYY-MM-DD
	staleAfter: Date;
	rawProviderSummary?: Record<string, unknown>;
	createdAt: Date;
};
```

Rules:

- Daily cron fetches and stores rates around 00:30 UTC.
- If provider fetch fails, keep yesterday's rate and mark stale; never overwrite valid rates with null.
- Admin dashboard should alert when rates are older than 48 hours.

Indexes:

- Unique `{ quoteCurrency: 1, validForDate: 1, provider: 1 }`.
- `{ quoteCurrency: 1, fetchedAt: -1 }`.

### 7.30 `paymentGatewayConfigs`

Purpose: payment gateway routing and non-secret configuration.

```ts
type PaymentGatewayConfigDoc = {
	_id: string;
	gateway: 'ccavenue' | 'paypal';
	status: 'active' | 'sandbox' | 'disabled';
	supportedCurrencies: string[];
	credentialSecretRefs: string[];
	redirectUrls: {
		successUrl: string;
		failureUrl: string;
		cancelUrl?: string;
	};
	settings: Record<string, unknown>;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- CCAvenue keys and PayPal secrets stay in env/secret storage, not Mongo plaintext.
- Mongo stores secret references, sandbox/live mode, supported currencies, and audit-friendly routing settings.

Indexes:

- Unique `{ gateway: 1 }`.
- `{ status: 1 }`.

### 7.31 `paypalCommissionRules`

Purpose: admin-editable PayPal gross-up settings per currency.

```ts
type PaypalCommissionRuleDoc = {
	_id: string;
	currency: string;
	status: 'active' | 'draft' | 'archived';
	percentFee: number; // 0.044 for 4.4%
	fixedFee: number; // fixed fee in the same currency, e.g. 0.30 USD
	extraPercentGrossUp?: number; // optional FX markup/admin buffer
	gstOnFeesPercent?: number; // if the business chooses to gross-up GST on gateway fees
	applyToProductSubtotal: boolean;
	applyToInternationalShipping: boolean;
	effectiveFrom: Date;
	effectiveTo?: Date;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- There must be at most one active rule per currency at a given time.
- Rules are versioned by effective dates so old orders can explain old calculations.
- Admin needs a calculator preview before saving: target net, gross charge, expected PayPal fee, expected net.

Indexes:

- `{ currency: 1, status: 1, effectiveFrom: -1 }`.

### 7.32 `shippingProviderConfigs`

Purpose: domestic and international shipping configuration behind `ShippingPort`.

```ts
type ShippingProviderConfigDoc = {
	_id: string;
	provider: 'shiprocket_domestic' | 'shiprocket_international' | 'manual_flat_rate' | 'other';
	lane: 'domestic' | 'international';
	status: 'active' | 'sandbox' | 'disabled';
	originCountry: string;
	serviceableCountries: string[];
	credentialSecretRefs: string[];
	fallbackPolicy?: {
		enabled: boolean;
		value: number;
		currency: string;
	};
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- Domestic and international logic stay separate even if both initially use Shiprocket.
- Adapter selection is based on destination country and provider availability.
- Future DHL/FedEx/Aramex adapters should add rows here without changing checkout contracts.

Indexes:

- `{ lane: 1, status: 1 }`.
- `{ provider: 1, status: 1 }`.

### 7.33 `shippingRateQuotes`

Purpose: quote snapshots for cart/checkout, order audit, and margin reporting.

```ts
type ShippingRateQuoteDoc = {
	_id: string;
	cartId?: string;
	orderId?: string;
	provider: string;
	lane: 'domestic' | 'international';
	serviceCode?: string;
	serviceName?: string;
	destinationCountry: string;
	destinationPostalCode?: string;
	packageSummary: {
		weightGrams?: number;
		lengthCm?: number;
		widthCm?: number;
		heightCm?: number;
	};
	providerValue: number;
	providerCurrency: string;
	valueINR: number;
	displayCurrency: string;
	displayValue: number;
	paypalGrossedUpDisplayValue?: number;
	etaDaysMin?: number;
	etaDaysMax?: number;
	expiresAt: Date;
	rawProviderSummary?: Record<string, unknown>;
	createdAt: Date;
};
```

Rules:

- Store both returned value and returned currency.
- Convert shipping through stored FX rates.
- Apply PayPal gross-up to shipping only for international PayPal checkout.
- Use TTL for abandoned quote rows; orders keep copied shipment/payment snapshots.

Indexes:

- `{ cartId: 1, createdAt: -1 }`.
- `{ orderId: 1 }`.
- TTL `{ expiresAt: 1 }`.

### 7.34 `purchaseInvoices`

Purpose: admin entry of supplier purchase invoices to add stock, capture purchase cost, and support purchase/profit reports.

```ts
type PurchaseInvoiceDoc = {
	_id: string;
	supplierId?: string;
	supplierNameSnapshot: string;
	invoiceNumber: string;
	invoiceDate: Date;
	status: 'draft' | 'posted' | 'void';
	currency: 'INR';
	subtotalTaxInclusiveINR: number;
	subtotalTaxExclusiveINR?: number;
	taxTotalINR?: number;
	grandTotalINR: number;
	notes?: string;
	attachmentMediaIds: string[];
	postedAt?: Date;
	postedByUserId?: string;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- Purchase invoice is inventory/accounting input, not a customer invoice.
- Posting an invoice creates inventory ledger entries and inventory cost layers.
- Voiding a posted invoice must be restricted and audited because it affects stock valuation.

Indexes:

- Unique sparse `{ supplierNameSnapshot: 1, invoiceNumber: 1 }`.
- `{ status: 1, invoiceDate: -1 }`.

### 7.35 `purchaseInvoiceLines`

Purpose: physical supplier invoice line item replication and stock intake per product/variant.

```ts
type PurchaseInvoiceLineDoc = {
	_id: string;
	purchaseInvoiceId: string;
	lineNo: number;
	productId: string;
	variantId?: string;
	productTitleSnapshot: Record<string, string>;
	skuSnapshot?: string;
	quantityReceived: number;
	unitPurchasePriceTaxInclusiveINR: number;
	unitPurchasePriceTaxExclusiveINR?: number;
	purchaseTaxRatePct?: number;
	purchaseTaxAmountINR?: number;
	catalogMrpINR: number;
	catalogSalePriceINR?: number;
	lineTotalINR: number;
	inventoryCostLayerId?: string;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- `catalogMrpINR` and `catalogSalePriceINR` are fetched from catalog and read-only on this screen.
- The purchase invoice screen must not create product batches or allow different MRP for the same product.
- Purchase price is editable because it drives COGS, profit/loss, purchase reports, and stock valuation.
- For variable products, the line must identify the variant/SKU actually received.

Indexes:

- `{ purchaseInvoiceId: 1, lineNo: 1 }`.
- `{ productId: 1, variantId: 1, createdAt: -1 }`.

### 7.36 `inventoryCostLayers`

Purpose: unit-cost history for COGS and margin reporting without exposing batch complexity to catalog pricing.

```ts
type InventoryCostLayerDoc = {
	_id: string;
	sourceType: 'purchase_invoice' | 'manual_adjustment' | 'return_restock';
	sourceLineId: string;
	productId: string;
	variantId?: string;
	quantityReceived: number;
	quantityRemaining: number;
	unitCostINR: number;
	valuationMethod: 'fifo' | 'weighted_average';
	receivedAt: Date;
	closedAt?: Date;
	createdAt: Date;
};
```

Rules:

- This is an internal costing layer, not a customer-facing batch model.
- Recommended launch valuation: FIFO. It supports unit-level profit without changing catalog MRP/sale price behavior.
- Order line fulfillment should snapshot the cost layer or weighted average used for COGS.

Indexes:

- `{ productId: 1, variantId: 1, quantityRemaining: 1, receivedAt: 1 }`.
- `{ sourceLineId: 1 }`.

### 7.37 `analyticsEvents`

Purpose: raw storefront/admin event capture for reporting rollups.

```ts
type AnalyticsEventDoc = {
	_id: string;
	eventType:
		| 'product_view'
		| 'category_view'
		| 'search'
		| 'search_no_result'
		| 'add_to_cart'
		| 'remove_from_cart'
		| 'checkout_started'
		| 'checkout_abandoned'
		| 'order_placed'
		| 'product_bought'
		| 'wishlist_add'
		| 'coupon_applied'
		| 'admin_product_saved'
		| 'admin_purchase_invoice_posted';
	userId?: string;
	guestId?: string;
	sessionId?: string;
	productId?: string;
	variantId?: string;
	categoryId?: string;
	searchQuery?: string;
	normalizedSearchQuery?: string;
	locale?: string | 'mixed';
	currency?: string;
	valueINR?: number;
	metadata?: Record<string, unknown>;
	occurredAt: Date;
	expiresAt?: Date;
};
```

Rules:

- Raw events should still use short retention on the launch droplet; roll up daily before TTL expiry.
- Do not store unnecessary PII. Use user/guest/session ids and hashed IP only if needed.
- Consent policy must control analytics/marketing events.

Indexes:

- `{ eventType: 1, occurredAt: -1 }`.
- `{ productId: 1, eventType: 1, occurredAt: -1 }`.
- `{ normalizedSearchQuery: 1, occurredAt: -1 }`.
- TTL `{ expiresAt: 1 }` for raw events when enabled.

### 7.38 `analyticsDailyAggregates` and `businessReportSnapshots`

Purpose: admin dashboard/reporting without expensive live scans.

```ts
type AnalyticsDailyAggregateDoc = {
	_id: string;
	date: string; // YYYY-MM-DD
	grain: 'site' | 'product' | 'variant' | 'category' | 'search_query' | 'currency' | 'gateway';
	key: string;
	metrics: {
		views?: number;
		searches?: number;
		noResultSearches?: number;
		addToCart?: number;
		checkoutStarted?: number;
		abandonedCarts?: number;
		orders?: number;
		unitsSold?: number;
		grossSalesINR?: number;
		discountsINR?: number;
		taxINR?: number;
		shippingChargedINR?: number;
		paymentFeesEstimatedINR?: number;
		refundsINR?: number;
		cogsINR?: number;
		grossProfitINR?: number;
		purchaseQty?: number;
		purchaseCostINR?: number;
	};
	updatedAt: Date;
};

type BusinessReportSnapshotDoc = {
	_id: string;
	reportType:
		| 'dashboard'
		| 'sales'
		| 'purchase'
		| 'inventory'
		| 'tax'
		| 'shipping'
		| 'payments'
		| 'search'
		| 'abandoned_cart';
	period: 'daily' | 'weekly' | 'monthly';
	periodStart: Date;
	periodEnd: Date;
	payload: Record<string, unknown>;
	generatedAt: Date;
};
```

Reports supported:

- Most searched terms and no-result terms.
- Most viewed products/categories.
- Most bought products/variants/categories.
- Abandoned carts and checkout drop-off.
- Sales by product, category, date, currency, payment gateway, and customer segment.
- Purchase invoice totals by supplier, product, category, and date.
- Inventory value, low stock, slow moving stock, and stock aging.
- Gross margin by unit, SKU, product, category, and order.
- Tax collected, refunds, shipping charged, shipping cost, and estimated gateway fees.
- Weekly persisted inference sets for storefront rails/banners and product-card badges.

Indexes:

- Unique `{ date: 1, grain: 1, key: 1 }`.
- `{ reportType: 1, period: 1, periodStart: -1 }`.

### 7.39 `productInsightSets`

Purpose: weekly persisted business inference sets that can power storefront homepage rails/banners and admin merchandising decisions.

```ts
type ProductInsightSetDoc = {
	_id: string;
	insightType:
		| 'most_searched'
		| 'most_viewed'
		| 'most_bought'
		| 'most_added_to_cart'
		| 'trending'
		| 'hot'
		| 'popular'
		| 'abandoned_cart_recovery'
		| 'manual_featured';
	title: Record<string, string>;
	status: 'draft' | 'active' | 'archived';
	source: 'weekly_analytics_job' | 'manual' | 'hybrid';
	periodStart: Date;
	periodEnd: Date;
	generatedAt: Date;
	validFrom: Date;
	validUntil: Date;
	storefrontSurfaces: Array<'home_rail' | 'home_banner' | 'category_rail' | 'search_zero_state' | 'cart_cross_sell'>;
	items: Array<{
		productId: string;
		variantId?: string;
		rank: number;
		score: number;
		metrics: {
			searches?: number;
			views?: number;
			unitsSold?: number;
			revenueINR?: number;
			addToCart?: number;
			conversionRate?: number;
		};
		badgeCode?: string;
		tagId?: string;
	}>;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- Generate from `analyticsDailyAggregates`, `searchQueryAggregates`, orders, and product availability once per week.
- Storefront must read stable `active` insight sets, not live analytics queries.
- Exclude hidden/archived/discontinued/out-of-stock products unless the insight is admin-only.
- Admin can review, reorder, suppress, or pin products before the set is used on homepage rails.
- These sets produce homepage modules such as `Most Searched`, `Most Viewed`, `Most Bought`, `Trending Now`, or `Hot Picks`.

Indexes:

- `{ insightType: 1, status: 1, validFrom: -1 }`.
- `{ status: 1, validUntil: 1 }`.

### 7.40 `productBadgeAssignments`

Purpose: materialized product-card badges/markers from manual admin settings, sale status, promotions, and weekly analytics insight sets.

```ts
type ProductBadgeAssignmentDoc = {
	_id: string;
	productId: string;
	variantId?: string;
	badgeCode:
		| 'sale'
		| 'new'
		| 'featured'
		| 'hot'
		| 'popular'
		| 'most_viewed'
		| 'most_bought'
		| 'most_searched'
		| 'trending';
	label: Record<string, string>;
	source: 'manual_product_flag' | 'promotion' | 'weekly_insight' | 'system';
	sourceId?: string;
	priority: number;
	status: 'active' | 'suppressed' | 'expired';
	startsAt?: Date;
	endsAt?: Date;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules:

- Product cards render badges from this materialized collection or from API summaries derived from it.
- The manually controlled sale status switch writes/updates `sale` assignments.
- Weekly insight jobs may create `most_viewed`, `most_bought`, `most_searched`, `popular`, `hot`, or `trending` assignments.
- Do not show too many markers on one card; API should return the highest-priority 1-2 badges for card surfaces.
- Sale status is manual/admin-visible even if sale price exists; this lets admin show or hide the sale banner deliberately.

Indexes:

- `{ productId: 1, status: 1, priority: 1 }`.
- `{ badgeCode: 1, status: 1 }`.
- `{ source: 1, sourceId: 1 }`.

### 7.41 `reviews`

Purpose: product reviews/ratings with verified-purchase eligibility and admin moderation (owner-locked 2026-07-23).

```ts
type ReviewDoc = {
	_id: string;
	productId: string;
	variantId?: string;
	userId: string;
	orderId: string; // purchase proof; one logical review per user+product (policy at API)
	rating: 1 | 2 | 3 | 4 | 5;
	title?: Record<string, string>; // optional; body is primary
	body: Record<string, string>; // at least one active locale required at submit
	imageMediaAssetIds?: string[]; // optional; same mediaAssets pipeline
	status: 'pending' | 'approved' | 'rejected' | 'hidden';
	verifiedPurchase: true; // always true for accepted submissions; reject if not verifiable
	moderatedByUserId?: string;
	moderatedAt?: Date;
	moderationNote?: string;
	createdAt: Date;
	updatedAt: Date;
};
```

Rules (owner-locked 2026-07-23):

- Submitters must be **logged in** with a **verified purchase** of the product; guests use login-to-review + pending-intent replay.
- Content: **star + text required**; **images optional**.
- Public storefront lists and rating aggregates (`ratingAverage`, `ratingCount`, buckets) include **`status: 'approved'` only**.
- Admin moderation queue required (approve / reject / hide). No auto-publish.
- Do not emit review/rating JSON-LD from pending or fake data.

Indexes:

- `{ productId: 1, status: 1, createdAt: -1 }`.
- Unique `{ userId: 1, productId: 1 }` (one review per user per product unless a future policy explicitly allows edits/replacements).
- `{ status: 1, createdAt: -1 }` (admin queue).

## 8. Product Type Strategy

### Option Semantics Rule

This rule is locked and must guide admin UI, API contracts, validation, search, cart, and order snapshots:

- If an option changes the main sellable item's SKU, stock, price row, image, base identity, or purchasability, model it as a `variation_axis` and generate `productVariants` rows.
- If an option customizes an included sub-part or service, model it as a `named_add_on` group and snapshot the selection on the cart/order line.
- If an option consumes separate inventory/components as a kit, model it as a `bundle_component_option` backed by `productBundles`.
- If an option is only searchable, filterable, or display-only, model it as `filter_only` / descriptive metadata.

Fastkart's visual styles are retained as `displayStyle` values only: `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`. The style does not decide whether something is a variation, add-on, bundle component, or filter.

### Simple Product

Use for one purchasable item without option-dependent price or stock.

Examples from live site:

- `Payment Test Product`
- many `Demo Saree` items

Implementation:

- `products.productType = 'simple'`
- one implicit or explicit variant row in `productVariants`
- product-level `attributeValues` for filters like Color/Fabric

### Variable Product

Use for selectable attributes that change price, image, stock, SKU, or purchasability.

Examples from live site:

- `Salwaar 002`
- `Salwaar 001`
- `Test Product Tailoring`

Implementation:

- `products.productType = 'variable'`
- product has `optionDefinitions`
- each variant has concrete `optionSelections` generated only from `variation_axis` groups
- add-on templates attach to product and use conditional visibility rules

Example nuance:

- A standalone blouse product can use `Blouse Design` as a normal variation axis when each design is a true sellable blouse variant.
- A saree that includes a blouse-piece cloth should keep the saree as the base sellable product; `Blouse Design` is a required named add-on group with default `No Design`, not a saree variation axis.
- Multiple named add-on groups are allowed, e.g. `Blouse Design` and `Aachol/Churni Design`, each with its own default option, media, price delta, and measurement requirements.

### Grouped Product

Use for display grouping only: related items, complete-the-look, bought-together suggestions, lookbook rails, and manually curated product clusters.

Implementation:

- Store durable merchandising groups in `productGroups`.
- Store source-product-to-target-product relationships in `productRelations`.
- Does not change inventory consumption by itself.
- Can be routable only when `productGroups.seo.routable = true`; otherwise it is a display module.
- If a grouped item becomes a single purchasable kit with special price/inventory, convert it to `productBundles`.

### Bundle / Compound Product

Use only when purchasing the parent creates multiple component lines or consumes multiple inventories.

Implementation:

- `products.productType = 'bundle'`
- details live in `productBundles`
- cart resolves to component lines before order placement
- order snapshots both the parent bundle and component lines
- bundle option groups may visually reuse the same Fastkart display styles, but they do not generate product variant Cartesian rows.

### Tailoring Service

Do not model as separate product unless it can be bought independently.

Recommended default:

- Keep tailoring as `addonTemplates` attached to products.
- Measurement values are cart-line and order-line customization data.
- If tailoring later has separate pricing/labor SKUs, add a service component through `productBundles` or price adjustment rules.

## 9. Search Architecture

### 9.1 Hard Requirement

The desired experience is not basic search:

- Minimum 3 characters.
- Every character after 3 triggers typeahead.
- Fast backend response.
- Typo tolerance.
- Missing characters.
- Suggested spellings.
- Locale-aware transliteration and spelling variants (including future Bengali support).
- Merchandising boosts.
- Category/product/tag suggestions.
- Free or self-hosted; no Algolia.

### 9.2 Recommended Engine

Recommended primary: self-host **Meilisearch** behind `SearchPort`.

Reason: the owner prioritizes a free, high-quality typo-tolerant typeahead experience with locale-aware aliases and transliteration, suggested spellings, no-result learning, and admin-curated dictionary growth. Meilisearch gives the simplest operations for that goal. Typesense remains a possible future adapter behind `SearchPort`, not the launch target.

Both are free open-source engines when self-hosted. Both must be treated as derived indexes, not source-of-truth databases.

Self-hosted MongoDB remains source of truth. Search engine stores only published searchable documents and can be destroyed/rebuilt from Mongo at any time.

### 9.3 Why Mongo Regex Is Not Acceptable

Regex over `slug`, `sku`, and `tags` cannot provide:

- typo tolerance like `benaroshi` -> `banarasi`
- mixed-script transliteration for configured dictionaries
- ranking by popularity, category, stock, and exact match
- suggestion generation
- low-latency typeahead under growing archive volume

### 9.4 Atlas Search Is Not A Launch Dependency

Atlas Search is no longer part of the launch plan because production MongoDB is self-hosted on the droplet. Do not design the search experience around Atlas-only features.

If Meilisearch is temporarily unavailable in a local/dev environment, the fallback may be a degraded prefix/token search for developer convenience only. Production storefront typeahead must use the `SearchPort` Meilisearch adapter. A Meilisearch-class experience is not realistic with Mongo regex or handcrafted n-gram queries alone.

### 9.5 Search Document Shape

Only index published products and active categories.

```ts
{
  id: string;
  entityType: 'product' | 'category' | 'tag';
  titleByLocale: Record<string, string>;
  slug: string;
  sku?: string;
  categoryIds: string[];
  categoryNamesByLocale: Record<string, string[]>;
  tagNamesByLocale: Record<string, string[]>;
  attributesByLocale: Record<string, string[]>;
  aliases: string[];
  misspellings: string[];
  transliterations: string[];
  priceMinINR?: number;
  priceMaxINR?: number;
  imageUrl?: string;
  status: 'published' | 'active';
  popularityScore: number;
  inventoryScore: number;
  updatedAt: string;
}
```

### 9.6 Query Pipeline

For storefront typeahead:

1. Client starts at 3 characters.
2. Client debounces 120-180 ms.
3. Client aborts the previous request when a newer character arrives.
4. API rate-limits by IP/session.
5. API normalizes query:

- lowercase
- trim punctuation
- normalize repeated spaces
- normalize known spelling variants
- detect Bengali vs Latin vs mixed script

6. API expands query using `searchDictionary`.
7. Search adapter queries Meilisearch with:

- filter `status = published`
- optional category filters
- typo tolerance enabled
- prefix search enabled
- facets for configured category/sidebar filters such as category, tag, price, color, fabric, sale/featured badges, rating bucket, stock availability, and coarse shipping eligibility

8. API returns:

- products
- categories
- suggested queries
- corrected spelling if confidence is high

9. API aggregates query stats into `searchQueryAggregates`.

### 9.7 Search Reindex Lifecycle

Events that must enqueue `searchOutbox`:

- Product created.
- Product title/slug/categories/tags/attributes/media/status changes.
- Variant price/status/stock changes affecting visible price/availability.
- Category title/slug/path/status changes.
- Tag changes.
- Search dictionary changes.

Rules:

- `published -> archived/hidden/discontinued` deletes the product from search immediately.
- `draft -> published` indexes only after all required SEO/media/price validations pass.

## 10. Rigorous SEO Architecture

SEO is not a frontend-only concern. It must be modeled in DB, validated in admin, rendered by Angular/Analog SSR, and protected by redirects and lifecycle rules.

### 10.1 Canonical Route Policy

- Route records are locale-aware, but the permanent prefix/canonical convention
  remains gated by `DEC-I18N-ROUTES`.
- Product and category routes must be generated from one centralized route
  policy rather than hard-coded locale pairs.
- Category paths come from canonical `categoryPlacements.pathSlugs`.
- Product groups become routable only when `productGroups.seo.routable = true`; otherwise they are display modules only.
- Every canonical route must have exactly one `seoRoutes` row per locale.
- Every legacy WooCommerce route imported from the live site must become either a canonical route or a `seoRedirects` row.
- Category path moves create redirects; product slug changes create redirects.
- Archived/discontinued products return `410 Gone` unless there is a strong replacement product/category for a `301`.

### 10.2 Structured Data Policy

Render JSON-LD server-side on the initial HTML. Do not lazy-inject critical schema only after hydration.

Product detail pages should generate:

- `Product` for simple products.
- `ProductGroup` or a Product-with-variant representation for variable products when variants are materially different by design/color/size.
- `Offer` or `AggregateOffer` with INR canonical/displayed active currency price, availability, and valid-through policy.
- `BreadcrumbList` using canonical breadcrumbs.
- `FAQPage` only where real FAQ content is rendered in initial HTML.
- `Organization` and `WebSite` from site-wide config.

Category and group pages should generate:

- `ItemList` for visible product cards.
- `BreadcrumbList`.
- Optional FAQ/content schema only when meaningful editorial content exists.

Rules:

- Do not emit fake review/rating schema. Use only stored **approved, verified-purchase** review data (owner-locked 2026-07-23: moderation before publish; optional images).
- Do not emit out-of-stock variants as available.
- Do not expose draft/hidden/archived products in structured data.
- Product schema must use the canonical product URL, not every category placement URL.

### 10.3 Faceted Navigation and Filter SEO

Most filter combinations should not be indexable. They create duplicate/thin pages and waste crawl budget.

Default policy:

- Category base pages: indexable.
- Search result pages: `noindex,follow`.
- Arbitrary filters/sort/pagination URLs: canonical to the base category and `noindex,follow` unless explicitly whitelisted.
- Whitelisted SEO landing pages are modeled as `productGroups` or explicit category/collection routes, not accidental query strings.
- Examples of possible whitelisted landing pages: `Wedding Banarasi Sarees`, `Budget Range Sarees`, `Cotton Chikankari Dress Materials`.
- `categoryFacetConfigs.facets[].seoPolicy` is advisory only; actual indexability still requires a deliberate `seoRoutes`/`productGroups` record.

### 10.4 Sitemap Policy

Generate locale-aware sitemaps from `seoRoutes`, not by crawling the frontend.

Include only:

- `seoRoutes.status = indexable`.
- `sitemap.include = true`.
- Published products.
- Active categories/placements.
- Routable active product groups.
- Published blog/static content.

Exclude:

- Search pages.
- Cart/account/checkout/admin pages.
- Filter URLs unless explicitly modeled as SEO landing pages.
- Hidden/archived/discontinued products.
- Empty categories unless owner intentionally wants editorial category pages.

### 10.5 Hreflang and Transloco/DB Content

- Every indexable route must declare alternates for each configured active
  locale where that route exists.
- Add `x-default` to the approved default-locale route.
- If configured-locale content is missing, use the approved fallback while keeping route metadata explicit so gaps remain visible in admin QA.
- Slug script policy must be chosen deliberately and applied consistently.

### 10.6 Product Publish SEO Gate

A product cannot move to `published` unless these pass:

- Title exists for default locale.
- Slug is unique.
- Primary category exists and has a canonical active placement.
- At least one active variant/purchasable row exists.
- Price summary is valid.
- Primary image exists with alt text.
- Meta title and description are present or auto-generated within configured length targets.
- Structured data can be generated without missing required price/availability fields.
- Search document can be generated.
- Related/cross-sell/upsell targets, if configured, are active or automatically suppressed.

### 10.7 Related Products and Internal Linking for SEO

Related modules are not only merchandising. They shape crawl paths and topical relevance.

Rules:

- Product detail pages should include a small, stable related-products block using `productRelations` or same-category fallback.
- Category pages should link to important child categories and curated product groups.
- Blog pages should link to relevant categories/products via explicit relation metadata, not only free-text links.
- Cross-sell/upsell blocks shown in cart/checkout should not be relied on for SEO because those routes are not indexable.
- Related blocks must not link to archived/hidden products.
- Avoid random related products on SSR pages; stable links are better for crawl consistency.

### 10.8 SEO QA and Monitoring

Admin should expose an SEO preview and validation panel for product, category, and product-group pages.

Validate:

- Canonical URL.
- Meta title and description.
- H1.
- Breadcrumb path.
- Index/noindex status.
- JSON-LD output.
- Sitemap inclusion.
- Hreflang alternates.
- Redirect conflicts.
- Missing image alt text.
- Empty category or thin content warnings.

### 10.9 Translation Coverage and FAQ Policy

Everything customer-visible must have an explicit translation source:

- Angular UI strings: Transloco JSON keys for every configured active locale.
- Product and variant content: DB i18n objects for title, description, option labels, swatches, alt text, and SEO fields.
- Category and collection content: DB i18n objects for labels, descriptions, banners, SEO fields, FAQ blocks, and landing-page copy.
- FAQ content: `faqEntries.question` and `faqEntries.answerHtml` as i18n objects.
- Payment/shipping/currency labels: DB i18n labels or Transloco keys, depending whether admin edits them.
- Admin reporting labels: Transloco keys, while report payload values remain locale-neutral numbers/codes.

Admin QA should show translation completeness per entity: default-locale completeness, missing configured-locale fields, fallback-in-use warnings, and missing SEO fields. The storefront may use the approved fallback, but admin must make every missing translation visible.

FAQ-specific rules:

- FAQ content must be real business content, not schema spam.
- FAQ entries attached to product/category/group routes must be included in SSR
  HTML for every active locale where the route exists.
- `FAQPage` JSON-LD is emitted only for rendered FAQ entries on that route.
- Archived products/categories must suppress their FAQ entries from public routes and sitemap generation.

## 11. Category and Product CRUD Module Plan

### 11.1 Backend Modules

Recommended modules:

- `CatalogAdminModule`
- `CatalogPublicModule`
- `SearchModule`
- `MediaModule`
- `InventoryModule`
- `PromotionModule`
- `RecommendationModule`
- `SeoModule`

### 11.2 Category Admin Commands

- Create category node.
- Edit node labels, SEO, media, display settings.
- Add placement under parent.
- Move placement.
- Mark canonical placement.
- Hide/archive category.
- Merge duplicate category nodes.
- Create redirect from old path.
- Bulk assign products to category.
- Remove products from category.
- Rebuild category path cache.

Validation:

- No placement cycles.
- Unique route path.
- One canonical placement for routable categories.
- Cannot delete category with products unless target replacement is provided.
- Hiding a category does not automatically hide products unless explicitly chosen.

### 11.3 Product Admin Commands

- Create simple product.
- Create variable product.
- Create bundle product.
- Duplicate product.
- Edit classification: primary category, additional categories, tags, attributes.
- Edit options and generate variants.
- Mark exactly one base term where a base option is required.
- Configure conditional tailoring add-ons.
- Edit variant price, compare-at price, sale price, SKU, stock, image, shipping, tax.
- Bulk update variant prices.
- Publish product.
- Hide product.
- Archive/discontinue product.
- Restore archived product.
- Bulk archive seasonal products.
- Trigger search reindex.
- Manage related products, cross-sell, upsell, substitutes, complete-the-look, and bought-together relations.
- Manage product groups/rails/lookbooks and decide whether a group is routable/indexable.
- Manage tags through tag CRUD and assign tags through the searchable multi-select dropdown.
- Toggle product table status enabled/disabled without opening edit form.
- Toggle sale status from the all-products table so storefront product cards can show or hide the sale badge.
- Review analytics-derived badges/insight labels and suppress or promote them.
- Generate and validate SEO route, structured data, sitemap inclusion, and redirects.

Validation:

- Published product requires title, slug, primary category, at least one image, price summary, and at least one active variant.
- Variant option combinations must be unique.
- SKU must be unique when present.
- Base variant must exist when an option definition has an `isBase` term.
- Add-on conditions must reference real option terms.
- Product cannot publish if category placement is missing or hidden.
- Archived product cannot remain in search, sitemap, recommendations, related/cross-sell/upsell blocks, or active category listings.
- Routable product groups require canonical path, metadata, sitemap policy, and no hidden/archived product targets.
- Related/cross-sell/upsell relations must suppress inactive targets automatically.
- Product publish must fail if SEO route generation or structured-data generation fails.
- Product table status switch and sale-status switch must be permission-gated, audited, filterable, sortable, and bulk-action compatible.
- Sale badge may be on even when price fields do not change only if owner approves manual marketing badges; otherwise validation should warn that no active sale price/promotion exists.

### 11.4 Admin UI Structure

Product builder tabs:

- Basics: title, slug, type, status, description.
- Classification: primary category, additional categories, tags, attributes.
- Options and variants: option definitions, semantic role selector, display style selector, base/default term, variant matrix for `variation_axis` only.
- Named add-ons and tailoring: add-on option groups, default selections such as `No Design`, price deltas, measurement requirements, add-on templates, and conditional visibility.
- Bundles/components: component groups and inventory-consuming kit logic for true composite products.
- Pricing and inventory: variant prices, stock, SKU.
- Shipping and tax: weight/dimensions, HSN, tax class.
- Media: gallery, swatches, variant images, alt text.
- Search and SEO: aliases, keywords, metadata, preview.
- Relations: related, cross-sell, upsell, substitutes, complete-the-look, bought-together.
- Product groups: rails, lookbooks, festival/wedding edits, routable SEO landing pages.
- Lifecycle and audit: publish/archive history.
- Setup/status flags retained from Fastkart context: Featured, Safe Checkout, Secure Checkout, Social Share, Encourage Order, Encourage View, Trending, Return Eligible, and Status.
- Product-card badges: manual Sale, Featured, Hot/Popular/Trending override, and analytics-derived badge preview.

All-products table requirements:

- Keep the existing product status switcher behavior available from the table and product edit form.
- Add `Sale Status` as a separate switcher column beside/near product status.
- Make both `Status` and `Sale Status` filterable and sortable, like name/price-style table columns.
- Include tags as a visible/filterable column or expandable chip row in the table.
- Support bulk enable/disable, bulk sale badge enable/disable, bulk archive, and bulk tag assignment when permissions allow.
- Every table-level switch must persist through the API, update audit logs, invalidate product summary/search/card caches, and refresh `productBadgeAssignments`.

Shared select/dropdown behavior:

- Retain the searchable multi-select dropdown with removable selected chips for product categories and product tags.
- Standardize the Fastkart `ng-select2-component` style/component version across admin/storefront as already planned.
- Product setup category/tag fields use multi-select mode.
- Purchase invoice product selector uses the same searchable dropdown component configured in single-select mode; only one product/variant can be selected per invoice line.
- Q&A targeting uses the same dropdown pattern in multi-select mode for categories and products.
- Attribute/option selection reuses Fastkart's existing conditional UI pattern: attribute dropdown, searchable value multi-select, dynamic generated forms, accordions, switches, media pickers, and the same Bootstrap/SCSS styling.
- Direct reuse of Fastkart's business assumption is forbidden: in Fastkart, every selected "Attribute" in Classified mode becomes a variation axis. In Saha Textile, the admin must first choose `filter_only`, `variation_axis`, `named_add_on`, or `bundle_component_option`.
- Only `variation_axis` selections feed the Cartesian variant matrix and per-variant price/SKU/stock/image/status forms.
- `named_add_on` and `bundle_component_option` groups reuse the same visual building blocks but render separate grouped/nested panels and do not create variant rows.
- Storefront display style is chosen per option/add-on/bundle group from `rectangle`, `circle`, `image_swatch`, `color_swatch`, `radio`, `dropdown`; this choice controls only the renderer.

Category manager views:

- Canonical tree view.
- Placement/DAG view.
- Product membership view.
- SEO/redirect view.

### 11.5 Purchase Invoice Admin Module

Add a custom admin page for inventory intake: recommended route `Products > Purchase Invoices > Add Purchase Invoice`, with a secondary shortcut from product/add-product workflows. It should reuse Fastkart-styled tables, searchable selects, form controls, validation messages, and modals, but the page composition is custom to Saha Textile.

Screen behavior:

1. Header captures supplier, physical invoice number, invoice date, notes, and optional invoice attachment.
2. The line-item grid mirrors a physical supplier invoice.
3. Each line has two mutually exclusive entry paths side by side:

- `Add New Product` button.
- Searchable existing product/variant dropdown configured as single-select.

4. If `Add New Product` is clicked:

- Open a modal containing the full product-add form, using the same product form components as normal product CRUD.
- After save succeeds and the API returns the new product/variant, close the modal.
- Fill that line with the newly created product/variant.
- Disable the existing-product dropdown for that line.
- Reveal quantity, purchase price including tax, MRP, and sale price fields.

5. If an existing product/variant is selected from the single-select dropdown:

- Disable the `Add New Product` button for that line.
- Reveal quantity, purchase price including tax, MRP, and sale price fields.

6. Quantity and purchase price including tax are editable.
7. MRP and sale price are fetched from catalog and read-only on this screen for launch.
8. Add-more-line button appends additional invoice rows.
9. Draft save is allowed; posting the invoice updates inventory and costing.

Data effects when invoice is posted:

- Create `purchaseInvoices` header record.
- Create `purchaseInvoiceLines` rows.
- Create `inventoryLedger` receipt rows.
- Create `inventoryCostLayers` rows for COGS/profit reporting.
- Increment variant stock quantity.
- Do not edit catalog MRP or sale price from this screen.
- Write `auditLogs` and analytics event `admin_purchase_invoice_posted`.

Reasoning:

- The screen is not a replacement for product pricing. It is for inventory intake and purchase-cost capture.
- Keeping MRP/sale read-only avoids batch/MRP complexity at launch.
- Hidden cost layers are still required for meaningful unit-level and category-level profit/loss reports.

### 11.6 PayPal Commission Admin CRUD

PayPal commission settings should be editable in admin. Recommended placement: `Settings > Payments > PayPal Commission` or `Currency > PayPal Commission` as a dedicated subpage/tab, not inside product CRUD.

Fields:

- Currency.
- Percent fee.
- Fixed fee.
- Optional extra FX markup/buffer percent.
- Optional GST-on-fees handling policy.
- Apply to product subtotal.
- Apply to international shipping.
- Effective-from/effective-to dates.
- Active/draft/archive status.

Required UI behavior:

- Show one active rule per currency.
- Include a calculator preview: intended net `N`, gross charge `G`, estimated PayPal fee, estimated seller net.
- Audit every rule change.
- Use the same Fastkart visual language as settings/currency forms, but persist through our `paypalCommissionRules` model.

Recommendation:

- Implement as a dedicated settings subpage/tab first. Promote it to a top-level custom page only if the owner expects frequent day-to-day fee edits.

## 12. API Contract Groups

Define separate zod contracts for:

- DB/domain entity shape.
- Admin create DTO.
- Admin update DTO.
- Public response DTO.
- Search response DTO.
- Bulk operation DTO.

Do not expose DB-only fields directly.

Minimum contract families:

- `CategoryNode`
- `CategoryPlacement`
- `CategoryRedirect`
- `AttributeDefinition`
- `AddonTemplate`
- `Product`
- `ProductVariant`
- `ProductBundle`
- `ProductRelation`
- `ProductGroup`
- `SeoRoute`
- `SeoRedirect`
- `MediaAsset`
- `SearchDictionaryEntry`
- `ProductAdminCreate`
- `ProductAdminUpdate`
- `ProductPublicSummary`
- `ProductPublicDetail`
- `CategoryPublicTree`
- `SearchSuggestionResponse`
- `FaqEntry`
- `ContentBlock`
- `Currency`
- `CurrencyExchangeRate`
- `PaymentGatewayConfig`
- `PaypalCommissionRule`
- `ShippingProviderConfig`
- `ShippingRateQuote`
- `PurchaseInvoice`
- `PurchaseInvoiceLine`
- `InventoryCostLayer`
- `AnalyticsEvent`
- `AnalyticsDailyAggregate`
- `BusinessReportSnapshot`
- `ProductInsightSet`
- `ProductBadgeAssignment`
- `QuestionAnswer` (customer Q&A is specified in this document and
  `owner-decisions-log.md`; it is separate from editorial FAQ)

## 13. Storefront Query Patterns

Product listing:

- Fetch category by path.
- Resolve descendant category IDs from `categoryPlacements`.
- Query products with `status: published` and `categoryIds: { $in: descendantIds }`.
- Return summaries only.

Product detail:

- Fetch product by slug.
- Ensure `status: published`; otherwise return `410 Gone` or redirect to category.
- Fetch active variants and add-on templates.
- Fetch related/cross-sell/upsell/complete-the-look summaries through `productRelations`.
- Fetch any product-detail rails from `productGroups` if configured.
- Render canonical metadata, structured data, hreflang links, and breadcrumbs from `seoRoutes`.

Search:

- Query `SearchPort`, not Mongo repository directly.
- Return small summaries.
- Hydrate full product detail only after user opens product page.

Admin listing:

- Default to active products.
- Allow status filters including archived/discontinued.
- Paginate always.
- Use projections; do not fetch variants for product table unless requested.

## 14. Archive and Retention Plan

Statuses:

- `draft`: admin-only, incomplete.
- `published`: visible everywhere.
- `hidden`: not visible but may be restored quickly.
- `archived`: removed from storefront/search/sitemap; retained for admin/history.
- `discontinued`: no longer sold; old public URL should return 410 or redirect.

Rules:

- Archived/discontinued products remain fully in Mongo at launch because the droplet SSD removes the earlier Atlas M0 512 MB pressure.
- Orders keep immutable line snapshots forever according to legal/accounting retention.
- Product images can remain in Spaces or move to cold path.
- Search index removes archived/hidden/discontinued products.
- Sitemap includes only published products/categories.
- Related/cross-sell/upsell/bought-together/complete-the-look links must exclude unpublished products.

Cold-archive seam, built later when disk pressure is real:

- Keep active and archived product documents fully in Mongo at launch.
- Design the later maintenance path now: move older rich archived product payloads to compressed JSON in Spaces only when droplet disk crosses a real threshold, suggested around 60-65% of the 80 GB disk.
- Keep a minimal `archivedProductStubs` record in Mongo for admin lookup and restore when a product is cold-archived later:

```ts
{
  _id: string;
  title: Record<string, string>;
  slug: string;
  sku?: string;
  archivedAt: Date;
  coldArchiveKey?: string;
}
```

Mongo cannot query Spaces directly. A cold archive is restored explicitly by the API/admin fetching the JSON by `coldArchiveKey`; it is not a live query path. Order-line snapshots and financial records stay in Mongo permanently.

## 15. Self-Hosted Mongo Operational Rules

- Keep product documents lean.
- Avoid indexing archived-heavy fields.
- Use projections everywhere.
- Keep variants in a separate collection so product table/search reads stay small.
- Avoid unbounded audit logs in Mongo — use tiered retention (financial/security **7y**, catalog/admin **5y**) and compact diffs; cold-archive only if needed (owner-locked 2026-07-23).
- Do not store raw search/analytics events indefinitely — **~90 days** after rollup then TTL/cold-archive.
- Do not use regex typeahead against products.
- Prefer keyset pagination for admin lists after data grows.
- Store media outside Mongo.
- Compact old archived payloads to Spaces only when droplet disk pressure is real; this is a later maintenance job, not launch scope.
- TTL or cold-archive raw analytics events after daily rollups.
- Prefer materialized reporting aggregates over dashboard-time aggregation across orders/events.
- Keep purchase invoice line records and order line cost snapshots lean but durable; they are required for profit and tax reporting.
- Run MongoDB 8.3 in Docker for local and production parity.
- Enable a single-node replica set in local, test, and production profiles so transaction behavior is always exercised.
- Keep Mongo bound to the Docker private network; public `27017` must never be reachable.

## 16. Required Implementation Sequence

1. Review the applicable `DEC-*` gates in `pending-decisions.md`; proceed with stable seams and block only irreversible policy choices.
2. Update contracts to support category placements, richer statuses, product variants, add-on conditions, product relations, product groups, SEO routes/redirects, search dictionary, localized content, currencies, FX rates, gateway configs, shipping quotes, purchase invoices, inventory cost layers, and analytics rollups.
3. Update Mongo models and indexes.
4. Build migration/import mapper from Woo public API/export to target model.
5. Seed full live category tree and representative products.
6. Build category CRUD and placement manager.
7. Build product CRUD and variable builder.
8. Build add-on template CRUD.
9. Build localized FAQ/content block CRUD and translation completeness QA.
10. Build product relation CRUD for related/cross-sell/upsell/substitute/bought-together relationships.
11. Build product group CRUD for rails/lookbooks/SEO landing groups.
12. Build SEO route and redirect generation.
13. Build search dictionary CRUD.
14. Wire SearchPort to chosen engine.
15. Add search outbox and reindex worker.
16. Add currency, FX-rate, tax-class, PayPal commission, payment gateway, and shipping provider config modules.
17. Add purchase invoice admin module, inventory ledger receipts, and inventory cost layers.
18. Add order/tax/shipping/payment/return/refund snapshots before checkout wiring.
19. Add analytics event capture and daily rollup jobs for admin reporting.
20. Add weekly `productInsightSets` generation and `productBadgeAssignments` refresh for storefront rails/product-card markers.
21. Add all-products table status/sale-status switch columns, filters, sorting, and bulk actions.
22. Add separate editorial FAQ and customer Q&A modules per this document and
    `owner-decisions-log.md`, reusing editor/table primitives without merging
    their business models.
23. Add admin audit log for all catalog, pricing, inventory, payment, shipping, and reporting-sensitive mutations.

## 17. Pricing, Tax, FX, Payment, and Shipping Logic

### 17.1 Canonical pricing model

Catalog pricing remains INR-first:

- `productVariants.priceINR`: current selling/base price in INR.
- `productVariants.compareAtPriceINR`: MRP/regular price in INR.
- `productVariants.salePriceINR`: optional active sale price in INR.
- Purchase cost never lives in catalog price fields. It comes from `purchaseInvoiceLines` and `inventoryCostLayers`.

Effective INR selling price:

```ts
effectiveSellingINR = activeSalePriceINR ?? priceINR;
```

The storefront receives backend-computed display values. Angular never calculates final customer price beyond formatting values returned by API.

### 17.2 Currency conversion

Persist daily INR-based rates in `currencyExchangeRates`, then copy the latest active rate to `currencies.rateFromINR` for fast reads.

```ts
netDisplayAmount = roundCurrency(effectiveSellingINR * rateFromINR, currency);
```

Rules:

- INR uses `rateFromINR = 1`.
- If FX provider fails, keep the latest good rate and mark stale.
- Every order line snapshots rate, source, fetched date, INR amount, display currency, and display amount.

### 17.3 PayPal gross-up formula

For non-INR/PayPal checkout, the goal is to charge enough so the business nets the intended converted amount after PayPal deducts percent fee plus fixed fee.

Base formula from KB:

```ts
G = (N + f) / (1 - p);
```

Where:

- `N` = intended net amount in display currency after INR conversion.
- `p` = PayPal percentage fee as decimal, for example `0.044`.
- `f` = fixed fee in the same currency, for example `0.30` USD.
- `G` = customer gross charge before rounding.

If the owner chooses to gross-up additional PayPal FX markup/buffer too:

```ts
pTotal = percentFee + extraPercentGrossUp;
G = (N + fixedFee) / (1 - pTotal);
```

If GST-on-fees is also grossed up, keep it as an explicit admin policy in `paypalCommissionRules`. Do not hide it in code constants.

Worked example:

```ts
N = 100.00 USD
p = 0.044
f = 0.30 USD
G = (100.00 + 0.30) / (1 - 0.044) = 104.92 USD
```

### 17.4 Gateway selection

- INR checkout: CCAvenue.
- Non-INR checkout: PayPal.
- Gateway decision is made server-side from selected/settlement currency.
- Payment records snapshot gateway, currency, amount paid, INR equivalent, FX rate, and gateway config version.

### 17.5 Tax logic

Tax profile lives on variant/product and resolves through `taxClasses`/`taxRules` at checkout.

For tax-inclusive purchase or sale values:

```ts
taxExclusive = taxInclusive / (1 + taxRatePct / 100);
taxAmount = taxInclusive - taxExclusive;
```

For tax-exclusive values:

```ts
taxAmount = taxExclusive * (taxRatePct / 100);
taxInclusive = taxExclusive + taxAmount;
```

Rules:

- Customer display policy remains an owner/accountant decision.
- Order lines snapshot resolved tax class, HSN, rate, taxable base, tax amount, and whether price was tax-inclusive.
- Purchase invoice lines separately snapshot purchase tax so inventory cost and GST/accounting reports remain possible.

### 17.6 Shipping logic

Domestic and international must be separated in configuration and adapter selection.

- Domestic India: Shiprocket domestic adapter initially.
- International: Shiprocket international/Shiprocket X initially; later DHL/FedEx/Aramex can be added behind `ShippingPort`.
- Adapter chosen by destination country and active `shippingProviderConfigs`.
- Shipping provider response must store value and currency.
- Convert returned shipping cost through stored FX.
- Apply PayPal gross-up to shipping only for international PayPal checkout when the active `paypalCommissionRules.applyToInternationalShipping` is true.

### 17.7 Admin pricing controls

Admin needs these controls before checkout is considered complete:

- Currency CRUD and enable/disable.
- FX rate latest/current view and stale warning.
- Manual FX override with audit log for emergency use.
- PayPal commission CRUD per currency.
- CCAvenue/PayPal sandbox/live mode display.
- Tax class/rule CRUD.
- Shipping provider config and fallback rate config.

## 18. Reporting and Analytics Architecture

Admin reporting must be designed as a first-class DB concern, not as dashboard-only UI.

### 18.1 Event and rollup strategy

- Capture raw user/admin events in `analyticsEvents` with short retention.
- Roll raw events into `analyticsDailyAggregates` by date and grain.
- Generate `businessReportSnapshots` for dashboard cards and longer reports.
- Generate weekly `productInsightSets` from aggregates, orders, and search data.
- Refresh `productBadgeAssignments` from manual product flags, active promotions, and weekly insight sets.
- Keep order, payment, shipment, refund, purchase invoice, inventory ledger, and cost layer snapshots durable because they are financial records.

### 18.2 Required admin dashboard metrics

Minimum dashboard/reporting surface:

- Most searched terms.
- No-result searches and spelling/transliteration candidates.
- Most viewed products and categories.
- Most added-to-cart products.
- Most bought products, variants, and categories.
- Persisted storefront insight sets: `Most Searched`, `Most Viewed`, `Most Bought`, `Trending`, `Hot`, `Popular`, and manual featured rails.
- Product-card marker suggestions: sale, featured, hot, popular, most viewed, most bought, most searched.
- Abandoned carts and checkout-started-but-not-paid counts.
- Sales by day/week/month.
- Sales by product/category/variant.
- Sales by currency and payment gateway.
- Gross revenue, discounts, refunds, tax, shipping charged, estimated gateway fees.
- COGS and gross profit by order/product/variant/category.
- Purchase totals by supplier/product/category/date.
- Inventory value, low-stock, slow-moving stock, and stock aging.
- Returns/refunds by reason and product/category.
- Admin activity: product edits, price edits, stock updates, purchase invoice postings.

### 18.3 Report calculation rules

- Sales reports use order snapshots, not current product documents.
- Profit reports use order-line cost snapshots derived from `inventoryCostLayers`.
- Category reports use category snapshot at purchase time plus current mapping for optional comparison.
- Search reports combine `searchQueryAggregates` and `analyticsEvents`.
- Dashboard queries read `analyticsDailyAggregates`/`businessReportSnapshots`, not raw orders/events whenever possible.

### 18.4 Weekly storefront insight job

A weekly scheduled job must convert reporting data into storefront-usable merchandising data.

Inputs:

- `analyticsDailyAggregates` for product/category/search behavior.
- `searchQueryAggregates` for searched terms and no-result terms.
- Orders/order lines for bought units, revenue, conversion, and profit.
- Product status, stock, price, tags, category, and media readiness.
- Manual admin suppress/pin overrides.

Outputs:

- Active `productInsightSets` for homepage rails/banners.
- Refreshed `productBadgeAssignments` for product cards.
- Optional admin-reviewed `tags.type = 'analytics'` records if the owner wants persistent tags such as `Most Bought` or `Popular`.

Rules:

- Generate at a predictable weekly cadence, for example Monday 02:00 IST.
- Keep prior active set until the new set is generated successfully.
- Do not include archived/hidden/discontinued products.
- Do not include products missing image/price/route requirements.
- Respect manual suppression and pinning.
- Store score explanation so admin can see why a product appears in a rail.

Storefront usage:

- Homepage fetches stable insight sets through a public read endpoint.
- Product cards receive badge summaries from product summary DTOs.
- Category pages may use category-scoped variants of `most_viewed`, `most_bought`, and `trending` later.

## 19. Purchase Invoice and Inventory Intake Plan

This module is required because catalog stock cannot be trustworthy if inventory is only edited manually on products.

### 19.1 Why this belongs near Products/Add Product

- The user mentally receives stock as products.
- The purchase invoice screen often needs to create missing products immediately.
- Existing product form, product modal, searchable dropdown, table, media picker, and validation UI can be reused.
- It should look like the Fastkart admin theme but be custom-composed for Saha Textile's workflow.

### 19.2 Line-item workflow

Each purchase invoice line must support either:

- Create a new product/variant in a modal, then attach it to the line.
- Select one existing product/variant from a searchable single-select dropdown.

Mutual exclusion:

- Once new product flow saves, disable the dropdown for that row.
- Once existing product is selected, disable the add-new-product button for that row.
- The dropdown must be the same product/category/tag selection component family, configured with `multiple: false` or equivalent plugin option.

Visible fields after product selection:

- Quantity being added.
- Purchase price including tax.
- MRP fetched from catalog, read-only.
- Sale price fetched from catalog, read-only.

### 19.3 Posting behavior

Posting the invoice must:

1. Validate supplier/invoice header.
2. Validate each selected product/variant.
3. Split tax-inclusive purchase price when tax rate is known.
4. Save invoice header and lines.
5. Create inventory ledger receipt rows.
6. Create FIFO inventory cost layers.
7. Increment stock.
8. Leave product MRP/sale price unchanged.
9. Write audit logs.
10. Update reporting rollups asynchronously.

### 19.4 Required owner decision

The system needs a valuation method.

Recommended: FIFO hidden cost layers.

Reason: FIFO gives unit-level margin/profit reporting without creating customer-facing batch/MRP complexity.

Alternative: weighted average cost.

Reason to choose only if the owner wants simpler reports and does not need per-unit purchase cost traceability.

## 20. Payment Gateway Admin Plan

### 20.1 CCAvenue

Admin should show non-secret CCAvenue status/config:

- Sandbox/live mode.
- Supported INR gateway status.
- Redirect URLs.
- Last successful payment test.
- Last webhook/response validation result.

Secrets remain in env/secret storage.

### 20.2 PayPal

Admin should provide PayPal commission CRUD through `paypalCommissionRules`.

Recommended location:

- `Settings > Payments > PayPal Commission` as a dedicated subpage/tab.

Reason:

- It is a payment/pricing policy, not product data.
- It affects all non-INR products and international shipping.
- It needs audit, effective dates, and calculator preview.

Top-level page option:

- Use a top-level page only if the owner expects frequent operational changes or wants payment operations separated from settings.

## 21. Translation and Content Completion Rules

English is the primary locale. The active target locale pair is English and
French. Bengali is a likely future locale and remains useful search-dictionary
test coverage, but it is not a locked current launch pair.

Use two translation machines:

1. Developer-owned UI chrome uses reactive Transloco keys.
2. Admin-authored catalog, CMS, media, measurement, FAQ, Q&A, and SEO content
   uses locale-keyed DB fields resolved by the API.

Never pass DB-authored content through Transloco. Before public launch, every
route-producing entity must pass active-locale coverage checks for visible copy,
media alt text, and SEO metadata.

Admin validation:

- Block publish when the default locale is missing.
- Warn for every missing configured active locale and identify fallback use.
- Show translation completeness on relevant list/edit screens.
- Treat adding a locale as a checklist covering UI JSON, DB content, media,
  notification templates, SEO defaults, hreflang, and compiled payloads.

## 22. Decision Authority and Open Gates

Resolved decisions are recorded once in `owner-decisions-log.md`; they are not
repeated here with superseded alternatives. The current locks applied by this
design include self-hosted MongoDB, Meilisearch behind `SearchPort`,
multi-placement categories, product-specific semantic option roles, first-class
variants, true bundle/composite support, retained archived products, and hybrid
search-dictionary tuning.

All unresolved owner choices live in `pending-decisions.md`. Catalog and
commerce implementation must reference the applicable stable `DEC-*` ids,
especially tax/HSN, stock reservation and backorder behavior, SKU/slug policy,
variant overrides, add-on measurements, bundles, badges/rails, locale routes,
media limits, and payment/FX timing. This file must not grow a second question
register.

## 23. Final Recommendation

Use the category placement model, `categoryFacetConfigs`, first-class product variants, add-on templates, localized FAQ/content blocks, Q&A module, search dictionary, search outbox, currency/FX collections, payment/shipping config collections, purchase invoice/cost-layer collections, analytics rollups, product insight sets, product badge assignments, and separate order/payment/shipment/return/refund collections.

For search, use a self-hosted Meilisearch adapter behind `SearchPort`, with self-hosted Mongo as source of truth and a curated locale-aware `searchDictionary` for spelling, aliases, and transliteration. Do not attempt the requested typeahead quality with Mongo regex.

For pricing, keep INR as canonical, calculate currency conversion and PayPal gross-up only on the backend, store FX history, version PayPal commission rules, and snapshot every resolved price/tax/shipping/payment value onto orders.

For inventory and reporting, add purchase invoices plus hidden FIFO inventory cost layers. This gives unit-level COGS, gross margin, purchase reports, category profitability, and admin analytics without introducing customer-facing batch/MRP complexity.

For storefront merchandising, convert weekly analytics into persisted product insight sets and badge assignments. Homepage rails and product-card labels must read these stable collections rather than recomputing analytics on customer requests.

For self-hosted Mongo longevity, keep documents/indexes disciplined, roll raw analytics into aggregates, and design the old-rich-archive-to-Spaces seam while keeping archived products fully in Mongo at launch. Order-line and purchase-cost snapshots stay in Mongo permanently.
