---
title: Swatch cuts and look previews
wide: true
description: How admin shows each option look while it is chosen, and how a swatch cut turns a square of a product photo into a picture of its own, made by the image worker from the original and listed under its photo in the Media Library.
status: implemented
audience: [beginner, frontend, backend, operator]
last_verified: '2026-11-22'
source_of_truth:
    - packages/contracts/src/media.ts
    - packages/contracts/src/media-library.ts
    - packages/core-domain/src/media/swatch-cut.ts
    - packages/core-domain/src/media/profiles.ts
    - packages/core-domain/src/media/replace-photo.ts
    - packages/core-domain/src/ports/image-codec.port.ts
    - packages/adapters-image-sharp/src/sharp-image-codec.ts
    - packages/adapters-db-mongo/src/repositories/media.repository.ts
    - packages/adapters-db-mongo/src/repositories/media-owner-registry.ts
    - packages/adapters-db-mongo/src/migrations/media-versions.ts
    - apps/api/src/media/admin-media-library.controller.ts
    - apps/api/src/media/media-library.service.ts
    - apps/api/src/worker/media-worker.ts
    - apps/api/src/catalog/catalog-public.service.ts
    - apps/admin/src/app/shared/ui/look-preview/look-preview.ts
    - apps/admin/src/app/shared/ui/swatch-cut/swatch-cut.ts
    - apps/admin/src/app/features/product/form-product/option-groups/option-groups.ts
    - apps/admin/src/app/features/attribute/form-attribute/form-attribute.ts
    - apps/admin/src/app/features/media/file-manager/fm-details.html
---

# Swatch cuts and look previews

## Look preview

Wherever a look is chosen (Admin › Attributes and a product's option groups in Products › Edit › Inventory), a
preview under the choice (`LookPreview`) sketches that look with the values on hand, the first drawn as chosen. It
uses plain admin colours, not the shop's styles, and changes as soon as another look is picked. Until an attribute
has named values it shows samples. A picture look draws the very square file the shop draws (`swatchFile`, read
through the Media Library for people who may open it; others see the photo's thumbnail).

## Swatch cuts

A product photo is 3:4 and only ever gets its "As is" version, so its swatch square is always its middle: often a
face, not the fabric. A swatch cut fixes that: a square of the photo, chosen by hand, made into a picture of its own.
The photo never changes and stays whole in the gallery.

### Making a cut

Once a value has a picture, Products › Edit › Inventory › Swatch pictures shows a **Cut** tile beside it, and Admin ›
Attributes shows a **Cut** button under the default picture. It opens the cut pop-up (`SwatchCut`):

- the photo, dimmed outside a square that is dragged, tapped into place or moved with the arrow keys;
- zoom from 1× (a square as wide as the photo's short edge) to 6×, with "The cut keeps N × N px of the original";
  under 480 px (twice the largest swatch file) it says "This will look soft", and still saves;
- the square in the four picture looks (picture swatch, picture tile, picture row, picture chip), drawn from the
  photo with CSS, no file made in the browser;
- **Use the whole photo** (the photo's own square, as before), **Cancel**, **Save cut**.

Save cut calls `POST /admin/media/library/files/:id/cuts` and the value then points at the cut with its
`swatch_1x1.as_is` version; the form's own Save stores it. Opening Cut again on a value that uses a cut reopens on
the same square. The pop-up reads the photo through `GET /admin/media/library/files/:id/cut-source`. Both routes are
open to anyone who may edit products (`product.edit`), without Media Library access.

### What the server does

- **The cut picture** (`planCut`): a new media asset with `cutFrom` (the photo's id and the square, as fractions of
  the upright original), one version of the built-in profile **Swatch cut 1:1** (`swatch_1x1`: the `swatch_image`
  80/160/240 px and `swatch_image_v2` 120/240/360 px families) and its own original key. The same square of the same
  photo reuses the cut already made.
- **Checks** (`checkCut`): a photo with an original, not a cut of a cut, a square inside the photo; refusals come back
  in words.
- **The worker's `cut` job** (`cutSwatch`): reads the photo's full-size original, cuts the square (`ImageCutPort`,
  sharp: upright, sRGB, q95 JPEG), stores it as the cut's original, then makes its swatch sizes like any other photo.
- **Replace**: a new original for the photo queues the `cut` job for each of its cuts, so every cut is made again at
  its own square; the files made before are kept 7 days, as Replace keeps them.
- **While a cut is being made**, the shop draws the photo's own square (`swatchAsset`), so a swatch never goes blank.

### In the Media Library

A cut exists for the values that use it, so a cut nothing uses is deleted for good with its original, every size and
its CDN copies (`dropUnusedCut`): when a product or attribute save replaces it (`swatchesLeftBehind` → the worker's
`drop-cut` job), when Save cut replaces an unsaved one (the request's `replaces`), and in a daily sweep for cuts made
over a day ago that were never saved (`cut-sweep`, 03:52 IST). A cut still used by another value, product, attribute
or order stays. Photos and library pictures are never deleted this way. Its details say
"Cut from …"; a photo's details list its swatch cuts with where each is used. "Where used" and the delete guard count
a product's own option swatches (`optionGroups.terms.swatchAssetId`) as well as attribute default pictures.

## Image V2 size

The Image V2 swatch (`swatch_image_v2`) has 120, 240 and 360 px files, so the tile stays sharp on 3× phones. Built-in
profiles still on the seeded 120 and 240 px gain 360 px through a release migration, with a new profile version, so
"Bring older versions up to date" adds the file to photos made before.

## Limitations

- A cut is made from a photo, not from another cut.
- The tile in the product form shows the photo it was cut from until the form is opened again.
