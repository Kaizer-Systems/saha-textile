---
title: Product page
wide: true
description: How the shop's product page lays out its first screen on phones and laptops, the photo gallery, option looks and table, the measurement row, the buy bar and its sheets, and set pages with their piece rows, picks, optional pieces and set price.
status: implemented
audience: [beginner, frontend, backend]
last_verified: '2026-11-21'
source_of_truth:
    - apps/storefront/src/app/features/shop/product-detail/product-detail.ts
    - apps/storefront/src/app/features/shop/product-detail/buy-box/buy-box.ts
    - apps/storefront/src/app/features/shop/product-detail/buy-bar/buy-bar.ts
    - apps/storefront/src/app/features/shop/product-detail/sidebar/sidebar.ts
    - apps/storefront/src/app/features/shop/product-detail/product-gallery/product-gallery.ts
    - apps/storefront/src/app/shared/ui/product-config/product-configurator/product-configurator.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/variation-table/variation-table.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/option-swatch/option-swatch.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/addon-group/addon-group.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/addon-sheet/addon-sheet.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/measurement-row/measurement-row.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/measurements-sheet/measurements-sheet.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/bundle-configurator/bundle-configurator.ts
    - apps/storefront/src/app/shared/ui/product-config/parts/set-summary/set-summary.ts
    - apps/storefront/src/app/shared/ui/product-config/set-pricing.ts
    - apps/storefront/src/scss/components/_buy-box-layout.scss
    - apps/storefront/src/scss/components/_buy-bar.scss
    - apps/storefront/src/scss/components/_option-looks.scss
    - apps/storefront/src/scss/components/_measure-row.scss
    - apps/storefront/src/scss/components/_set-rows.scss
    - packages/core-domain/src/catalog/set-price.ts
    - apps/api/src/catalog/catalog-public.service.ts
---

# Product page

The product page is one component, `ProductDetail`, with three columns on laptops: the photo gallery, the buy box
and a right column. Phones stack the gallery and the buy box, hide the right column, and keep a buy bar fixed above
the bottom menu. Every part is drawn on the server (SSR), so the first paint already holds the name, the price and
the buttons.

## First screen

The buy box puts the decision first, so Buy now and Add to cart sit in the first screen at common laptop sizes:

- **Price line**: price, MRP and % off, "Inclusive of all taxes", a stock chip ("In stock · 3 left", amber at two
  or fewer, red when sold out) and the wishlist, compare and share icons.
- **Description**: two lines with an ellipsis (`.st-clamp-2`); the whole text stays in the page and in the
  Description tab, so search engines read all of it.
- **Choices**: the option looks (below), then add-ons.
- **One button row** (`.st-cta-row`): quantity, Add to cart (cart icon), Buy now (lightning icon). When a long label
  cannot fit, Buy now moves to its own line instead of shrinking. Sold out shows Notify me in the same row.
- **Below the buttons** (`.st-after-cta`): the attribute chips and the option table, which describe rather than
  choose. The product pop-up (cards and cart Edit) keeps them above, with the choices.
- **Total box**: shown only once an add-on adds to the price.

The styles live in the shared partials under `apps/storefront/src/scss/components`, so the page and every pop-up draw
the parts the same way, and the critical-CSS step inlines what the first screen needs.

## Gallery

Up to five photos draw a plain thumbnail row under the photo, each tile a fifth of the photo's width; more than five
use the slider with arrows. A product with one photo and no video draws no row. Phones show the photo full width with
arrows and dots and no thumbnail row. The `sizes` hints follow these widths, so each screen loads the smallest file
that fills it.

## Option looks and the option table

Each option group draws in its look from Admin (`displayStyle`): the theme's looks plus picture row, picture chip,
Size V2 (a value with a second line, such as "M / Bust 36 in") and colour chip. One `.st-look` item serves all four;
the list's modifier (`.st-look-rows`, `.st-look-sizes`) sets its shape. A sold-out value is crossed out and still
opens Notify me.

The option table marks the chosen row with a radio ring, greys sold-out rows with "Out of stock" in red, shows
"Only N left" in amber at two or fewer, and labels the price column "Price (incl. taxes)".

## Measurements

A measurement form of four fields or fewer stays on the page. A longer one becomes the measurement row
(`MeasurementRow`): a tape icon, the form's name, a status chip ("Needed · 5 fields", then "Added") and Add or Edit,
which opens the same form in a pop-up (`MeasurementsSheet`). On phones the pop-up rises from the bottom as a sheet
(`.st-sheet`). Sets and the buy bar always use the row.

## Buy bar

`BuyBar` takes the buy box as its `host` and draws the same state: one markup for every kind of product, changed by
modifiers.

- **When it shows**: on phones from the first screen; on laptops whenever the buy box's own buttons are out of view
  (`showBuyBar`).
- **Summary line**: the chosen option's photo, the name, then the price with MRP and % off, or the chosen options as
  chips ("Lavender ▾", "34 ▾"). A chip opens a short list above it with each value's stock; a sold-out value is
  greyed. Choosing there chooses through the page's own buttons, so page, bar and cart always agree.
- **Add-ons**: the chosen design with a pencil and the measurement state. The pencil opens a sheet with just the
  designs and the measurement row; Edit add-on opens the whole add-on block. Both write back to the page.
- **Sets**: "Complete set · N pieces", its state and Configure set, which opens the set's part in a sheet whose footer
  shows "Set price · N pieces" and Add set to cart. Closing the sheet keeps the choices.
- **Metre fabric** shows the length box in place of the quantity; sold out shows Notify me.

The sheets (`AddonSheet`) host the page's own parts in the shop's pop-up, so a choice made in a sheet is the same
choice on the page.

## Set pages

A set (bundle) draws its pieces as rows (`BundleConfigurator`): photo, number, name, SKU and a status mark (green
ready, amber when a choice or measurements are missing, red when out of stock). Only one row is open at a time; an
open row shows the piece's facts and a link to its own page.

- **Choice groups**: a group holding more pieces than it takes is one row; its pieces are picture-row tiles with what
  each changes in the set price ("Included", "+₹800", "−₹500"), out-of-stock ones struck through. The first pieces
  are included until the shopper picks others. A closed group row shows its pick as a chip.
- **Optional pieces**: a piece that is not required has an "Add · +₹X" switch; switched on, it joins the set and its
  price, and its row explains what switching it off does.
- **Set summary** (`SetSummary`): in the right column on laptops, in place of Trending Products: the set with its
  photo and quantity, each piece the set holds with its own price, "Bought separately", "You save", the set price and
  the delivery note.
- **Buying a set**: sets cannot be bought until checkout prices them; the page says so below the piece rows, Add to
  cart is absent and Buy now is disabled.

### Set price

Each set follows its own price setting, worked out by one rule in core (`catalog/set-price.ts`):

| Setting                 | Set price                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `fixed_bundle_price`    | The fixed price; a pick dearer than its group's included piece adds the difference. |
| `sum_components`        | What the chosen pieces cost.                                                        |
| `discounted_components` | What the chosen pieces cost after each piece's own adjustment.                      |

Under every setting an optional piece adds its own price. The API sends the set's own price (included picks, no
optional piece) and, for each piece, `included`, `setPriceINR` and `priceChangeINR`; the shop adds up the shopper's
picks with the same rule (`setPricing` maps the page's set into it).

## Swatch pictures

A value's swatch is the square `swatch_image` file of its picture. A picture can be a swatch cut: a square of a
product photo made into a picture of its own in Admin (see [Swatch cuts](../admin/swatch-cuts.md)). While a cut is
still being made, the API draws the photo's own square instead, so a swatch never goes blank.

## Limitations

- Sets cannot be added to the cart until checkout prices them; the page and its sheets say so.
- A choice group that takes more than one piece is priced by swapping the last included piece, which is exact for the
  sum settings and for single picks.
